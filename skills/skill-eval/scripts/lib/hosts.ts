import { constants } from "node:fs";
import { appendFile, cp, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { redactSecrets, runProcess } from "./process.ts";
import type { EffectiveRuntimeProfile, HostAdapter, HostName, HostRequest, HostResult } from "./types.ts";

export const DEFAULT_CODEX_MODEL = "gpt-5.6-sol";
export const DEFAULT_CODEX_REASONING_EFFORT = "high";
export const DEFAULT_CLAUDE_MODEL = "claude-opus-4-8";
export const DEFAULT_CLAUDE_REASONING_EFFORT = "high";
const REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);

export function validatedReasoningEffort(value: string | undefined, fallback: string): string {
  const effort = value ?? fallback;
  if (!REASONING_EFFORTS.has(effort)) throw new Error(`invalid reasoning effort: ${effort}`);
  return effort;
}

export function resolvedRuntimeIdentity(host: HostName, model?: string, reasoningEffort?: string): { model: string; reasoning_effort: string } {
  return {
    model: model ?? (host === "codex" ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL),
    reasoning_effort: validatedReasoningEffort(reasoningEffort, host === "codex" ? DEFAULT_CODEX_REASONING_EFFORT : DEFAULT_CLAUDE_REASONING_EFFORT),
  };
}

export interface HostAdapterOptions {
  commands?: Partial<Record<HostName, string>>;
  codexHome?: string;
}

export async function createIsolatedCodexHome(sourceHome = process.env.CODEX_HOME ?? join(homedir(), ".codex")): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), "skill-eval-codex-home-"));
  const candidates = [join(sourceHome, "auth.json"), join(homedir(), ".codex", "auth.json")];
  for (const candidate of [...new Set(candidates)]) {
    try {
      await cp(candidate, join(path, "auth.json"));
      break;
    } catch {
      // Authentication may live in the OS keychain; let Codex report readiness.
    }
  }
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

export function buildClaudeArgs(request: Pick<HostRequest, "finalPath" | "model" | "reasoningEffort" | "contextMode">): string[] {
  const mode = request.contextMode ?? "isolated";
  const model = request.model ?? DEFAULT_CLAUDE_MODEL;
  return [
    ...(mode === "isolated" ? ["--safe-mode"] : []),
    "--disable-slash-commands",
    ...(mode === "isolated" ? ["--setting-sources", ""] : mode === "project-context" ? ["--setting-sources", "project"] : []),
    "--no-session-persistence",
    ...(mode === "live" ? [] : ["--strict-mcp-config"]),
    "--permission-mode", "auto",
    "--output-format", "stream-json",
    "--verbose",
    "--model", model,
    "--effort", validatedReasoningEffort(request.reasoningEffort, DEFAULT_CLAUDE_REASONING_EFFORT),
    "-p",
  ];
}

export function buildCodexArgs(request: Pick<HostRequest, "cwd" | "finalPath" | "outputSchemaPath" | "model" | "reasoningEffort" | "contextMode">): string[] {
  const mode = request.contextMode ?? "isolated";
  const model = request.model ?? DEFAULT_CODEX_MODEL;
  return [
    "exec",
    "--json",
    "--ephemeral",
    ...(mode === "live" ? [] : ["--ignore-user-config"]),
    ...(mode === "isolated" ? ["--ignore-rules"] : []),
    "--sandbox", "workspace-write",
    "--skip-git-repo-check",
    "--model", model,
    "-c", `model_reasoning_effort="${validatedReasoningEffort(request.reasoningEffort, DEFAULT_CODEX_REASONING_EFFORT)}"`,
    "-C", request.cwd,
    "-o", request.finalPath,
    ...(request.outputSchemaPath ? ["--output-schema", request.outputSchemaPath] : []),
    "-",
  ];
}

export function effectiveRuntimeProfile(host: HostName, request: HostRequest): EffectiveRuntimeProfile {
  const identity = resolvedRuntimeIdentity(host, request.model, request.reasoningEffort);
  return {
    role: request.role ?? "behavior",
    host,
    ...identity,
    context_mode: request.contextMode ?? "isolated",
    capabilities: [...new Set(request.capabilities ?? [])],
  };
}

