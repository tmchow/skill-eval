import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregateIndependentPreferences, buildBenchmark } from "../skills/skill-eval/scripts/lib/benchmark.ts";
import { hashValue, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import type { ExecutionRecord, GradingResult, JudgeResult, RunState } from "../skills/skill-eval/scripts/lib/types.ts";

async function completeAttemptManifests(runDir: string, records: ExecutionRecord[]): Promise<void> {
  for (const attemptId of [...new Set(records.map((item) => item.attempt_id))]) {
    const selected = records.filter((item) => item.attempt_id === attemptId);
    await writeJson(join(runDir, "artifacts", "runs", attemptId, "attempt.json"), {
      schema_version: 2, attempt_id: attemptId, kind: "behavior", status: "complete",
      versions: [...new Set(selected.map((item) => item.version))], planned_records: selected.length, record_count: selected.length,
    });
  }
}

test("benchmark quantifies partitions, variance, cost, and hard execution gates", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-benchmark-"));
  const leftPath = join(runDir, "left-skill");
  const rightPath = join(runDir, "right-skill");
  await mkdir(leftPath); await mkdir(rightPath);
  await writeFile(join(leftPath, "SKILL.md"), "left");
  await writeFile(join(rightPath, "SKILL.md"), "right but larger");
  const now = new Date().toISOString();
  const state: RunState = {
    schema_version: 2, run_id: "r", run_dir: runDir, created_at: now, target_path: rightPath, repo_root: runDir, skill_name: "demo", invoking_host: "codex",
    requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" }, versions: { left: { path: leftPath, parent: null, created_at: now }, right: { path: rightPath, parent: "left", created_at: now } },
    hashes: { versions: { left: "l", right: "r" }, fixtures: {}, suite: "s" }, git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true },
  };
  await writeJson(join(runDir, "run.json"), state);
  const records: ExecutionRecord[] = ["training", "validation"].flatMap((partition) => ["left", "right"].flatMap((version) => [1, 2].map((repetition) => ({
    schema_version: 2 as const, attempt_id: `${partition}-attempt`, partition: partition as "training" | "validation", created_at: now,
    host: "codex" as const, eval_id: partition === "training" ? "case" : "validation", version, repetition, run_dir: runDir, output_dir: runDir,
    skill_path: null, skill_hash_before: null, skill_hash_after: null, source_mutated: false,
    host_result: { host: "codex" as const, exit_code: 0, timed_out: false, malformed_events: 0, final_text: "done", duration_ms: version === "left" ? 20 + repetition * 10 : repetition * 10, usage: { input_tokens: null, output_tokens: null, total_tokens: version === "right" ? 10 : 20, cost_usd: version === "right" ? 0.01 : 0.02 }, event_path: "", stderr_path: "", final_path: "" },
  }))));
  await writeJson(join(runDir, "executions.json"), records);
  await completeAttemptManifests(runDir, records);
  const grades: GradingResult[] = records.map((record) => ({
    schema_version: 2, attempt_id: record.attempt_id, partition: record.partition, host: record.host, eval_id: record.eval_id, version: record.version, repetition: record.repetition,
    expectations: [], summary: { passed: record.version === "right" ? 1 : 0, failed: record.version === "right" ? 0 : 1, blocked: 0, qualitative: 0, total: 1, pass_rate: record.version === "right" ? 1 : 0, critical_failed: record.version === "right" ? 0 : 1, critical_blocked: 0, run_failed: false },
  }));
  grades.push({
    schema_version: 2, partition: "training", host: "codex", eval_id: "case", version: "right", repetition: 99,
    expectations: [], summary: { passed: 0, failed: 1, blocked: 0, qualitative: 0, total: 1, pass_rate: 0, critical_failed: 1, critical_blocked: 0, run_failed: false },
  });
  await writeJson(join(runDir, "gradings.json"), grades);
  const judgments: JudgeResult[] = [
    { schema_version: 2, comparison_id: "left-v-right-judge", execution_attempt_id: "training-attempt", repetition: 1, eval_id: "case", executor_host: "codex", judge_host: "codex", left_version: "left", right_version: "right", labels: { A: "left", B: "right" }, winner_label: "B", preferred_version: "right", reasoning: "better", valid: true, run_dir: runDir },
    { schema_version: 2, comparison_id: "left-v-right-judge", execution_attempt_id: "training-attempt", repetition: 1, eval_id: "case", executor_host: "codex", judge_host: "claude", left_version: "left", right_version: "right", labels: { A: "left", B: "right" }, winner_label: "A", preferred_version: "left", reasoning: "baseline is clearer", valid: true, run_dir: runDir },
    { schema_version: 2, comparison_id: "stale-left-v-right-judge", execution_attempt_id: "training-attempt", repetition: 1, eval_id: "case", executor_host: "codex", judge_host: "codex", left_version: "left", right_version: "right", labels: { A: "left", B: "right" }, winner_label: "A", preferred_version: "left", reasoning: "stale", valid: true, run_dir: runDir },
    { schema_version: 2, comparison_id: "unrelated-judge", execution_attempt_id: "training-attempt", repetition: 1, eval_id: "case", executor_host: "codex", judge_host: "codex", left_version: "unrelated", right_version: "right", labels: { A: "unrelated", B: "right" }, winner_label: "A", preferred_version: "unrelated", reasoning: "different comparison", valid: true, run_dir: runDir },
  ];
  await writeJson(join(runDir, "judgments.json"), judgments);
  await writeJson(join(runDir, "human-judgments.json"), [
    { schema_version: 2, feedback_id: "review", comparison_id: "left-v-right-judge", execution_attempt_id: "training-attempt", eval_id: "case", executor_host: "codex", repetition: 1, winner_label: "B", preferred_version: "right", reason: "right is correct", created_at: now },
    { schema_version: 2, feedback_id: "other-review", comparison_id: "unrelated-judge", execution_attempt_id: "training-attempt", eval_id: "case", executor_host: "codex", repetition: 1, winner_label: "A", preferred_version: "unrelated", reason: "not this comparison", created_at: now },
  ]);

  await expect(buildBenchmark({ runDir, left: "left", right: "right", attemptIds: ["training-attempt", "validation-attempt"], comparisonId: "ambiguous-judgments" })).rejects.toThrow("multiple judgment comparisons");

  const benchmark = await buildBenchmark({ runDir, left: "left", right: "right", attemptIds: ["training-attempt", "validation-attempt"], comparisonId: "left-v-right", judgmentComparisonId: "left-v-right-judge" });
  expect(benchmark.partitions.training!.versions.right!.pass_rate.mean).toBe(1);
  expect(benchmark.partitions.training!.versions.right!.duration_ms.stddev).toBeGreaterThan(0);
  expect(benchmark.partitions.training!.delta.pass_rate).toBe(1);
  expect(benchmark.partitions.training!.versions.right!.cost_usd.mean).toBe(0.01);
  expect(benchmark.preferences).toMatchObject({ left: 0, right: 0, tie: 1 });
  expect(benchmark.cross_model).toMatchObject({
    judge_hosts: { codex: { right: 1 }, claude: { left: 1 } },
    judge_votes: { left: 1, right: 1, tie: 0 },
    independent_pairs: { left: 0, right: 0, tie: 1, total: 1 },
    agreement_cases: 0,
    disagreement_cases: 1,
  });
  expect(benchmark.preferences.human_right).toBe(1);
  expect(benchmark.preferences.human_left).toBe(0);
  expect(benchmark.gates.passed).toBe(true);
  expect(benchmark.verdict).toBe("improvement demonstrated");
  expect(benchmark.evidence_hash).toMatch(/^[a-f0-9]{64}$/);

  judgments[0]!.expectations = [{ id: "coverage", severity: "critical", evidence_role: "outcome", goal: "not-worse", status: "FAIL", evidence: "candidate omitted a baseline risk" }];
  await writeJson(join(runDir, "judgments.json"), judgments);
  const pairedBlocked = await buildBenchmark({ runDir, left: "left", right: "right", attemptIds: ["training-attempt", "validation-attempt"], comparisonId: "critical-pair-blocks", judgmentComparisonId: "left-v-right-judge" });
  expect(pairedBlocked.gates.passed).toBe(false);
  expect(pairedBlocked.gates.reasons.some((reason) => reason.includes("critical comparison expectation failed"))).toBe(true);
  delete judgments[0]!.expectations;
  await writeJson(join(runDir, "judgments.json"), judgments);

  const invalidation = { schema_version: 2 as const, attempt_id: "training-attempt", eval_id: "case", expectation_id: "quality", reason: "substring check reverses the sentence meaning", created_at: now };
  await writeJson(join(runDir, "invalidated-checks.json"), [{ ...invalidation, content_hash: hashValue(invalidation) }]);
  const blocked = await buildBenchmark({ runDir, left: "left", right: "right", attemptIds: ["training-attempt", "validation-attempt"], comparisonId: "invalid-check-blocks", judgmentComparisonId: "left-v-right-judge" });
  expect(blocked.gates.passed).toBe(false);
  expect(blocked.gates.reasons.some((reason) => reason.includes("invalidated check blocks"))).toBe(true);
});

