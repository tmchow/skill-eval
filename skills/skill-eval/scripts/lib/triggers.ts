import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createIsolatedCodexHome } from "./hosts.ts";
import { copyTree, readJson, reserveArtifactDir, writeJson } from "./json.ts";
import { redactSecrets, terminateProcessTree } from "./process.ts";
import { loadRun, loadSuite, verifyRunIntegrity } from "./workspace.ts";
import type { EvidencePartition, HostName, TriggerResult } from "./types.ts";

export interface TriggerProbeRequest {
  query: string;
  skillName: string;
  skillPath: string;
  workDir: string;
  timeoutMs: number;
  model?: string;
}

export type TriggerProbe = (host: HostName, request: TriggerProbeRequest) => Promise<Omit<TriggerResult, "schema_version" | "attempt_id" | "partition" | "created_at" | "host" | "version" | "query_id" | "should_trigger" | "repetition">>;

export interface TriggerSuiteOptions {
  runDir: string;
  version: string;
  hosts: HostName[];
  repetitions?: number;
  timeoutMs?: number;
  probe?: TriggerProbe;
  attemptId?: string;
  partition?: EvidencePartition | "all";
  queryIds?: string[];
  concurrency?: number;
  models?: Partial<Record<HostName, string>>;
}

function createAttemptId(value?: string): string {
  const id = value ?? `trigger-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error("attempt id must contain only letters, digits, dot, underscore, or hyphen");
  return id;
}

async function mapLimit<T, R>(items: T[], limit: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await operation(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()));
  return results;
}

export function eventShowsTrigger(host: HostName, event: unknown, skillName: string, skillPath: string): boolean {
  if (!event || typeof event !== "object") return false;
  const value = event as Record<string, any>;
  if (host === "claude") {
    const content = value.message?.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item?.type === "tool_use" && item?.name === "Skill") {
          const invoked = String(item?.input?.skill ?? "").split(":").at(-1);
          if (invoked === skillName) return true;
        }
      }
    }
    const block = value.event?.content_block;
    if (block?.type === "tool_use" && block?.name === "Skill") {
      const invoked = String(block?.input?.skill ?? "").split(":").at(-1);
      if (invoked === skillName) return true;
    }
  }
  const normalized = JSON.stringify(value).replaceAll("\\", "/");
  const normalizedPath = skillPath.replaceAll("\\", "/");
  return normalized.includes(`/skills/${skillName}/SKILL.md`) || normalized.includes(`${normalizedPath}/SKILL.md`);
}

interface TriggerProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  input: string;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
  eventPath: string;
  stderrPath: string;
  host: HostName;
  skillName: string;
  skillPath: string;
}

async function runUntilTrigger(request: TriggerProcessRequest): Promise<{ exitCode: number; triggered: boolean; timedOut: boolean; stderr: string }> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...request.env })) if (value !== undefined) env[key] = value;
  let processHandle: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    processHandle = Bun.spawn([request.command, ...request.args], {
      cwd: request.cwd,
      detached: process.platform !== "win32",
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(request.eventPath, "");
    const safeMessage = redactSecrets(message, request.env);
    await writeFile(request.stderrPath, safeMessage);
    return { exitCode: 127, triggered: false, timedOut: false, stderr: safeMessage };
  }
  processHandle.stdin.write(request.input);
  processHandle.stdin.end();
  const stderrPromise = new Response(processHandle.stderr).text();
  const reader = processHandle.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  let triggered = false;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    terminateProcessTree(processHandle);
  }, request.timeoutMs);
  while (!triggered) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      raw += `${line}\n`;
      try {
        if (eventShowsTrigger(request.host, JSON.parse(line), request.skillName, request.skillPath)) {
          triggered = true;
          terminateProcessTree(processHandle);
          break;
        }
      } catch {
        // Preserve malformed lines as evidence; they do not prove triggering.
      }
    }
  }
  raw += buffer + decoder.decode();
  const exitCode = await processHandle.exited;
  clearTimeout(timer);
  const safeRaw = redactSecrets(raw, request.env);
  const stderr = redactSecrets(await stderrPromise, request.env);
  await writeFile(request.eventPath, safeRaw);
  await writeFile(request.stderrPath, stderr);
  return { exitCode, triggered, timedOut, stderr };
}

async function defaultTriggerProbe(host: HostName, request: TriggerProbeRequest) {
  await mkdir(request.workDir, { recursive: true });
  const eventPath = join(request.workDir, "events.jsonl");
  const stderrPath = join(request.workDir, "stderr.txt");
  const started = performance.now();
  let result: Awaited<ReturnType<typeof runUntilTrigger>>;
  if (host === "claude") {
    const pluginRoot = join(request.workDir, "plugin");
    await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
    await writeJson(join(pluginRoot, ".claude-plugin", "plugin.json"), { name: "skill-eval-probe", version: "0.0.0", description: "isolated trigger probe" });
    await copyTree(request.skillPath, join(pluginRoot, "skills", request.skillName));
    result = await runUntilTrigger({
      command: "claude",
      args: ["--plugin-dir", pluginRoot, "--setting-sources", "", "--strict-mcp-config", "--permission-mode", "dontAsk", "--tools", "Skill,Read", "--output-format", "stream-json", "--verbose", "--no-session-persistence", ...(request.model ? ["--model", request.model] : []), "-p"],
      cwd: request.workDir,
      input: request.query,
      timeoutMs: request.timeoutMs,
      eventPath,
      stderrPath,
      env: { CLAUDECODE: undefined },
      host,
      skillName: request.skillName,
      skillPath: join(pluginRoot, "skills", request.skillName),
    });
  } else {
    const isolatedHome = await createIsolatedCodexHome();
    try {
      await copyTree(request.skillPath, join(isolatedHome.path, "skills", request.skillName));
      result = await runUntilTrigger({
        command: "codex",
        args: ["exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only", "--skip-git-repo-check", ...(request.model ? ["--model", request.model] : []), "-C", request.workDir, "-"],
        cwd: request.workDir,
        input: request.query,
        timeoutMs: request.timeoutMs,
        env: { CODEX_HOME: isolatedHome.path },
        eventPath,
        stderrPath,
        host,
        skillName: request.skillName,
        skillPath: join(isolatedHome.path, "skills", request.skillName),
      });
    } finally {
      await isolatedHome.cleanup();
    }
  }
  return {
    triggered: result.triggered,
    duration_ms: performance.now() - started,
    event_path: eventPath,
    error: result.triggered || result.exitCode === 0 ? null : result.stderr || (result.timedOut ? "timeout" : `exit ${result.exitCode}`),
  };
}

export async function runTriggerSuite(options: TriggerSuiteOptions): Promise<TriggerResult[]> {
  if (options.hosts.length === 0) throw new Error("trigger execution requires at least one host");
  const runDir = resolve(options.runDir);
  await verifyRunIntegrity(runDir);
  const state = await loadRun(runDir);
  const suite = await loadSuite(runDir);
  const version = state.versions[options.version];
  if (!version) throw new Error(`unknown version: ${options.version}`);
  const id = createAttemptId(options.attemptId);
  let previous: TriggerResult[] = [];
  try { previous = await readJson<TriggerResult[]>(join(runDir, "triggers.json")); } catch { /* first trigger run */ }
  if (previous.some((record) => record.attempt_id === id)) throw new Error(`attempt id already exists: ${id}`);
  const probe = options.probe ?? defaultTriggerProbe;
  const partition = options.partition ?? "training";
  const queries = (suite.trigger_queries ?? []).filter((query) => {
    if (options.queryIds && !options.queryIds.includes(query.id)) return false;
    if (partition === "all") return true;
    return partition === (query.holdout ? "holdout" : "training");
  });
  if (queries.length === 0) throw new Error(`no ${partition} trigger queries selected`);
  const tasks: Array<{ query: typeof queries[number]; host: HostName; repetition: number }> = [];
  for (const query of queries) {
    for (const host of options.hosts) {
      for (let repetition = 1; repetition <= (options.repetitions ?? 3); repetition += 1) {
        tasks.push({ query, host, repetition });
      }
    }
  }
  const attemptRoot = join(runDir, "artifacts", "triggers", id);
  await reserveArtifactDir(attemptRoot);
  const manifestPath = join(attemptRoot, "attempt.json");
  const manifest = {
    schema_version: 1, attempt_id: id, kind: "trigger", status: "started", created_at: new Date().toISOString(),
    partition, version: options.version, hosts: [...options.hosts], query_ids: queries.map((item) => item.id),
    repetitions: options.repetitions ?? 3, planned_records: tasks.length,
  };
  await writeJson(manifestPath, manifest);
  const results = await mapLimit(tasks, options.concurrency ?? 6, async ({ query, host, repetition }): Promise<TriggerResult> => {
    const workDir = join(runDir, "artifacts", "triggers", id, options.version, host, query.id, `run-${repetition}`);
    const outcome = await probe(host, { query: query.query, skillName: state.skill_name, skillPath: version.path, workDir, timeoutMs: options.timeoutMs ?? 60_000, model: options.models?.[host] });
    return { schema_version: 1, attempt_id: id, partition: query.holdout ? "holdout" : "training", created_at: new Date().toISOString(), host, version: options.version, query_id: query.id, should_trigger: query.should_trigger, repetition, ...outcome };
  });
  await writeJson(join(runDir, "triggers.json"), [...previous, ...results]);
  await writeJson(manifestPath, { ...manifest, status: "complete", completed_at: new Date().toISOString(), record_count: results.length });
  return results;
}

export function summarizeTriggers(results: TriggerResult[]) {
  const truePositive = results.filter((item) => item.should_trigger && item.triggered).length;
  const falseNegative = results.filter((item) => item.should_trigger && !item.triggered).length;
  const falsePositive = results.filter((item) => !item.should_trigger && item.triggered).length;
  const trueNegative = results.filter((item) => !item.should_trigger && !item.triggered).length;
  const groups = new Map<string, TriggerResult[]>();
  for (const item of results) {
    const key = `${item.host}:${item.query_id}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const queries = [...groups.entries()].map(([key, items]) => {
    const triggerRate = items.filter((item) => item.triggered).length / items.length;
    const shouldTrigger = items[0]!.should_trigger;
    return { key, host: items[0]!.host, query_id: items[0]!.query_id, should_trigger: shouldTrigger, trigger_rate: triggerRate, passed: shouldTrigger ? triggerRate >= 0.5 : triggerRate < 0.5, stable: triggerRate === 0 || triggerRate === 1 };
  });
  return {
    true_positive: truePositive,
    false_negative: falseNegative,
    false_positive: falsePositive,
    true_negative: trueNegative,
    precision: truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : null,
    recall: truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : null,
    false_trigger_rate: falsePositive + trueNegative > 0 ? falsePositive / (falsePositive + trueNegative) : null,
    accuracy: queries.length > 0 ? queries.filter((item) => item.passed).length / queries.length : null,
    stability: queries.length > 0 ? queries.filter((item) => item.stable).length / queries.length : null,
    queries,
  };
}
