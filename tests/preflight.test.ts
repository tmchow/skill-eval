import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandProbe, preflight } from "../skills/skill-eval/scripts/lib/preflight.ts";
import type { CommandProbe } from "../skills/skill-eval/scripts/lib/types.ts";

async function targetSkill(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skill-eval-preflight-"));
  const target = join(root, "skills", "demo");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n\n# Demo\n");
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  return target;
}

function probe(overrides: Record<string, { exitCode: number; stdout?: string; stderr?: string }> = {}): CommandProbe {
  return async (command, args) => {
    const key = [command, ...args].join(" ");
    const value = overrides[key];
    if (value) return { stdout: value.stdout ?? "", stderr: value.stderr ?? "", ...value };
    if (key === "bun --version") return { exitCode: 0, stdout: "1.3.14\n", stderr: "" };
    if (key === "git --version") return { exitCode: 0, stdout: "git version 2.55.0\n", stderr: "" };
    if (command === "git" && args[0] === "-C") {
      const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe" });
      return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
    }
    if (key === "claude --version") return { exitCode: 0, stdout: "2.1.205\n", stderr: "" };
    if (key === "claude auth status") return { exitCode: 0, stdout: '{"loggedIn":true}', stderr: "" };
    if (key === "claude plugin eval --help") return { exitCode: 0, stdout: "Usage: claude plugin eval", stderr: "" };
    if (key === "codex --version") return { exitCode: 0, stdout: "codex-cli 0.144.0\n", stderr: "" };
    if (key === "codex login status") return { exitCode: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
    return { exitCode: 127, stdout: "", stderr: "not found" };
  };
}

describe("preflight", () => {
  test("bounds dependency and host probes", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-eval-slow-probe-"));
    const command = join(root, "slow");
    await writeFile(command, "#!/bin/sh\nsleep 5\n");
    await chmod(command, 0o755);

    const result = await createCommandProbe(25)(command, []);

    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain("timed out");
  });

  test("reports both authenticated hosts and native Claude capability", async () => {
    const report = await preflight(await targetSkill(), {
      invokingHost: "codex",
      requestedHosts: ["claude", "codex"],
      probe: probe(),
    });

    expect(report.ready).toBe(true);
    expect(report.coverage).toBe("full");
    expect(report.hosts.claude.ready).toBe(true);
    expect(report.hosts.codex.ready).toBe(true);
    expect(report.hosts.claude.capabilities.native_plugin_eval).toBe(true);
  });

  test("resolves a bare skill name from the repository skills directory", async () => {
    const target = await targetSkill();
    const root = join(target, "..", "..");
    const report = await preflight("demo", {
      invokingHost: "codex",
      requestedHosts: ["codex"],
      probe: probe(),
      cwd: root,
    });

    expect(report.ready).toBe(true);
    expect(report.target_path).toBe(await realpath(target));
  });

  test("degrades when the secondary host is unavailable", async () => {
    const report = await preflight(await targetSkill(), {
      invokingHost: "codex",
      requestedHosts: ["claude", "codex"],
      probe: probe({ "claude --version": { exitCode: 127, stderr: "not found" } }),
    });

    expect(report.ready).toBe(true);
    expect(report.coverage).toBe("degraded");
    expect(report.hosts.claude.remediation).toContain("@anthropic-ai/claude-code");
  });

  test("blocks when the invoking host is not authenticated", async () => {
    const report = await preflight(await targetSkill(), {
      invokingHost: "codex",
      requestedHosts: ["codex"],
      probe: probe({ "codex login status": { exitCode: 1, stderr: "Not logged in" } }),
    });

    expect(report.ready).toBe(false);
    expect(report.blocked.map((check) => check.id)).toContain("host.codex.auth");
    expect(report.hosts.codex.remediation).toBe("codex login");
  });

  test("blocks malformed target frontmatter before host calls matter", async () => {
    const target = await targetSkill();
    await writeFile(join(target, "SKILL.md"), "# Missing frontmatter\n");

    const report = await preflight(target, {
      invokingHost: "codex",
      requestedHosts: ["codex"],
      probe: probe(),
    });

    expect(report.ready).toBe(false);
    expect(report.blocked.map((check) => check.id)).toContain("target.skill");
  });

  test("blocks a valid skill that is not inside a Git repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-eval-no-repo-"));
    await writeFile(join(root, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n# Demo\n");
    const report = await preflight(root, { invokingHost: "codex", requestedHosts: ["codex"], probe: probe() });
    expect(report.ready).toBe(false);
    expect(report.blocked.map((check) => check.id)).toContain("target.repository");
  });

  test("warns when an unreferenced evaluator specification could leak into executor context", async () => {
    const target = await targetSkill();
    await mkdir(join(target, "references"), { recursive: true });
    await writeFile(join(target, "references", "cross-model-eval.md"), "# Expected evaluation cases\n");

    const report = await preflight(target, { invokingHost: "codex", requestedHosts: ["codex"], probe: probe() });

    expect(report.ready).toBe(true);
    expect(report.degraded.find((item) => item.id === "target.evaluator-files")?.message).toContain("references/cross-model-eval.md");
  });
});
