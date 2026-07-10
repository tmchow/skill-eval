import { readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hashValue, readJson, reserveArtifactDir, writeJson } from "./json.ts";
import { analyzeBenchmark } from "./analyzer.ts";
import { summarizeTriggers } from "./triggers.ts";
import { loadRun, loadSuite, verifyRunIntegrity } from "./workspace.ts";
import type { BehaviorAttemptManifest, BenchmarkArtifact, BenchmarkPartition, BenchmarkVersionSummary, EvidencePartition, ExecutionRecord, GradingResult, HumanJudgment, JudgeResult, MetricStats, ModelGradingResult, TriggerResult } from "./types.ts";

async function treeBytes(path: string): Promise<number> {
  const info = await stat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of await readdir(path)) total += await treeBytes(join(path, entry));
  return total;
}

export function calculateStats(values: Array<number | null | undefined>): MetricStats {
  const available = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (available.length === 0) return { count: 0, mean: null, stddev: null, min: null, max: null };
  const mean = available.reduce((sum, value) => sum + value, 0) / available.length;
  const variance = available.length > 1
    ? available.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (available.length - 1)
    : 0;
  return { count: available.length, mean, stddev: Math.sqrt(variance), min: Math.min(...available), max: Math.max(...available) };
}

export interface BenchmarkOptions {
  runDir: string;
  left: string;
  right: string;
  attemptIds: string[];
  comparisonId?: string;
  judgmentComparisonId?: string;
  minimumEffect?: number;
  partitions?: EvidencePartition[];
}

