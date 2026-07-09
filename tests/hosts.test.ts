import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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
    const codex = buildCodexArgs({ cwd: "/tmp/work", finalPath: "/tmp/final.md", model: "codex-test" });

    expect(claude).toContain("--safe-mode");
    expect(claude).toContain("--disable-slash-commands");
    expect(claude).toContain("stream-json");
    expect(claude).toContain("claude-test");
    expect(codex).toContain("--ephemeral");
    expect(codex).toContain("--ignore-user-config");
    expect(codex).toContain("workspace-write");
    expect(codex).toContain("/tmp/final.md");
    expect(codex).toContain("codex-test");
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
    expect(claudeResult.args).toContain("claude-test");
    expect(codexResult.final_text).toBe("codex final");
    expect(codexResult.usage.total_tokens).toBe(19);
    expect(codexResult.metrics?.tool_calls).toBeGreaterThanOrEqual(0);
    expect(await readFile(join(root, "codex.jsonl"), "utf8")).toContain("turn.completed");
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
