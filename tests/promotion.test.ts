import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashTree, hashValue, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import { promoteVersion } from "../skills/skill-eval/scripts/lib/promotion.ts";
import { validateSuite } from "../skills/skill-eval/scripts/lib/suite.ts";
import type { RunState } from "../skills/skill-eval/scripts/lib/types.ts";

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

async function promotionRun(initialClean: boolean, branch = "feature"): Promise<{ repo: string; runDir: string; target: string; decisionId: string }> {
  const repo = await mkdtemp(join(tmpdir(), "skill-eval-promote-repo-"));
  const target = join(repo, "skills", "demo");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n# Authored\n");
  git(repo, ["init", "-q", "-b", branch]);
  git(repo, ["config", "user.name", "Test User"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "initial"]);
  if (!initialClean) await writeFile(join(repo, "notes.txt"), "unrelated dirty file\n");
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-promote-run-"));
  const authored = join(runDir, "versions", "authored");
  const winner = join(runDir, "versions", "winner");
  await mkdir(authored, { recursive: true });
  await mkdir(winner, { recursive: true });
  await writeFile(join(authored, "SKILL.md"), await readFile(join(target, "SKILL.md")));
  await writeFile(join(winner, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n# Winner\n");
  const suite = { schema_version: 1, skill_name: "demo", hypothesis: "winner is better", evals: [{ id: "case", name: "Case", purpose: "improvement", severity: "critical", prompt: "task", expectations: [{ id: "result", text: "result exists", severity: "critical", check: { type: "file_exists", path: "result.txt" } }] }] };
  await writeJson(join(runDir, "suite.json"), suite);
  const now = new Date().toISOString();
  const state: RunState = {
    schema_version: 1, run_id: "r", run_dir: runDir, created_at: now, target_path: target, repo_root: repo, skill_name: "demo", invoking_host: "codex",
    requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" }, versions: { authored: { path: authored, parent: null, created_at: now }, winner: { path: winner, parent: "authored", created_at: now } },
    hashes: { versions: { authored: await hashTree(authored), winner: await hashTree(winner) }, fixtures: {}, suite: hashValue(validateSuite(suite)) },
    git: { initial_clean: initialClean, initial_status: initialClean ? "" : "?? notes.txt\n", branch, head: git(repo, ["rev-parse", "HEAD"]), target_tracked: true },
  };
  await writeJson(join(runDir, "run.json"), state);
  const decisionId = "approved-winner";
  const unsignedBenchmark = { schema_version: 1 as const, comparison_id: "anchor", created_at: now, comparison: { left: "anchor", right: "winner" }, attempt_ids: ["training", "holdout"], partitions: { training: {}, holdout: {} }, preferences: { left: 0, right: 2, tie: 0 }, gates: { passed: true, reasons: [] }, verdict: "improvement demonstrated" as const, notes: [] as string[] };
  const benchmarkHash = hashValue(unsignedBenchmark);
  await writeJson(join(runDir, "benchmarks.json"), [{ ...unsignedBenchmark, evidence_hash: benchmarkHash }]);
  const unsigned = { schema_version: 1 as const, decision_id: decisionId, created_at: now, winner: "winner", winner_hash: state.hashes.versions.winner, anchor_benchmark_id: "anchor", incumbent_benchmark_id: null, approved: true, reasons: [] as string[], benchmark_hashes: { anchor: benchmarkHash } };
  await writeJson(join(runDir, "decisions", `${decisionId}.json`), { ...unsigned, decision_hash: hashValue(unsigned) });
  return { repo, runDir, target, decisionId };
}

describe("promotion", () => {
  test("applies but does not commit when the repository started dirty", async () => {
    const fixture = await promotionRun(false);
    const before = git(fixture.repo, ["rev-list", "--count", "HEAD"]);
    const result = await promoteVersion({ runDir: fixture.runDir, decisionId: fixture.decisionId, policyAllowsCommit: true });
    expect(await readFile(join(fixture.target, "SKILL.md"), "utf8")).toContain("# Winner");
    expect(result.committed).toBe(false);
    expect(git(fixture.repo, ["rev-list", "--count", "HEAD"])).toBe(before);
  });

  test("creates one commit when the clean feature-branch policy allows it", async () => {
    const fixture = await promotionRun(true);
    const before = Number(git(fixture.repo, ["rev-list", "--count", "HEAD"]));
    const result = await promoteVersion({ runDir: fixture.runDir, decisionId: fixture.decisionId, policyAllowsCommit: true, commitMessage: "fix(skill): promote evaluated winner" });
    expect(result.committed).toBe(true);
    expect(Number(git(fixture.repo, ["rev-list", "--count", "HEAD"]))).toBe(before + 1);
  });

  test("does not commit on a default branch", async () => {
    const fixture = await promotionRun(true, "main");
    const result = await promoteVersion({ runDir: fixture.runDir, decisionId: fixture.decisionId, policyAllowsCommit: true });
    expect(result.committed).toBe(false);
    expect(result.reason).toContain("protected or default branch");
  });

  test("refuses to overwrite target changes made after the run started", async () => {
    const fixture = await promotionRun(true);
    await writeFile(join(fixture.target, "SKILL.md"), "changed after snapshot\n");
    await expect(promoteVersion({ runDir: fixture.runDir, decisionId: fixture.decisionId, policyAllowsCommit: false })).rejects.toThrow("target changed after the authored snapshot");
  });

  test("rejects promotion without a valid sealed decision", async () => {
    const fixture = await promotionRun(true);
    await expect(promoteVersion({ runDir: fixture.runDir, decisionId: "missing", policyAllowsCommit: false })).rejects.toThrow("promotion requires a sealed decision");
    const decisionPath = join(fixture.runDir, "decisions", `${fixture.decisionId}.json`);
    const decision = JSON.parse(await readFile(decisionPath, "utf8"));
    decision.winner = "authored";
    await writeJson(decisionPath, decision);
    await expect(promoteVersion({ runDir: fixture.runDir, decisionId: fixture.decisionId, policyAllowsCommit: false })).rejects.toThrow("decision hash mismatch");
  });

  test("revalidates the frozen suite at the promotion boundary", async () => {
    const fixture = await promotionRun(true);
    const suitePath = join(fixture.runDir, "suite.json");
    const suite = JSON.parse(await readFile(suitePath, "utf8"));
    suite.hypothesis = "mutated after decision";
    await writeJson(suitePath, suite);
    await expect(promoteVersion({ runDir: fixture.runDir, decisionId: fixture.decisionId, policyAllowsCommit: false })).rejects.toThrow("suite hash mismatch");
  });
});
