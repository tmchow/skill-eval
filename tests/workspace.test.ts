import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistSuite, prepareRun, verifyRunIntegrity } from "../skills/skill-eval/scripts/lib/workspace.ts";
import { createCampaign, loadCampaign } from "../skills/skill-eval/scripts/lib/campaign.ts";

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function gitOutput(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
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
    schema_version: 2,
    claim_class: "conformance",
    environment: { fidelity: "isolated", external_state: [] },
    skill_name: "demo",
    hypothesis: "The revision improves the output.",
    evals: [{
      id: "case",
      name: "Case",
      purpose: "improvement",
      severity: "critical",
      prompt: "Create result.txt.",
      fixture: "fixtures/case",
      expectations: [{ id: "result", text: "result exists", severity: "critical", evidence_role: "outcome", check: { type: "file_exists", path: "result.txt" } }],
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
  test("registers prepared runs with an evaluation campaign", async () => {
    const fixture = await fixtureRepo(true);
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const campaign = await createCampaign({ targetPath: fixture.target, measurementGoal: "The revision improves the output.", campaignRoot: join(runRoot, "campaigns"), campaignId: "linked" });
    const state = await prepareRun({
      targetPath: fixture.target, suitePath: fixture.suitePath, hosts: ["codex"], invokingHost: "codex", runRoot, runId: "campaign-run",
      campaignDir: campaign.campaign_dir, campaignRole: "calibration",
    });

    expect(state.campaign).toEqual({ campaign_dir: campaign.campaign_dir, role: "calibration", measurement_goal: "The revision improves the output." });
    expect((await loadCampaign(campaign.campaign_dir)).runs).toMatchObject([{ run_id: "campaign-run", role: "calibration" }]);
  });

  test("rejects dropped campaign cases before reserving an orphan run", async () => {
    const fixture = await fixtureRepo(true);
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const campaign = await createCampaign({ targetPath: fixture.target, measurementGoal: "The revision improves the output.", campaignRoot: join(runRoot, "campaigns"), campaignId: "continuity" });
    await prepareRun({ targetPath: fixture.target, suitePath: fixture.suitePath, hosts: ["codex"], invokingHost: "codex", runRoot, runId: "first", campaignDir: campaign.campaign_dir, campaignRole: "calibration" });
    const suite = JSON.parse(await readFile(fixture.suitePath, "utf8"));
    suite.evals = [];
    suite.trigger_queries = [{ id: "trigger", query: "Evaluate this skill", should_trigger: true }];
    await writeFile(fixture.suitePath, JSON.stringify(suite));

    await expect(prepareRun({ targetPath: fixture.target, suitePath: fixture.suitePath, hosts: ["codex"], invokingHost: "codex", runRoot, runId: "orphan", campaignDir: campaign.campaign_dir, campaignRole: "calibration" })).rejects.toThrow("dropped protected cases");
    await expect(stat(join(runRoot, "orphan"))).rejects.toThrow();
  });

  test("reuses the campaign's fixed anchor after HEAD moves", async () => {
    const fixture = await fixtureRepo(true);
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const campaign = await createCampaign({ targetPath: fixture.target, measurementGoal: "The revision improves the output.", campaignRoot: join(runRoot, "campaigns"), campaignId: "fixed-anchor" });
    const first = await prepareRun({ targetPath: fixture.target, suitePath: fixture.suitePath, hosts: ["codex"], invokingHost: "codex", runRoot, runId: "first-anchor", campaignDir: campaign.campaign_dir, campaignRole: "calibration" });
    git(fixture.root, ["add", "skills/demo"]);
    git(fixture.root, ["commit", "-qm", "commit authored skill"]);
    await writeFile(join(fixture.target, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n\n# Local follow-up\n");

    const second = await prepareRun({ targetPath: fixture.target, suitePath: fixture.suitePath, hosts: ["codex"], invokingHost: "codex", runRoot, runId: "second-anchor", campaignDir: campaign.campaign_dir, campaignRole: "calibration" });

    expect(second.anchor.commit).toBe(first.anchor.commit);
    expect(await readFile(join(second.run_dir, "versions", "anchor", "SKILL.md"), "utf8")).toContain("# Original");
    expect(await readFile(join(second.run_dir, "versions", "authored", "SKILL.md"), "utf8")).toContain("# Local follow-up");
  });

  test("rejects a suite hypothesis that differs from the confirmed campaign goal", async () => {
    const fixture = await fixtureRepo(true);
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const campaign = await createCampaign({ targetPath: fixture.target, measurementGoal: "A stricter goal added after confirmation.", campaignRoot: join(runRoot, "campaigns"), campaignId: "mismatch" });

    await expect(prepareRun({
      targetPath: fixture.target, suitePath: fixture.suitePath, hosts: ["codex"], invokingHost: "codex", runRoot, runId: "mismatched-run",
      campaignDir: campaign.campaign_dir, campaignRole: "calibration",
    })).rejects.toThrow("suite hypothesis must exactly match the confirmed campaign measurement goal");
    await expect(stat(join(runRoot, "mismatched-run"))).rejects.toThrow();
  });

  test("rejects an invalid campaign role before reserving the run directory", async () => {
    const fixture = await fixtureRepo(true);
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const campaign = await createCampaign({ targetPath: fixture.target, measurementGoal: "Measure the authored improvement.", campaignRoot: join(runRoot, "campaigns"), campaignId: "invalid-role" });

    await expect(prepareRun({
      targetPath: fixture.target, suitePath: fixture.suitePath, hosts: ["codex"], invokingHost: "codex", runRoot, runId: "should-not-exist",
      campaignDir: campaign.campaign_dir, campaignRole: "draft",
    })).rejects.toThrow("invalid campaign run role");
    await expect(stat(join(runRoot, "should-not-exist"))).rejects.toThrow();
  });

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

  test("records validated evaluator-only exclusions without deleting frozen source", async () => {
    const fixture = await fixtureRepo(true);
    await mkdir(join(fixture.target, "references"), { recursive: true });
    await writeFile(join(fixture.target, "references", "behavior-eval.md"), "# Private expected cases\n");
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));

    const state = await prepareRun({
      targetPath: fixture.target,
      suitePath: fixture.suitePath,
      hosts: ["codex"],
      invokingHost: "codex",
      runRoot,
      runId: "excluded-evaluator-file",
      executorExclusions: ["references/behavior-eval.md"],
    } as any);

    expect(state.executor_exclusions).toEqual(["references/behavior-eval.md"]);
    expect(await readFile(join(state.run_dir, "versions", "authored", "references", "behavior-eval.md"), "utf8")).toContain("Private expected cases");
    await expect(prepareRun({
      targetPath: fixture.target,
      suitePath: fixture.suitePath,
      hosts: ["codex"],
      invokingHost: "codex",
      runRoot,
      runId: "invalid-exclusion",
      executorExclusions: ["SKILL.md"],
    } as any)).rejects.toThrow("cannot exclude SKILL.md");
  });

  test("rejects a reused run id without overwriting frozen inputs", async () => {
    const fixture = await fixtureRepo(true);
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const options = { targetPath: fixture.target, suitePath: fixture.suitePath, hosts: ["codex" as const], invokingHost: "codex" as const, runRoot, runId: "immutable-run" };
    const state = await prepareRun(options);
    const original = await readFile(join(state.run_dir, "versions", "authored", "SKILL.md"), "utf8");
    await writeFile(join(fixture.target, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n\n# Replacement\n");

    await expect(prepareRun(options)).rejects.toThrow("artifact directory already exists");
    expect(await readFile(join(state.run_dir, "versions", "authored", "SKILL.md"), "utf8")).toBe(original);
  });

  test("persists reusable suites outside the target skill tree", async () => {
    const fixture = await fixtureRepo(true);
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const state = await prepareRun({ targetPath: fixture.target, suitePath: fixture.suitePath, hosts: ["codex"], invokingHost: "codex", runRoot, runId: "persist-boundary" });
    const skillBefore = await readFile(join(fixture.target, "SKILL.md"), "utf8");

    const result = await persistSuite(state.run_dir);

    expect(result.path).toBe(join(state.repo_root, ".skill-eval", "demo", "suite.json"));
    expect(await readFile(join(fixture.target, "SKILL.md"), "utf8")).toBe(skillBefore);
    expect(result.path.startsWith(`${state.target_path}/`)).toBe(false);
  });

  test("rejects symlinks that could change frozen skill bytes after preparation", async () => {
    const fixture = await fixtureRepo(true);
    const external = join(fixture.root, "mutable-reference.md");
    await writeFile(external, "original\n");
    await symlink(external, join(fixture.target, "mutable-reference.md"));
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));

    await expect(prepareRun({ targetPath: fixture.target, suitePath: fixture.suitePath, hosts: ["codex"], invokingHost: "codex", runRoot, runId: "symlinked" })).rejects.toThrow("symlinks are not allowed in frozen trees");
  });

  test("prepares a run from a bare repository skill name", async () => {
    const fixture = await fixtureRepo(true);
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const state = await prepareRun({
      targetPath: "demo",
      suitePath: fixture.suitePath,
      hosts: ["codex"],
      invokingHost: "codex",
      cwd: fixture.root,
      runRoot,
      runId: "bare-name",
    });

    expect(state.target_path).toBe(await realpath(fixture.target));
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

  test("freezes an explicit baseline before committed and local branch changes", async () => {
    const fixture = await fixtureRepo(true);
    const baseline = gitOutput(fixture.root, ["rev-parse", "HEAD"]);
    git(fixture.root, ["add", "skills/demo"]);
    git(fixture.root, ["commit", "-qm", "commit authored skill"]);
    await writeFile(join(fixture.target, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n\n# Local follow-up\n");

    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const state = await prepareRun({
      targetPath: fixture.target,
      suitePath: fixture.suitePath,
      hosts: ["codex"],
      invokingHost: "codex",
      anchorRef: baseline,
      runRoot,
      runId: "committed-and-local",
    });

    expect(state.anchor).toEqual({ kind: "git", ref: baseline, commit: baseline });
    expect(await readFile(join(state.run_dir, "versions", "anchor", "SKILL.md"), "utf8")).toContain("# Original");
    expect(await readFile(join(state.run_dir, "versions", "authored", "SKILL.md"), "utf8")).toContain("# Local follow-up");
  });

  test("uses a no-skill anchor when a committed branch introduces the target", async () => {
    const fixture = await fixtureRepo(false);
    await writeFile(join(fixture.root, "README.md"), "fixture\n");
    git(fixture.root, ["add", "README.md"]);
    git(fixture.root, ["commit", "-qm", "baseline"]);
    const baseline = gitOutput(fixture.root, ["rev-parse", "HEAD"]);
    git(fixture.root, ["add", "skills/demo"]);
    git(fixture.root, ["commit", "-qm", "add skill on branch"]);

    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    const state = await prepareRun({
      targetPath: fixture.target,
      suitePath: fixture.suitePath,
      hosts: ["codex"],
      invokingHost: "codex",
      anchorRef: baseline,
      runRoot,
      runId: "new-skill-on-branch",
    });

    expect(state.anchor).toEqual({ kind: "none", ref: baseline, commit: baseline });
    expect(state.hashes.versions.anchor).toBeNull();
    expect(state.git.target_tracked).toBe(true);
    expect(await readFile(join(state.run_dir, "versions", "authored", "SKILL.md"), "utf8")).toContain("# Original");
  });

  test("rejects an explicit baseline ref that does not resolve", async () => {
    const fixture = await fixtureRepo(true);
    const runRoot = await mkdtemp(join(tmpdir(), "skill-eval-runs-"));
    await expect(prepareRun({
      targetPath: fixture.target,
      suitePath: fixture.suitePath,
      hosts: ["codex"],
      invokingHost: "codex",
      anchorRef: "missing-baseline",
      runRoot,
      runId: "missing-baseline",
    })).rejects.toThrow("anchor ref does not resolve to a commit: missing-baseline");
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
