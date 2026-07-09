import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRun, verifyRunIntegrity } from "../skills/skill-eval/scripts/lib/workspace.ts";

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

async function fixtureRepo(tracked: boolean): Promise<{ root: string; target: string; suitePath: string }> {
  const root = await mkdtemp(join(tmpdir(), "skill-eval-workspace-"));
  const target = join(root, "skills", "demo");
  const suiteDir = join(root, "eval-authoring");
  await mkdir(target, { recursive: true });
  await mkdir(join(suiteDir, "fixtures", "case"), { recursive: true });
  await writeFile(join(target, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n\n# Original\n");
  await mkdir(join(target, "scripts"), { recursive: true });
  await writeFile(join(target, "scripts", "probe.sh"), "#!/bin/sh\necho probe\n");
  await chmod(join(target, "scripts", "probe.sh"), 0o755);
  await writeFile(join(suiteDir, "fixtures", "case", "input.txt"), "fixture-v1\n");
  const suitePath = join(suiteDir, "suite.json");
  await writeFile(suitePath, JSON.stringify({
    schema_version: 1,
    skill_name: "demo",
    hypothesis: "The revision improves the output.",
    evals: [{
      id: "case",
      name: "Case",
      purpose: "improvement",
      severity: "critical",
      prompt: "Create result.txt.",
      fixture: "fixtures/case",
      expectations: [{ id: "result", text: "result exists", severity: "critical", check: { type: "file_exists", path: "result.txt" } }],
    }],
  }));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  if (tracked) {
    git(root, ["add", "skills/demo"]);
    git(root, ["commit", "-qm", "initial skill"]);
    await writeFile(join(target, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n\n# Authored\n");
  }
  return { root, target, suitePath };
}

describe("run preparation", () => {
  test("freezes HEAD, authored bytes, and fixture copies for a tracked skill", async () => {
    const fixture = await fixtureRepo(true);
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const state = await prepareRun({
      targetPath: fixture.target,
      suitePath: fixture.suitePath,
      hosts: ["claude", "codex"],
      invokingHost: "codex",
      runRoot,
      runId: "run-1",
    });

    expect(state.anchor.kind).toBe("git");
    expect(await readFile(join(state.run_dir, "versions", "anchor", "SKILL.md"), "utf8")).toContain("# Original");
    expect(await readFile(join(state.run_dir, "versions", "authored", "SKILL.md"), "utf8")).toContain("# Authored");
    expect((await stat(join(state.run_dir, "versions", "anchor", "scripts", "probe.sh"))).mode & 0o111).not.toBe(0);
    expect(await readFile(join(state.run_dir, "fixtures", "case", "input.txt"), "utf8")).toBe("fixture-v1\n");
    expect(state.hashes.versions.anchor).not.toBe(state.hashes.versions.authored);
    expect(state.git.initial_clean).toBe(false);
    expect(state.host_metadata?.claude?.version).toBeDefined();
  });

  test("uses a no-skill anchor when the target is untracked", async () => {
    const fixture = await fixtureRepo(false);
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const state = await prepareRun({
      targetPath: fixture.target,
      suitePath: fixture.suitePath,
      hosts: ["codex"],
      invokingHost: "codex",
      runRoot,
      runId: "run-2",
    });

    expect(state.anchor.kind).toBe("none");
    expect(state.hashes.versions.anchor).toBeNull();
  });

  test("rejects suite, fixture, or version mutation after freezing", async () => {
    const fixture = await fixtureRepo(true);
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const state = await prepareRun({ targetPath: fixture.target, suitePath: fixture.suitePath, hosts: ["codex"], invokingHost: "codex", runRoot, runId: "integrity" });
    await verifyRunIntegrity(state.run_dir);
    await writeFile(join(state.run_dir, "fixtures", "case", "input.txt"), "tampered\n");
    await expect(verifyRunIntegrity(state.run_dir)).rejects.toThrow("fixture hash mismatch");
  });

  test("records unavailable host binaries without failing preparation", async () => {
    const fixture = await fixtureRepo(false);
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const missingHost = "skill-eval-host-that-does-not-exist";
    const state = await prepareRun({ targetPath: fixture.target, suitePath: fixture.suitePath, hosts: [missingHost as any], invokingHost: "codex", runRoot, runId: "missing-host" });
    expect((state.host_metadata as any)[missingHost].version).toBeNull();
  });
});
