import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaudeArgs, buildCodexArgs, createHostAdapters } from "../skills/skill-eval/scripts/lib/hosts.ts";
import { redactSecrets, runProcess, terminateProcessTree } from "../skills/skill-eval/scripts/lib/process.ts";

async function executable(root: string, name: string, script: string): Promise<string> {
  const path = join(root, name);
  await writeFile(path, `#!/bin/sh\nset -eu\n${script}\n`);
  await chmod(path, 0o755);
  return path;
}

describe("host adapters", () => {
  test("terminates the detached POSIX process group", () => {
    let groupPid: number | undefined;
    let fallbackCalled = false;
    const handle = { pid: 4321, kill: () => { fallbackCalled = true; } } as unknown as Bun.Subprocess;
    terminateProcessTree(handle, "linux", (pid) => { groupPid = pid; return true; });
    expect(groupPid).toBe(-4321);
    expect(fallbackCalled).toBe(false);
  });

  test("redacts credentials from process transcripts and host final output", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-eval-redaction-"));
    const secret = "secret-value-that-must-not-persist";
    const echo = await executable(root, "echo-secret", `
cat >/dev/null
printf '%s\\n' "$TEST_API_KEY"
printf '%s\\n' "$TEST_API_KEY" >&2
`);
    const result = await runProcess({
      command: echo, args: [], cwd: root, input: "", timeoutMs: 5_000,
      env: { TEST_API_KEY: secret }, stdoutPath: join(root, "stdout.txt"), stderrPath: join(root, "stderr.txt"),
    });

    expect(result.stdout).toBe("[REDACTED]\n");
    expect(result.stderr).toBe("[REDACTED]\n");
    expect(await readFile(join(root, "stdout.txt"), "utf8")).not.toContain(secret);
    expect(redactSecrets(`Bearer abcdefghijklmnop ${secret}`, { TEST_API_KEY: secret })).toBe("[REDACTED] [REDACTED]");

    const codex = await executable(root, "fake-codex-secret", `
final=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; final="$1"; fi
  shift || true
done
cat >/dev/null
printf '%s' "$TEST_API_KEY" > "$final"
printf '%s\\n' '{"type":"turn.completed"}'
`);
    const adapter = createHostAdapters({ commands: { codex } }).codex;
    const hostResult = await adapter.execute({
      cwd: root, prompt: "task", eventPath: join(root, "events.jsonl"), stderrPath: join(root, "host.err"),
      finalPath: join(root, "final.md"), timeoutMs: 5_000, env: { TEST_API_KEY: secret },
    });
    expect(hostResult.final_text).toBe("[REDACTED]");
    expect(await readFile(join(root, "final.md"), "utf8")).toBe("[REDACTED]");
  });

  test("builds isolated Claude and Codex headless commands", () => {
    const claude = buildClaudeArgs({ finalPath: "/tmp/final.md", model: "claude-test" });
    const defaultClaude = buildClaudeArgs({ finalPath: "/tmp/final.md" });
    const codex = buildCodexArgs({ cwd: "/tmp/work", finalPath: "/tmp/final.md", model: "codex-test" });
    const defaultCodex = buildCodexArgs({ cwd: "/tmp/work", finalPath: "/tmp/final.md" });

    expect(claude).toContain("--safe-mode");
    expect(claude).toContain("--disable-slash-commands");
    expect(claude[claude.indexOf("--setting-sources") + 1]).toBe("");
    expect(claude[claude.indexOf("--permission-mode") + 1]).toBe("auto");
    expect(claude).not.toContain("bypassPermissions");
    expect(claude).toContain("stream-json");
    expect(claude).toContain("claude-test");
    expect(defaultClaude[defaultClaude.indexOf("--model") + 1]).toBe("claude-opus-4-8");
    expect(defaultClaude[defaultClaude.indexOf("--effort") + 1]).toBe("high");
    expect(codex).toContain("--ephemeral");
    expect(codex).toContain("--ignore-user-config");
    expect(codex).toContain("workspace-write");
    expect(codex).toContain("/tmp/final.md");
    expect(codex).toContain("codex-test");
    expect(defaultCodex[defaultCodex.indexOf("--model") + 1]).toBe("gpt-5.6-sol");
    expect(defaultCodex).toContain('model_reasoning_effort="high"');
    expect(() => buildCodexArgs({ cwd: "/tmp/work", finalPath: "/tmp/final.md", reasoningEffort: 'high" -c sandbox_mode="danger-full-access' })).toThrow("invalid reasoning effort");
    expect(() => buildClaudeArgs({ finalPath: "/tmp/final.md", reasoningEffort: "extreme" })).toThrow("invalid reasoning effort");
  });

  test("applies explicit reasoning effort and records the effective runtime profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-eval-runtime-profile-"));
    const codex = await executable(root, "fake-codex-profile", `
final=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; final="$1"; fi
  shift || true
done
cat >/dev/null
printf '%s' 'done' > "$final"
printf '%s\n' '{"type":"turn.completed"}'
`);
    const result = await createHostAdapters({ commands: { codex } }).codex.execute({
      cwd: root,
      prompt: "task",
      eventPath: join(root, "events.jsonl"),
      stderrPath: join(root, "stderr.txt"),
      finalPath: join(root, "final.md"),
      timeoutMs: 5_000,
      model: "codex-behavior-floor",
      reasoningEffort: "medium",
      role: "behavior",
      contextMode: "project-context",
      capabilities: ["skill-source-injection", "artifact-write"],
    });

    expect(result.args).toContain('model_reasoning_effort="medium"');
    expect(result.reasoning_effort).toBe("medium");
    expect(result.runtime_profile).toEqual({
      role: "behavior",
      host: "codex",
      model: "codex-behavior-floor",
      reasoning_effort: "medium",
      context_mode: "project-context",
      capabilities: ["skill-source-injection", "artifact-write"],
    });
  });

  test("expands host context only when the suite requests it", () => {
    const projectClaude = buildClaudeArgs({ finalPath: "/tmp/final.md", contextMode: "project-context" });
    const projectCodex = buildCodexArgs({ cwd: "/tmp/work", finalPath: "/tmp/final.md", contextMode: "project-context" });
    const liveClaude = buildClaudeArgs({ finalPath: "/tmp/final.md", contextMode: "live" });
    const liveCodex = buildCodexArgs({ cwd: "/tmp/work", finalPath: "/tmp/final.md", contextMode: "live" });

    expect(projectClaude[projectClaude.indexOf("--setting-sources") + 1]).toBe("project");
    expect(projectClaude).not.toContain("--safe-mode");
    expect(projectClaude).toContain("--disable-slash-commands");
    expect(projectCodex).not.toContain("--ignore-rules");
    expect(projectCodex).toContain("--ignore-user-config");
    expect(liveClaude).not.toContain("--safe-mode");
    expect(liveClaude).toContain("--disable-slash-commands");
    expect(liveClaude).not.toContain("--strict-mcp-config");
    expect(liveCodex).not.toContain("--ignore-user-config");
    expect(liveCodex).not.toContain("--ignore-rules");
  });

  test("normalizes Claude and Codex JSONL usage and final output", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-eval-hosts-"));
    const claude = await executable(root, "fake-claude", `
cat >/dev/null
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}'
printf '%s\\n' '{"type":"result","result":"claude final","duration_ms":42,"total_cost_usd":0.01,"usage":{"input_tokens":10,"output_tokens":5}}'
`);
    const codex = await executable(root, "fake-codex", `
final=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; final="$1"; fi
  shift || true
done
cat >/dev/null
printf '%s' 'codex final' > "$final"
printf '%s\\n' '{"type":"thread.started","thread_id":"abc"}'
printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":7,"cached_input_tokens":2}}'
`);
    const adapters = createHostAdapters({ commands: { claude, codex } });
    const cwd = join(root, "work");
    await mkdir(cwd);
    const claudeResult = await adapters.claude.execute({
      cwd, prompt: "task", eventPath: join(root, "claude.jsonl"), stderrPath: join(root, "claude.err"),
      finalPath: join(root, "claude.md"), timeoutMs: 5_000, model: "claude-test",
    });
    const codexResult = await adapters.codex.execute({
      cwd, prompt: "task", eventPath: join(root, "codex.jsonl"), stderrPath: join(root, "codex.err"),
      finalPath: join(root, "codex.md"), timeoutMs: 5_000,
    });

    expect(claudeResult.final_text).toBe("claude final");
    expect(claudeResult.usage.total_tokens).toBe(15);
    expect(claudeResult.usage.cost_usd).toBe(0.01);
    expect(claudeResult.metrics?.tool_calls).toBeGreaterThanOrEqual(0);
    expect(claudeResult.model).toBe("claude-test");
    expect(claudeResult.reasoning_effort).toBe("high");
    expect(claudeResult.args).toContain("claude-test");
    expect(codexResult.final_text).toBe("codex final");
    expect(codexResult.usage.total_tokens).toBe(19);
    expect(codexResult.metrics?.tool_calls).toBeGreaterThanOrEqual(0);
    expect(codexResult.model).toBe("gpt-5.6-sol");
    expect(codexResult.reasoning_effort).toBe("high");
    expect(codexResult.args).toContain('model_reasoning_effort="high"');
    expect(JSON.parse(await readFile(join(root, "codex.md.host-result.json"), "utf8"))).toMatchObject({ model: "gpt-5.6-sol", reasoning_effort: "high" });
    expect(await readFile(join(root, "codex.jsonl"), "utf8")).toContain("turn.completed");
  });

  test("preserves completed Claude background output as a durable tool result", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-eval-background-result-"));
    const taskRoot = join(tmpdir(), "claude-test", "session", "tasks");
    await mkdir(taskRoot, { recursive: true });
    const output = join(taskRoot, "peer.output");
    await writeFile(output, "[cross-model-doc] wrote 3 finding(s)\n");
    const claude = await executable(root, "fake-claude-background", `
cat >/dev/null
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Bash","input":{"command":"run peer"}}]}}'
printf '%s\n' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":"Command running in background"}]}}'
printf '%s\n' '{"type":"system","subtype":"task_notification","task_id":"task-1","tool_use_id":"tool-1","status":"completed","output_file":"${output}"}'
printf '%s\n' '{"type":"result","result":"done"}'
`);
    const adapter = createHostAdapters({ commands: { claude } }).claude;
    const eventPath = join(root, "events.jsonl");
    await adapter.execute({ cwd: root, prompt: "task", eventPath, stderrPath: join(root, "stderr"), finalPath: join(root, "final"), timeoutMs: 5_000 });

    const events = await readFile(eventPath, "utf8");
    expect(events).toContain("claude_background_task_output");
    expect(events).toContain("wrote 3 finding(s)");
    expect(events).toContain('"tool_use_id":"tool-1"');
  });

  test("does not follow symlinked Claude background output", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-eval-background-symlink-"));
    const taskRoot = join(tmpdir(), "claude-test", "symlink-session", "tasks");
    await mkdir(taskRoot, { recursive: true });
    const secret = join(root, "secret.txt");
    const output = join(taskRoot, "peer.output");
    await writeFile(secret, "must-not-enter-evidence\n");
    await rm(output, { force: true });
    await symlink(secret, output);
    const claude = await executable(root, "fake-claude-symlink", `
cat >/dev/null
printf '%s\n' '{"type":"system","subtype":"task_notification","task_id":"task-1","tool_use_id":"tool-1","status":"completed","output_file":"${output}"}'
printf '%s\n' '{"type":"result","result":"done"}'
`);
    const eventPath = join(root, "events.jsonl");
    await createHostAdapters({ commands: { claude } }).claude.execute({ cwd: root, prompt: "task", eventPath, stderrPath: join(root, "stderr"), finalPath: join(root, "final"), timeoutMs: 5_000 });

    expect(await readFile(eventPath, "utf8")).not.toContain("must-not-enter-evidence");
    expect(await readFile(eventPath, "utf8")).not.toContain("claude_background_task_output");
  });

  test("kills a host process after the configured timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-eval-timeout-"));
    const slow = await executable(root, "slow-claude", "cat >/dev/null; sleep 5 & wait");
    const adapters = createHostAdapters({ commands: { claude: slow } });
    const result = await adapters.claude.execute({
      cwd: root, prompt: "task", eventPath: join(root, "events.jsonl"), stderrPath: join(root, "stderr.txt"),
      finalPath: join(root, "final.md"), timeoutMs: 30,
    });
    expect(result.timed_out).toBe(true);
    expect(result.exit_code).not.toBe(0);
  });

  test("uses an auth-only temporary Codex home and removes it afterward", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-eval-codex-home-"));
    const sourceHome = join(root, "source-home");
    await mkdir(sourceHome);
    await writeFile(join(sourceHome, "auth.json"), "{}\n");
    const codex = await executable(root, "fake-codex-home", `
final=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; final="$1"; fi
  shift || true
done
cat >/dev/null
printf '%s' "$CODEX_HOME" > "$final"
printf '%s\\n' '{"type":"turn.completed"}'
`);
    const adapters = createHostAdapters({ commands: { codex }, codexHome: sourceHome });
    const result = await adapters.codex.execute({
      cwd: root, prompt: "task", eventPath: join(root, "home.jsonl"), stderrPath: join(root, "home.err"),
      finalPath: join(root, "home.md"), timeoutMs: 5_000,
    });
    expect(result.final_text).not.toBe(sourceHome);
    expect(result.final_text).toContain("skill-eval-codex-home-");
    await expect(stat(result.final_text)).rejects.toThrow();
  });
});