function jsonLines(raw: string): { events: Array<Record<string, any>>; malformed: number } {
  const events: Array<Record<string, any>> = [];
  let malformed = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") events.push(value);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  return { events, malformed };
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function usageFrom(events: Array<Record<string, any>>): HostResult["usage"] {
  let input: number | null = null;
  let output: number | null = null;
  let total: number | null = null;
  let cost: number | null = null;
  for (const event of events) {
    const usage = event.usage ?? event.message?.usage ?? event.result?.usage;
    if (usage && typeof usage === "object") {
      input = numeric(usage.input_tokens ?? usage.inputTokens) ?? input;
      output = numeric(usage.output_tokens ?? usage.outputTokens) ?? output;
      total = numeric(usage.total_tokens ?? usage.totalTokens) ?? total;
    }
    cost = numeric(event.total_cost_usd ?? event.cost_usd) ?? cost;
  }
  if (total === null && input !== null && output !== null) total = input + output;
  return { input_tokens: input, output_tokens: output, total_tokens: total, cost_usd: cost };
}

function metricsFrom(events: Array<Record<string, any>>): NonNullable<HostResult["metrics"]> {
  let toolCalls = 0; let steps = 0; let errors = 0;
  for (const event of events) {
    if (event.type === "assistant") {
      steps += 1;
      const content = event.message?.content;
      if (Array.isArray(content)) toolCalls += content.filter((item: any) => item?.type === "tool_use").length;
    }
    if (["item.started", "item.completed"].includes(event.type)) {
      const type = event.item?.type;
      if (event.type === "item.completed") steps += 1;
      if (event.type === "item.completed" && ["command_execution", "mcp_tool_call", "web_search", "file_change"].includes(type)) toolCalls += 1;
      if (event.item?.status === "failed" || event.item?.error) errors += 1;
    }
    if (event.type === "error" || event.is_error === true || event.error) errors += 1;
  }
  return { tool_calls: toolCalls, steps, errors };
}

async function preserveClaudeBackgroundResults(events: Array<Record<string, any>>, eventPath: string, env: Record<string, string | undefined>): Promise<void> {
  const roots = [tmpdir(), "/tmp", "/private/tmp"].map((path) => resolve(path));
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== "system" || event.subtype !== "task_notification" || event.status !== "completed") continue;
    if (typeof event.tool_use_id !== "string" || typeof event.output_file !== "string") continue;
    const path = resolve(event.output_file);
    const key = `${event.tool_use_id}\0${path}`;
    if (seen.has(key) || !path.includes(`${sep}tasks${sep}`) || !roots.some((root) => path.startsWith(`${root}${sep}`))) continue;
    seen.add(key);
    try {
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let content: string;
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > 2 * 1024 * 1024) continue;
        content = redactSecrets(await handle.readFile({ encoding: "utf8" }), env);
      } finally {
        await handle.close();
      }
      await appendFile(eventPath, `${JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: event.tool_use_id, content, is_error: false }] },
        skill_eval_source: "claude_background_task_output",
      })}\n`);
    } catch { /* a missing or unreadable temporary output remains unavailable evidence */ }
  }
}

async function execute(host: HostName, command: string, request: HostRequest, sourceCodexHome?: string): Promise<HostResult> {
  await mkdir(dirname(request.finalPath), { recursive: true });
  const args = host === "claude" ? buildClaudeArgs(request) : buildCodexArgs(request);
  const executable = command.includes("/") ? command : Bun.which(command) ?? command;
  const isolated = host === "codex" && (request.contextMode ?? "isolated") !== "live" && !request.env?.CODEX_HOME ? await createIsolatedCodexHome(sourceCodexHome) : null;
  try {
    // The inherited marker blocks nested startup; the child restores CLAUDECODE=1 for its own tools.
    const hostEnv = { ...request.env, ...(isolated ? { CODEX_HOME: isolated.path } : {}), ...(host === "claude" ? { CLAUDECODE: undefined } : {}) };
    const processResult = await runProcess({
      command: executable,
      args,
      cwd: request.cwd,
      input: request.prompt,
      timeoutMs: request.timeoutMs,
      env: hostEnv,
      stdoutPath: request.eventPath,
      stderrPath: request.stderrPath,
    });
    const parsed = jsonLines(processResult.stdout);
    if (host === "claude") await preserveClaudeBackgroundResults(parsed.events, request.eventPath, hostEnv);
    let finalText = "";
    if (host === "claude") {
      for (const event of parsed.events) {
        if (event.type === "result" && typeof event.result === "string") finalText = event.result;
      }
      await writeFile(request.finalPath, finalText);
    } else {
      try { finalText = await readFile(request.finalPath, "utf8"); } catch { finalText = ""; }
    }
    finalText = redactSecrets(finalText, hostEnv);
    await writeFile(request.finalPath, finalText);
    const runtimeProfile = effectiveRuntimeProfile(host, request);
    const hostResult: HostResult = {
      host,
      exit_code: processResult.exitCode,
      timed_out: processResult.timedOut,
      malformed_events: parsed.malformed,
      final_text: finalText,
      duration_ms: processResult.durationMs,
      usage: usageFrom(parsed.events),
      event_path: request.eventPath,
      stderr_path: request.stderrPath,
      final_path: request.finalPath,
      command: executable,
      args,
      model: runtimeProfile.model,
      reasoning_effort: runtimeProfile.reasoning_effort,
      runtime_profile: runtimeProfile,
      metrics: metricsFrom(parsed.events),
    };
    await writeFile(`${request.finalPath}.host-result.json`, `${JSON.stringify(hostResult, null, 2)}\n`);
    return hostResult;
  } finally {
    await isolated?.cleanup();
  }
}

export function createHostAdapters(options: HostAdapterOptions = {}): Record<HostName, HostAdapter> {
  const claudeCommand = options.commands?.claude ?? "claude";
  const codexCommand = options.commands?.codex ?? "codex";
  return {
    claude: { name: "claude", execute: (request) => execute("claude", claudeCommand, request) },
    codex: { name: "codex", execute: (request) => execute("codex", codexCommand, request, options.codexHome) },
  };
}
