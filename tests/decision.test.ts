import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sealDecision } from "../skills/skill-eval/scripts/lib/decision.ts";
import { hashTree, hashValue, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";

test("seals only a winner that clears anchor and incumbent evidence", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-decision-"));
  const winner = join(runDir, "versions", "winner"); await mkdir(winner, { recursive: true }); await writeFile(join(winner, "SKILL.md"), "winner");
  const winnerHash = await hashTree(winner);
  const state = { schema_version: 1, run_id: "r", run_dir: runDir, created_at: new Date().toISOString(), target_path: winner, repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" }, versions: { winner: { path: winner, parent: "incumbent", created_at: new Date().toISOString() } }, hashes: { versions: { winner: winnerHash }, fixtures: {}, suite: "suite" }, git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true } };
  await writeJson(join(runDir, "run.json"), state);
  const benchmark = (id: string, left: string, verdict: string) => {
    const unsigned = { schema_version: 1 as const, comparison_id: id, created_at: new Date().toISOString(), comparison: { left, right: "winner" }, attempt_ids: ["training", "holdout"], partitions: { training: {}, holdout: {} }, preferences: { left: 0, right: 2, tie: 0 }, gates: { passed: true, reasons: [] }, verdict };
    return { ...unsigned, evidence_hash: hashValue(unsigned) };
  };
  const anchor = benchmark("anchor", "anchor", "improvement demonstrated");
  const incumbent = benchmark("incumbent", "incumbent", "no regression found");
  await writeJson(join(runDir, "benchmarks.json"), [anchor, incumbent]);

  const decision = await sealDecision({ runDir, winner: "winner", anchorBenchmarkId: "anchor", incumbentBenchmarkId: "incumbent", decisionId: "winner-decision" });
  expect(decision.approved).toBe(true);
  expect(decision.winner_hash).toBe(winnerHash);
  expect(decision.decision_hash).toMatch(/^[a-f0-9]{64}$/);
});

test("refuses to seal missing held-out or failed evidence", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-decision-fail-"));
  const winner = join(runDir, "winner"); await mkdir(winner); await writeFile(join(winner, "SKILL.md"), "winner");
  await writeJson(join(runDir, "run.json"), { schema_version: 1, run_id: "r", run_dir: runDir, created_at: new Date().toISOString(), target_path: winner, repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" }, versions: { winner: { path: winner, parent: null, created_at: new Date().toISOString() } }, hashes: { versions: { winner: await hashTree(winner) }, fixtures: {}, suite: "suite" }, git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true } });
  await writeJson(join(runDir, "benchmarks.json"), [{ schema_version: 1, comparison_id: "anchor", comparison: { left: "anchor", right: "winner" }, attempt_ids: ["training"], partitions: { training: {} }, gates: { passed: false, reasons: ["missing holdout"] }, verdict: "blocked or limited signal", evidence_hash: "hash" }]);
  await expect(sealDecision({ runDir, winner: "winner", anchorBenchmarkId: "anchor", decisionId: "bad" })).rejects.toThrow("cannot approve winner");
});