test("multiple judges on one execution pair count as one independent outcome", () => {
  const judgment = (pair: string, judge: "claude" | "codex", preferred: "left" | "right" | "TIE", repetition: number): JudgeResult => ({
    schema_version: 2,
    comparison_id: "comparison",
    execution_attempt_id: pair,
    repetition,
    eval_id: "case",
    executor_host: "codex",
    judge_host: judge,
    left_version: "left",
    right_version: "right",
    labels: { A: "left", B: "right" },
    winner_label: preferred === "left" ? "A" : preferred === "right" ? "B" : "TIE",
    preferred_version: preferred,
    reasoning: "evidence",
    valid: true,
    run_dir: "/tmp/judge",
  });
  const judgments = [
    judgment("pair-1", "claude", "right", 1),
    judgment("pair-1", "codex", "right", 1),
    judgment("pair-2", "claude", "right", 2),
    judgment("pair-2", "codex", "left", 2),
    judgment("pair-3", "claude", "left", 3),
    judgment("pair-3", "codex", "TIE", 3),
  ];

  expect(aggregateIndependentPreferences(judgments, "left", "right")).toEqual({ left: 1, right: 1, tie: 1 });
});

test("two judges on one pair cannot demonstrate improvement", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-benchmark-one-pair-"));
  const now = new Date().toISOString();
  const leftPath = join(runDir, "left"); const rightPath = join(runDir, "right");
  await mkdir(leftPath); await mkdir(rightPath); await writeFile(join(leftPath, "SKILL.md"), "left"); await writeFile(join(rightPath, "SKILL.md"), "right");
  await writeJson(join(runDir, "run.json"), { schema_version: 2, run_id: "r", run_dir: runDir, created_at: now, target_path: rightPath, repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" }, versions: { left: { path: leftPath, parent: null, created_at: now }, right: { path: rightPath, parent: "left", created_at: now } }, hashes: { versions: {}, fixtures: {}, suite: "s" }, git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true } });
  const records: ExecutionRecord[] = ["left", "right"].map((version) => ({ schema_version: 2, attempt_id: "training", partition: "training", created_at: now, host: "codex", eval_id: "case", version, repetition: 1, run_dir: runDir, output_dir: runDir, skill_path: null, skill_hash_before: null, skill_hash_after: null, source_mutated: false, host_result: { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: "done", duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: "", stderr_path: "", final_path: "" } }));
  await writeJson(join(runDir, "executions.json"), records);
  await completeAttemptManifests(runDir, records);
  await writeJson(join(runDir, "gradings.json"), records.map((record) => ({ schema_version: 2, attempt_id: "training", partition: "training", host: "codex", eval_id: "case", version: record.version, repetition: 1, expectations: [], summary: { passed: 1, failed: 0, blocked: 0, qualitative: 0, total: 1, pass_rate: 1, critical_failed: 0, critical_blocked: 0, run_failed: false } })));
  const judgments: JudgeResult[] = (["claude", "codex"] as const).map((judgeHost) => ({ schema_version: 2, comparison_id: "judge", execution_attempt_id: "training", repetition: 1, eval_id: "case", executor_host: "codex", judge_host: judgeHost, left_version: "left", right_version: "right", labels: { A: "left", B: "right" }, winner_label: "B", preferred_version: "right", reasoning: "candidate is better", valid: true, run_dir: runDir }));
  await writeJson(join(runDir, "judgments.json"), judgments);

  const benchmark = await buildBenchmark({ runDir, left: "left", right: "right", attemptIds: ["training"], comparisonId: "one-pair", partitions: ["training"] });

  expect(benchmark.preferences).toMatchObject({ left: 0, right: 1, tie: 0 });
  expect(benchmark.cross_model?.judge_votes).toEqual({ left: 0, right: 2, tie: 0 });
  expect(benchmark.verdict).toBe("no regression found");
  expect(benchmark.notes).toContain("one independent execution pair preferred the candidate; treat this as calibration evidence, not a durable improvement");
});

test("benchmark requires every planned blind judgment and critical comparison outcome", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-benchmark-judge-coverage-"));
  const now = new Date().toISOString();
  const leftPath = join(runDir, "left"); const rightPath = join(runDir, "right");
  await mkdir(leftPath); await mkdir(rightPath);
  await writeFile(join(leftPath, "SKILL.md"), "left"); await writeFile(join(rightPath, "SKILL.md"), "right");
  await writeJson(join(runDir, "run.json"), { schema_version: 2, run_id: "r", run_dir: runDir, created_at: now, target_path: rightPath, repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" }, versions: { left: { path: leftPath, parent: null, created_at: now }, right: { path: rightPath, parent: "left", created_at: now } }, hashes: { versions: {}, fixtures: {}, suite: "s" }, git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true } });
  await writeJson(join(runDir, "suite.json"), { schema_version: 2, claim_class: "effectiveness", environment: { fidelity: "isolated", external_state: [] }, skill_name: "demo", hypothesis: "better", evals: [{ id: "case", name: "Case", purpose: "improvement", severity: "critical", prompt: "task", expectations: [{ id: "quality", text: "candidate is no worse", severity: "critical", evidence_role: "outcome", scope: "comparison", comparison_goal: "not-worse" }] }] });
  const records: ExecutionRecord[] = ["left", "right"].map((version) => ({ schema_version: 2, attempt_id: "training", partition: "training", created_at: now, host: "codex", eval_id: "case", version, repetition: 1, run_dir: runDir, output_dir: runDir, skill_path: null, skill_hash_before: null, skill_hash_after: null, source_mutated: false, host_result: { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: "done", duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: "", stderr_path: "", final_path: "" } }));
  await writeJson(join(runDir, "executions.json"), records);
  await completeAttemptManifests(runDir, records);
  await writeJson(join(runDir, "gradings.json"), records.map((record) => ({ schema_version: 2, attempt_id: "training", partition: "training", host: "codex", eval_id: "case", version: record.version, repetition: 1, expectations: [], summary: { passed: 1, failed: 0, blocked: 0, qualitative: 0, total: 1, pass_rate: 1, critical_failed: 0, critical_blocked: 0, run_failed: false } })));
  const comparisonId = "judge-coverage";
  const comparisonRoot = createHash("sha256").update(comparisonId).digest("hex").slice(0, 16);
  await writeJson(join(runDir, "artifacts", "judges", comparisonRoot, "comparison-attempt.json"), { schema_version: 2, comparison_id: comparisonId, status: "complete", execution_attempt_ids: ["training"], judge_hosts: ["codex", "claude"], skipped_pairs: [] });
  const judgment = (judgeHost: "codex" | "claude", valid: boolean, includeExpectation = true): JudgeResult => ({
    schema_version: 2, comparison_id: comparisonId, execution_attempt_id: "training", repetition: 1, eval_id: "case", executor_host: "codex", judge_host: judgeHost,
    left_version: "left", right_version: "right", labels: { A: "left", B: "right" }, winner_label: "TIE", preferred_version: "TIE", reasoning: "same", valid, run_dir: runDir,
    ...(includeExpectation ? { expectations: [{ id: "quality", severity: "critical", evidence_role: "outcome", goal: "not-worse", status: "PASS", evidence: "equivalent" }] } : {}),
  });
  await writeJson(join(runDir, "judgments.json"), [judgment("codex", true), judgment("claude", false)]);

  const invalidHost = await buildBenchmark({ runDir, left: "left", right: "right", attemptIds: ["training"], comparisonId: "invalid-judge-host", judgmentComparisonId: comparisonId, partitions: ["training"] });
  expect(invalidHost.gates.reasons.some((reason) => reason.includes("valid blind judgment missing") && reason.includes("claude"))).toBe(true);

  await writeJson(join(runDir, "judgments.json"), [judgment("codex", true), judgment("claude", true, false)]);
  const missingCritical = await buildBenchmark({ runDir, left: "left", right: "right", attemptIds: ["training"], comparisonId: "missing-critical-outcome", judgmentComparisonId: comparisonId, partitions: ["training"] });
  expect(missingCritical.gates.reasons.some((reason) => reason.includes("critical comparison outcome missing") && reason.includes("claude"))).toBe(true);

  await writeJson(join(runDir, "suite.json"), { schema_version: 2, claim_class: "effectiveness", environment: { fidelity: "isolated", external_state: [] }, skill_name: "demo", hypothesis: "better", evals: [
    { id: "case", name: "Training", purpose: "improvement", severity: "critical", prompt: "task", expectations: [{ id: "complete", text: "completed", severity: "critical", evidence_role: "outcome", check: { type: "exit_success" } }] },
    { id: "validation", name: "Validation", purpose: "regression", severity: "critical", prompt: "validation task", validation: true, expectations: [{ id: "quality", text: "candidate is no worse", severity: "critical", evidence_role: "outcome", scope: "comparison", comparison_goal: "not-worse" }] },
  ] });
  await writeJson(join(runDir, "judgments.json"), []);
  const trainingOnly = await buildBenchmark({ runDir, left: "left", right: "right", attemptIds: ["training"], comparisonId: "training-with-validation-only-quality", partitions: ["training"] });
  expect(trainingOnly.gates.reasons).not.toContain("blind comparison evidence is missing");
});

test("benchmark blocks a candidate when qualitative grading evidence is missing", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-benchmark-qualitative-"));
  const now = new Date().toISOString();
  for (const version of ["left", "right"]) {
    const path = join(runDir, version); await mkdir(path); await writeFile(join(path, "SKILL.md"), version);
  }
  await writeJson(join(runDir, "run.json"), { schema_version: 2, run_id: "r", run_dir: runDir, created_at: now, target_path: join(runDir, "right"), repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" }, versions: { left: { path: join(runDir, "left"), parent: null, created_at: now }, right: { path: join(runDir, "right"), parent: "left", created_at: now } }, hashes: { versions: {}, fixtures: {}, suite: "s" }, git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true } });
  await writeJson(join(runDir, "suite.json"), { schema_version: 2, claim_class: "generalization", environment: { fidelity: "isolated", external_state: [] }, skill_name: "demo", hypothesis: "better", evals: [
    { id: "training", name: "Training", purpose: "improvement", severity: "critical", prompt: "task", expectations: [{ id: "quality", text: "is correct", severity: "critical", evidence_role: "outcome" }] },
    { id: "validation", name: "Validation", purpose: "regression", severity: "critical", prompt: "task", validation: true, expectations: [{ id: "quality", text: "is correct", severity: "critical", evidence_role: "outcome" }] },
  ] });
  const records: ExecutionRecord[] = (["training", "validation"] as const).flatMap((partition) => ["left", "right"].map((version) => ({ schema_version: 2 as const, attempt_id: partition, partition, created_at: now, host: "codex" as const, eval_id: partition, version, repetition: 1, run_dir: runDir, output_dir: runDir, skill_path: null, skill_hash_before: null, skill_hash_after: null, source_mutated: false, host_result: { host: "codex" as const, exit_code: 0, timed_out: false, malformed_events: 0, final_text: "done", duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: "", stderr_path: "", final_path: "" } })));
  await writeJson(join(runDir, "executions.json"), records);
  await completeAttemptManifests(runDir, records);
  await writeJson(join(runDir, "gradings.json"), records.map((record) => ({ schema_version: 2, attempt_id: record.attempt_id, partition: record.partition, host: record.host, eval_id: record.eval_id, version: record.version, repetition: 1, expectations: [{ id: "quality", text: "is correct", severity: "critical", evidence_role: "outcome", passed: null, blocked: false, evidence: "qualitative" }], summary: { passed: 0, failed: 0, blocked: 0, qualitative: 1, total: 1, pass_rate: null, critical_failed: 0, critical_blocked: 0, run_failed: false } })));
  await writeJson(join(runDir, "judgments.json"), []);

  const benchmark = await buildBenchmark({ runDir, left: "left", right: "right", attemptIds: ["training", "validation"], comparisonId: "missing-model-grades" });
  expect(benchmark.gates.passed).toBe(false);
  expect(benchmark.gates.reasons.some((reason) => reason.includes("qualitative grading missing"))).toBe(true);
});

test("benchmark blocks improvement when a right-side executor failed", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-benchmark-failure-"));
  const leftPath = join(runDir, "left"); const rightPath = join(runDir, "right");
  await mkdir(leftPath); await mkdir(rightPath);
  await writeFile(join(leftPath, "SKILL.md"), "left"); await writeFile(join(rightPath, "SKILL.md"), "right");
  const now = new Date().toISOString();
  await writeJson(join(runDir, "run.json"), {
    schema_version: 2, run_id: "r", run_dir: runDir, created_at: now, target_path: rightPath, repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" },
    versions: { left: { path: leftPath, parent: null, created_at: now }, right: { path: rightPath, parent: "left", created_at: now } }, hashes: { versions: {}, fixtures: {}, suite: "s" }, git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true },
  });
  const record = (version: string, partition: "training" | "validation", failed: boolean): ExecutionRecord => ({
    schema_version: 2, attempt_id: partition, partition, created_at: now, host: "codex", eval_id: partition, version, repetition: 1, run_dir: runDir, output_dir: runDir, skill_path: null, skill_hash_before: null, skill_hash_after: null, source_mutated: false,
    host_result: { host: "codex", exit_code: failed ? 1 : 0, timed_out: false, malformed_events: 0, final_text: failed ? "" : "done", duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: "", stderr_path: "", final_path: "" },
  });
  const records = [record("left", "training", false), record("right", "training", true), record("left", "validation", false), record("right", "validation", true)];
  await writeJson(join(runDir, "executions.json"), records);
  await completeAttemptManifests(runDir, records);
  await writeJson(join(runDir, "artifacts", "runs", "training", "attempt.json"), { schema_version: 2, attempt_id: "training", kind: "behavior", status: "started", versions: ["left", "right"], planned_records: 2 });
  await writeJson(join(runDir, "gradings.json"), records.map((item) => ({ schema_version: 2, attempt_id: item.attempt_id, partition: item.partition, host: item.host, eval_id: item.eval_id, version: item.version, repetition: 1, expectations: [], summary: { passed: 1, failed: 0, blocked: 0, qualitative: 0, total: 1, pass_rate: 1, critical_failed: item.version === "right" ? 1 : 0, critical_blocked: 0, run_failed: item.version === "right" } })));
  await writeJson(join(runDir, "judgments.json"), []);

  const benchmark = await buildBenchmark({ runDir, left: "left", right: "right", attemptIds: ["training", "validation"], comparisonId: "failed-right" });
  expect(benchmark.gates.passed).toBe(false);
  expect(benchmark.gates.reasons).toContain("behavior attempt incomplete: training");
  expect(benchmark.verdict).toBe("critical regression");

  const timedOut = records.map((item) => item.version === "right"
    ? { ...item, host_result: { ...item.host_result, timed_out: true, exit_code: 137 } }
    : item);
  await writeJson(join(runDir, "executions.json"), timedOut);
  const inconclusive = await buildBenchmark({ runDir, left: "left", right: "right", attemptIds: ["training", "validation"], comparisonId: "timed-out-right" });
  expect(inconclusive.gates.reasons.some((reason) => reason.includes("timed out"))).toBe(true);
  expect(inconclusive.verdict).toBe("blocked or limited signal");
});

test("benchmark treats a failed baseline as inconclusive", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-benchmark-baseline-failure-"));
  const now = new Date().toISOString();
  const leftPath = join(runDir, "left"); const rightPath = join(runDir, "right");
  await mkdir(leftPath); await mkdir(rightPath); await writeFile(join(leftPath, "SKILL.md"), "left"); await writeFile(join(rightPath, "SKILL.md"), "right");
  await writeJson(join(runDir, "run.json"), { schema_version: 2, run_id: "r", run_dir: runDir, created_at: now, target_path: rightPath, repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" }, versions: { left: { path: leftPath, parent: null, created_at: now }, right: { path: rightPath, parent: "left", created_at: now } }, hashes: { versions: {}, fixtures: {}, suite: "s" }, git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true } });
  const records: ExecutionRecord[] = ["left", "right"].map((version) => ({ schema_version: 2, attempt_id: "training", partition: "training", created_at: now, host: "codex", eval_id: "case", version, repetition: 1, run_dir: runDir, output_dir: runDir, skill_path: null, skill_hash_before: null, skill_hash_after: null, source_mutated: false, host_result: { host: "codex", exit_code: version === "left" ? 1 : 0, timed_out: false, malformed_events: 0, final_text: "", duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: "", stderr_path: "", final_path: "" } }));
  await writeJson(join(runDir, "executions.json"), records);
  await completeAttemptManifests(runDir, records);
  await writeJson(join(runDir, "gradings.json"), records.map((record) => ({ schema_version: 2, attempt_id: "training", partition: "training", host: "codex", eval_id: "case", version: record.version, repetition: 1, expectations: [], summary: { passed: record.version === "right" ? 1 : 0, failed: record.version === "right" ? 0 : 1, blocked: 0, qualitative: 0, total: 1, pass_rate: record.version === "right" ? 1 : 0, critical_failed: 0, critical_blocked: 0, run_failed: record.version === "left" } })));
  await writeJson(join(runDir, "judgments.json"), []);

  const benchmark = await buildBenchmark({ runDir, left: "left", right: "right", attemptIds: ["training"], comparisonId: "baseline-failed", partitions: ["training"] });

  expect(benchmark.gates.passed).toBe(false);
  expect(benchmark.gates.reasons.some((reason) => reason.includes("baseline executor"))).toBe(true);
  expect(benchmark.verdict).toBe("blocked or limited signal");
});

test("blind preference cannot override a deterministic quality regression", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-benchmark-preference-regression-"));
  const now = new Date().toISOString();
  const leftPath = join(runDir, "left"); const rightPath = join(runDir, "right");
  await mkdir(leftPath); await mkdir(rightPath); await writeFile(join(leftPath, "SKILL.md"), "left"); await writeFile(join(rightPath, "SKILL.md"), "right");
  await writeJson(join(runDir, "run.json"), { schema_version: 2, run_id: "r", run_dir: runDir, created_at: now, target_path: rightPath, repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" }, versions: { left: { path: leftPath, parent: null, created_at: now }, right: { path: rightPath, parent: "left", created_at: now } }, hashes: { versions: {}, fixtures: {}, suite: "s" }, git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true } });
  const records: ExecutionRecord[] = (["training", "validation"] as const).flatMap((partition) => ["left", "right"].map((version) => ({ schema_version: 2 as const, attempt_id: partition, partition, created_at: now, host: "codex" as const, eval_id: partition, version, repetition: 1, run_dir: runDir, output_dir: runDir, skill_path: null, skill_hash_before: null, skill_hash_after: null, source_mutated: false, host_result: { host: "codex" as const, exit_code: 0, timed_out: false, malformed_events: 0, final_text: "done", duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: "", stderr_path: "", final_path: "" } })));
  await writeJson(join(runDir, "executions.json"), records);
  await completeAttemptManifests(runDir, records);
  await writeJson(join(runDir, "gradings.json"), records.map((record) => ({ schema_version: 2, attempt_id: record.attempt_id, partition: record.partition, host: record.host, eval_id: record.eval_id, version: record.version, repetition: 1, expectations: [], summary: { passed: record.version === "left" ? 1 : 0, failed: record.version === "left" ? 0 : 1, blocked: 0, qualitative: 0, total: 1, pass_rate: record.version === "left" ? 1 : 0, critical_failed: 0, critical_blocked: 0, run_failed: false } })));
  await writeJson(join(runDir, "judgments.json"), (["training", "validation"] as const).map((partition) => ({ schema_version: 2, comparison_id: "judge", execution_attempt_id: partition, repetition: 1, eval_id: partition, executor_host: "codex", judge_host: "codex", left_version: "left", right_version: "right", labels: { A: "left", B: "right" }, winner_label: "B", preferred_version: "right", reasoning: "preferred", valid: true, run_dir: runDir })));

  const benchmark = await buildBenchmark({ runDir, left: "left", right: "right", attemptIds: ["training", "validation"], comparisonId: "preference-cannot-mask-regression" });
  expect(benchmark.preferences.right).toBe(2);
  expect(benchmark.gates.passed).toBe(true);
  expect(benchmark.verdict).toBe("no demonstrated improvement");
});

test("a passing candidate-only mechanism cannot create an objective improvement", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-benchmark-mechanism-role-"));
  const now = new Date().toISOString();
  const anchorPath = join(runDir, "anchor"); const authoredPath = join(runDir, "authored");
  await mkdir(anchorPath); await mkdir(authoredPath);
  await writeFile(join(anchorPath, "SKILL.md"), "anchor");
  await writeFile(join(authoredPath, "SKILL.md"), "authored");
  await writeJson(join(runDir, "run.json"), {
    schema_version: 2, run_id: "r", run_dir: runDir, created_at: now, target_path: authoredPath, repo_root: runDir,
    skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" },
    versions: { anchor: { path: anchorPath, parent: null, created_at: now }, authored: { path: authoredPath, parent: "anchor", created_at: now } },
    hashes: { versions: {}, fixtures: {}, suite: "s" }, git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true },
  });
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 2, claim_class: "effectiveness", environment: { fidelity: "isolated", external_state: [] }, skill_name: "demo", hypothesis: "better",
    evals: [{ id: "case", name: "Case", purpose: "improvement", severity: "quality", prompt: "task", expectations: [
      { id: "mechanism", text: "peer completed", severity: "critical", evidence_role: "mechanism", version_scope: "candidate", prerequisite: true, check: { type: "exit_success" } },
      { id: "outcome", text: "result is useful", severity: "quality", evidence_role: "outcome", check: { type: "final_contains", value: "useful" } },
    ] }],
  });
  const records: ExecutionRecord[] = ["anchor", "authored"].map((version) => ({
    schema_version: 2, attempt_id: "training", partition: "training", created_at: now, host: "codex", eval_id: "case", version, repetition: 1,
    run_dir: runDir, output_dir: runDir, skill_path: null, skill_hash_before: null, skill_hash_after: null, source_mutated: false,
    host_result: { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: "not useful", duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: "", stderr_path: "", final_path: "" },
  }));
  await writeJson(join(runDir, "executions.json"), records);
  await completeAttemptManifests(runDir, records);
  await writeJson(join(runDir, "gradings.json"), records.map((record) => ({
    schema_version: 2, attempt_id: "training", partition: "training", host: "codex", eval_id: "case", version: record.version, repetition: 1,
    expectations: [
      ...(record.version === "authored" ? [{ id: "mechanism", text: "peer completed", severity: "critical", evidence_role: "mechanism", version_scope: "candidate", prerequisite: true, passed: true, blocked: false, evidence: "completed" }] : []),
      { id: "outcome", text: "result is useful", severity: "quality", evidence_role: "outcome", version_scope: "all", passed: false, blocked: false, evidence: "missing" },
    ],
    summary: { passed: record.version === "authored" ? 1 : 0, failed: 1, blocked: 0, qualitative: 0, total: record.version === "authored" ? 2 : 1, pass_rate: record.version === "authored" ? 0.5 : 0, critical_failed: 0, critical_blocked: 0, run_failed: false },
  })));

  const benchmark = await buildBenchmark({ runDir, left: "anchor", right: "authored", attemptIds: ["training"], comparisonId: "mechanism-does-not-inflate", partitions: ["training"] });

  expect(benchmark.partitions.training?.versions.anchor?.pass_rate.mean).toBe(0);
  expect(benchmark.partitions.training?.versions.authored?.pass_rate.mean).toBe(0);
  expect(benchmark.partitions.training?.delta.pass_rate).toBe(0);
  expect(benchmark.verdict).toBe("no regression found");
});