function comparisonId(value?: string): string {
  const id = value ?? `comparison-${Date.now()}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error("comparison id must contain only letters, digits, dot, underscore, or hyphen");
  return id;
}

function determineVerdict(gatesPassed: boolean, gateReasons: string[], effectPasses: boolean, qualitativePasses: boolean, noRegression: boolean): BenchmarkArtifact["verdict"] {
  if (!gatesPassed) {
    if (gateReasons.some((reason) => reason.includes("timed out"))) return "blocked or limited signal";
    if (gateReasons.some((reason) => reason.includes("baseline executor"))) return "blocked or limited signal";
    return gateReasons.some((reason) => reason.includes("failure") || reason.includes("unsuccessful")) ? "critical regression" : "blocked or limited signal";
  }
  if (effectPasses || qualitativePasses) return "improvement demonstrated";
  if (noRegression) return "no regression found";
  return "no demonstrated improvement";
}

export async function buildBenchmark(options: BenchmarkOptions): Promise<BenchmarkArtifact> {
  if (options.attemptIds.length === 0) throw new Error("benchmark requires explicit attempt ids");
  const runDir = resolve(options.runDir);
  await verifyRunIntegrity(runDir);
  const state = await loadRun(runDir);
  const id = comparisonId(options.comparisonId);
  let previousBenchmarks: BenchmarkArtifact[] = [];
  try { previousBenchmarks = await readJson<BenchmarkArtifact[]>(join(runDir, "benchmarks.json")); } catch { /* first benchmark */ }
  if (previousBenchmarks.some((item) => item.comparison_id === id)) throw new Error(`comparison id already exists: ${id}`);
  const attemptSet = new Set(options.attemptIds);
  let judgments: JudgeResult[] = [];
  try { judgments = await readJson<JudgeResult[]>(join(runDir, "judgments.json")); } catch { /* no qualitative cases */ }
  const matchingJudgmentIds = [...new Set(judgments.filter((item) => item.valid
    && item.left_version === options.left
    && item.right_version === options.right
    && attemptSet.has(item.execution_attempt_id)).map((item) => item.comparison_id))];
  if (!options.judgmentComparisonId && matchingJudgmentIds.length > 1) {
    throw new Error("benchmark matches multiple judgment comparisons; provide judgmentComparisonId");
  }
  const selectedJudgmentId = options.judgmentComparisonId ?? matchingJudgmentIds[0];
  const artifactDir = join(runDir, "artifacts", "benchmarks", id);
  await reserveArtifactDir(artifactDir);
  await writeJson(join(artifactDir, "benchmark-attempt.json"), { schema_version: 1, comparison_id: id, status: "started", created_at: new Date().toISOString(), left: options.left, right: options.right, attempt_ids: options.attemptIds });
  const allExecutions = await readJson<ExecutionRecord[]>(join(runDir, "executions.json"));
  const allGradings = await readJson<GradingResult[]>(join(runDir, "gradings.json"));
  const gateReasons: string[] = [];
  for (const attemptId of options.attemptIds) {
    const manifestPath = join(runDir, "artifacts", "runs", attemptId, "attempt.json");
    if (!await Bun.file(manifestPath).exists()) {
      gateReasons.push(`behavior attempt manifest missing: ${attemptId}`);
      continue;
    }
    try {
      const manifest = await readJson<BehaviorAttemptManifest>(manifestPath);
      const actual = allExecutions.filter((item) => item.attempt_id === attemptId).length;
      if (manifest.status !== "complete" || actual !== manifest.planned_records || manifest.record_count !== manifest.planned_records) {
        gateReasons.push(`behavior attempt incomplete: ${attemptId}`);
      }
      if (!Array.isArray(manifest.versions) || !manifest.versions.includes(options.left) || !manifest.versions.includes(options.right)) {
        gateReasons.push(`behavior attempt lacks compared versions: ${attemptId}`);
      }
    } catch {
      gateReasons.push(`behavior attempt manifest invalid: ${attemptId}`);
    }
  }
  let modelGradings: ModelGradingResult[] = [];
  let humanJudgments: HumanJudgment[] = [];
  let triggers: TriggerResult[] = [];
  try { modelGradings = await readJson<ModelGradingResult[]>(join(runDir, "model-gradings.json")); } catch { /* no qualitative grading */ }
  try { humanJudgments = await readJson<HumanJudgment[]>(join(runDir, "human-judgments.json")); } catch { /* no human adjudication */ }
  try { triggers = await readJson<TriggerResult[]>(join(runDir, "triggers.json")); } catch { /* trigger suite not run */ }

  const executions = allExecutions.filter((item) => attemptSet.has(item.attempt_id));
  if (executions.length === 0) throw new Error("selected attempts contain no executions");
  const gradings = allGradings.filter((item) => item.attempt_id !== undefined && attemptSet.has(item.attempt_id));
  const partitions: Partial<Record<EvidencePartition, BenchmarkPartition>> = {};
  let suite: Awaited<ReturnType<typeof loadSuite>> | null = null;
  try { suite = await loadSuite(runDir); } catch { /* legacy test artifact without a frozen suite */ }
  const skillBytes = new Map<string, number>();
  await Promise.all([options.left, options.right].map(async (version) => {
    const path = state.versions[version]?.path;
    skillBytes.set(version, path ? await treeBytes(path) : 0);
  }));

  const requiredPartitions = options.partitions ?? ["training", "holdout"];
  for (const partition of requiredPartitions) {
    const partitionRuns = executions.filter((item) => item.partition === partition);
    if (partitionRuns.length === 0) {
      gateReasons.push(`missing ${partition} evidence`);
      continue;
    }
    const expectedEvalIds = suite
      ? suite.evals.filter((item) => partition === (item.holdout ? "holdout" : "training")).map((item) => item.id)
      : [...new Set(partitionRuns.map((item) => item.eval_id))];
    for (const evalId of expectedEvalIds) {
      for (const host of state.requested_hosts) {
        const leftRepetitions = partitionRuns.filter((item) => item.eval_id === evalId && item.host === host && item.version === options.left).map((item) => item.repetition).sort();
        const rightRepetitions = partitionRuns.filter((item) => item.eval_id === evalId && item.host === host && item.version === options.right).map((item) => item.repetition).sort();
        if (leftRepetitions.length === 0 || JSON.stringify(leftRepetitions) !== JSON.stringify(rightRepetitions)) gateReasons.push(`${partition} coverage incomplete for ${host}/${evalId}`);
      }
    }
    if (suite) {
      for (const run of partitionRuns) {
        const evalCase = suite.evals.find((item) => item.id === run.eval_id);
        if (!evalCase?.expectations.some((expectation) => !expectation.check)) continue;
        const qualitative = modelGradings.filter((item) => item.execution_attempt_id === run.attempt_id && item.executor_host === run.host && item.eval_id === run.eval_id && item.version === run.version && item.repetition === run.repetition);
        if (qualitative.length === 0 || qualitative.every((item) => !item.valid)) {
          gateReasons.push(`${partition} qualitative grading missing for ${run.host}/${run.eval_id}/${run.version}/run-${run.repetition}`);
        } else if (qualitative.some((item) => !item.valid)) {
          gateReasons.push(`${partition} qualitative grader failed for ${run.host}/${run.eval_id}/${run.version}/run-${run.repetition}`);
        }
      }
    }
    const versionSummary = (version: string): BenchmarkVersionSummary => {
      const runs = partitionRuns.filter((item) => item.version === version);
      const grades = gradings.filter((item) => item.partition === partition && item.version === version);
      const unsuccessful = runs.filter((item) => item.host_result.exit_code !== 0 || item.host_result.timed_out || item.host_result.malformed_events > 0 || item.source_mutated).length;
      const effectiveGrades = grades.map((grade) => {
        const model = modelGradings.filter((item) => item.valid && item.execution_attempt_id === grade.attempt_id && item.partition === partition && item.executor_host === grade.host && item.eval_id === grade.eval_id && item.version === version && item.repetition === grade.repetition);
        const expectationIds = [...new Set(model.flatMap((item) => item.expectations.map((expectation) => expectation.id)))];
        let modelPassed = 0; let modelFailed = 0; let modelBlocked = 0; let modelCriticalFailed = 0; let modelCriticalBlocked = 0;
        for (const expectationId of expectationIds) {
          const outcomes = model.flatMap((item) => item.expectations.filter((expectation) => expectation.id === expectationId));
          const statuses = new Set(outcomes.map((item) => item.status));
          const severity = outcomes[0]?.severity;
          if (statuses.size === 1 && statuses.has("PASS")) modelPassed += 1;
          else if (statuses.size === 1 && statuses.has("FAIL")) { modelFailed += 1; if (severity === "critical") modelCriticalFailed += 1; }
          else { modelBlocked += 1; if (severity === "critical") modelCriticalBlocked += 1; }
        }
        const passed = grade.summary.passed + modelPassed;
        const failed = grade.summary.failed + modelFailed;
        return {
          passRate: grade.summary.run_failed ? 0 : passed + failed > 0 ? passed / (passed + failed) : null,
          criticalFailed: grade.summary.critical_failed + modelCriticalFailed,
          criticalBlocked: grade.summary.critical_blocked + modelCriticalBlocked,
          blocked: grade.summary.blocked + modelBlocked,
        };
      });
      return {
        runs: runs.length,
        successful_runs: runs.length - unsuccessful,
        unsuccessful_runs: unsuccessful,
        timed_out_runs: runs.filter((item) => item.host_result.timed_out).length,
        pass_rate: calculateStats(effectiveGrades.map((item) => item.passRate)),
        duration_ms: calculateStats(runs.map((item) => item.host_result.duration_ms)),
        total_tokens: calculateStats(runs.map((item) => item.host_result.usage.total_tokens)),
        cost_usd: calculateStats(runs.map((item) => item.host_result.usage.cost_usd)),
        tool_calls: calculateStats(runs.map((item) => item.host_result.metrics?.tool_calls)),
        errors: calculateStats(runs.map((item) => item.host_result.metrics?.errors)),
        critical_failed: effectiveGrades.reduce((sum, item) => sum + item.criticalFailed, 0),
        critical_blocked: effectiveGrades.reduce((sum, item) => sum + item.criticalBlocked, 0),
        blocked: effectiveGrades.reduce((sum, item) => sum + item.blocked, 0),
        skill_bytes: skillBytes.get(version) ?? 0,
        trigger: triggers.some((item) => item.version === version && item.partition === partition)
          ? summarizeTriggers(triggers.filter((item) => item.version === version && item.partition === partition))
          : null,
      };
    };
    const left = versionSummary(options.left);
    const right = versionSummary(options.right);
    if (left.runs === 0 || right.runs === 0) gateReasons.push(`${partition} evidence does not include both versions`);
    if (left.timed_out_runs > 0 || right.timed_out_runs > 0) gateReasons.push(`${partition} executor timed out; result is inconclusive`);
    if (left.unsuccessful_runs > left.timed_out_runs) gateReasons.push(`${partition} baseline executor has unsuccessful runs; comparison is inconclusive`);
    if (right.unsuccessful_runs > right.timed_out_runs) gateReasons.push(`${partition} candidate has unsuccessful executor runs`);
    if (right.critical_failed > 0) gateReasons.push(`${partition} candidate has critical failures`);
    if (right.critical_blocked > 0) gateReasons.push(`${partition} candidate has blocked critical checks`);
    const leftPass = left.pass_rate.mean;
    const rightPass = right.pass_rate.mean;
    partitions[partition] = {
      versions: { [options.left]: left, [options.right]: right },
      delta: {
        pass_rate: leftPass === null || rightPass === null ? null : rightPass - leftPass,
        duration_ms: left.duration_ms.mean === null || right.duration_ms.mean === null ? null : right.duration_ms.mean - left.duration_ms.mean,
        total_tokens: left.total_tokens.mean === null || right.total_tokens.mean === null ? null : right.total_tokens.mean - left.total_tokens.mean,
        cost_usd: left.cost_usd.mean === null || right.cost_usd.mean === null ? null : right.cost_usd.mean - left.cost_usd.mean,
        skill_bytes: right.skill_bytes - left.skill_bytes,
      },
    };
  }

  const validJudgments = judgments.filter((item) => item.valid
    && (!selectedJudgmentId || item.comparison_id === selectedJudgmentId)
    && item.left_version === options.left
    && item.right_version === options.right
    && attemptSet.has(item.execution_attempt_id));
  const validHumanJudgments = humanJudgments.filter((human) => attemptSet.has(human.execution_attempt_id) && judgments.some((judgment) =>
    (!selectedJudgmentId || judgment.comparison_id === selectedJudgmentId)
    &&
    judgment.comparison_id === human.comparison_id
    && judgment.execution_attempt_id === human.execution_attempt_id
    && judgment.eval_id === human.eval_id
    && judgment.executor_host === human.executor_host
    && judgment.repetition === human.repetition
    && judgment.left_version === options.left
    && judgment.right_version === options.right));
  const preferences = {
    left: validJudgments.filter((item) => item.preferred_version === options.left).length,
    right: validJudgments.filter((item) => item.preferred_version === options.right).length,
    tie: validJudgments.filter((item) => item.preferred_version === "TIE").length,
    human_left: validHumanJudgments.filter((item) => item.preferred_version === options.left).length,
    human_right: validHumanJudgments.filter((item) => item.preferred_version === options.right).length,
    human_tie: validHumanJudgments.filter((item) => item.preferred_version === "TIE").length,
  };
  const judgeHosts = [...new Set(validJudgments.map((item) => item.judge_host))];
  const judgeHostPreferences = Object.fromEntries(judgeHosts.map((host) => {
    const selected = validJudgments.filter((item) => item.judge_host === host);
    return [host, {
      left: selected.filter((item) => item.preferred_version === options.left).length,
      right: selected.filter((item) => item.preferred_version === options.right).length,
      tie: selected.filter((item) => item.preferred_version === "TIE").length,
    }];
  }));
  const judgmentCases = new Map<string, JudgeResult[]>();
  for (const judgment of validJudgments) {
    const key = `${judgment.execution_attempt_id}\0${judgment.eval_id}\0${judgment.executor_host}\0${judgment.repetition}`;
    judgmentCases.set(key, [...(judgmentCases.get(key) ?? []), judgment]);
  }
  let agreementCases = 0; let disagreementCases = 0;
  for (const selected of judgmentCases.values()) {
    if (new Set(selected.map((item) => item.judge_host)).size < 2) continue;
    if (new Set(selected.map((item) => item.preferred_version)).size === 1) agreementCases += 1;
    else disagreementCases += 1;
  }
  const crossModel = { judge_hosts: judgeHostPreferences, agreement_cases: agreementCases, disagreement_cases: disagreementCases };
  const gatesPassed = gateReasons.length === 0;
  const minimumEffect = options.minimumEffect ?? 0.05;
  const partitionDeltas = Object.values(partitions).map((item) => item.delta.pass_rate);
  const deltas = partitionDeltas.filter((value): value is number => typeof value === "number");
  const objectiveNonRegression = partitionDeltas.length === requiredPartitions.length && partitionDeltas.every((value) => value === null || value >= 0);
  const effectPasses = deltas.length === requiredPartitions.length && deltas.every((value) => value >= minimumEffect);
  const agentPreferenceTotal = preferences.left + preferences.right + preferences.tie;
  const strongAgentPreference = preferences.right >= 2 && preferences.left === 0 && preferences.right / agentPreferenceTotal >= 2 / 3;
  const qualitativePasses = objectiveNonRegression && ((preferences.human_right > 0 && preferences.human_left === 0) || strongAgentPreference);
  const noRegression = objectiveNonRegression && preferences.right >= preferences.left && preferences.human_left === 0;
  const verdict = determineVerdict(gatesPassed, gateReasons, effectPasses, qualitativePasses, noRegression);
  const unsignedBase = {
    schema_version: 1 as const,
    comparison_id: id,
    created_at: new Date().toISOString(),
    comparison: { left: options.left, right: options.right },
    attempt_ids: [...options.attemptIds],
    partitions,
    preferences,
    cross_model: crossModel,
    gates: { passed: gatesPassed, reasons: gateReasons },
    verdict,
  };
  const notes = analyzeBenchmark(unsignedBase as BenchmarkArtifact);
  const unsigned = { ...unsignedBase, notes };
  const benchmark: BenchmarkArtifact = { ...unsigned, evidence_hash: hashValue(unsigned) };
  await writeJson(join(artifactDir, "benchmark.json"), benchmark);
  await writeJson(join(runDir, "benchmarks.json"), [...previousBenchmarks, benchmark]);
  await writeJson(join(runDir, "benchmark.json"), benchmark);
  await writeFile(join(artifactDir, "benchmark.md"), `# Skill Eval Benchmark\n\n- Comparison: \`${options.left}\` -> \`${options.right}\`\n- Verdict: **${verdict}**\n- Gates: ${gatesPassed ? "pass" : gateReasons.join("; ")}\n- Attempts: ${options.attemptIds.join(", ")}\n`);
  await writeJson(join(artifactDir, "benchmark-attempt.json"), { schema_version: 1, comparison_id: id, status: "complete", completed_at: new Date().toISOString(), left: options.left, right: options.right, attempt_ids: options.attemptIds, evidence_hash: benchmark.evidence_hash });
  return benchmark;
}
