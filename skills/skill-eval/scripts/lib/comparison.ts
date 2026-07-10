import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { behaviorAttemptId, nextArtifactId, relatedId, validateEvaluationInputs } from "./artifacts.ts";
import { gradeMatrix } from "./assertions.ts";
import { buildBenchmark } from "./benchmark.ts";
import { runMatrix } from "./executor.ts";
import { readJson } from "./json.ts";
import { runBlindJudges } from "./judges.ts";
import { runModelGraders } from "./model-grader.ts";
import { loadRun, loadSuite } from "./workspace.ts";
import type { BenchmarkArtifact, ExecutionRecord, HostAdapter, HostName, JudgeResult, ModelGradingResult } from "./types.ts";

export interface CompareVersionsOptions {
  runDir: string;
  left: string;
  right: string;
  label: string;
  hosts: HostName[];
  judgeHosts: HostName[];
  repetitions?: number;
  executorTimeoutMs?: number;
  graderTimeoutMs?: number;
  judgeTimeoutMs?: number;
  adapters?: Partial<Record<HostName, HostAdapter>>;
  models?: Partial<Record<HostName, string>>;
}

export async function compareVersions(options: CompareVersionsOptions): Promise<BenchmarkArtifact> {
  const runDir = resolve(options.runDir);
  const suite = await loadSuite(runDir);
  if (!suite.evals.some((item) => !item.holdout)) throw new Error("behavior comparison requires at least one training eval");
  if (options.left === options.right) throw new Error("behavior comparison requires two distinct versions");
  validateEvaluationInputs(await loadRun(runDir), [options.left, options.right], options.hosts, options.judgeHosts);

  let executions: ExecutionRecord[] = [];
  try { executions = await readJson<ExecutionRecord[]>(join(runDir, "executions.json")); } catch { /* first comparison */ }
  const attemptId = await behaviorAttemptId(runDir, `${options.label}-training`, executions);
  await runMatrix({
    runDir,
    versions: [options.left, options.right],
    hosts: options.hosts,
    repetitions: options.repetitions ?? 1,
    timeoutMs: options.executorTimeoutMs ?? 1_800_000,
    adapters: options.adapters,
    models: options.models,
    attemptId,
    partition: "training",
    resume: true,
  });
  const grades = await gradeMatrix(runDir);
  const skipQualitative = grades.some((item) => item.attempt_id === attemptId && item.version === options.right
    && (item.summary.critical_failed > 0 || item.summary.critical_blocked > 0));

  if (!skipQualitative && suite.evals.some((item) => !item.holdout && item.expectations.some((expectation) => !expectation.check))) {
    let modelGradings: ModelGradingResult[] = [];
    try { modelGradings = await readJson<ModelGradingResult[]>(join(runDir, "model-gradings.json")); } catch { /* first qualitative grading */ }
    const gradingBase = `${options.label}-qualitative`;
    const gradingId = [...new Set(modelGradings.filter((item) => relatedId(item.grading_id, gradingBase) && item.execution_attempt_id === attemptId).map((item) => item.grading_id))].reverse()[0]
      ?? await nextArtifactId(gradingBase, (id) => join(runDir, "artifacts", "model-graders", id));
    if (!modelGradings.some((item) => item.grading_id === gradingId)) {
      await runModelGraders({ runDir, executionAttemptIds: [attemptId], gradingId, graderHosts: options.judgeHosts, adapters: options.adapters, timeoutMs: options.graderTimeoutMs ?? 300_000, models: options.models });
    }
  }

  let judgments: JudgeResult[] = [];
  try { judgments = await readJson<JudgeResult[]>(join(runDir, "judgments.json")); } catch { /* first blind comparison */ }
  const judgeBase = `${options.label}-judge`;
  const comparisonId = skipQualitative ? undefined : [...new Set(judgments.filter((item) => relatedId(item.comparison_id, judgeBase)
    && item.execution_attempt_id === attemptId
    && item.left_version === options.left
    && item.right_version === options.right).map((item) => item.comparison_id))].reverse()[0]
    ?? await nextArtifactId(judgeBase, (id) => join(runDir, "artifacts", "judges", createHash("sha256").update(id).digest("hex").slice(0, 16)));
  if (comparisonId && !judgments.some((item) => item.comparison_id === comparisonId)) {
    await runBlindJudges({ runDir, left: options.left, right: options.right, executionAttemptIds: [attemptId], comparisonId, judgeHosts: options.judgeHosts, adapters: options.adapters, timeoutMs: options.judgeTimeoutMs ?? 300_000, models: options.models });
  }

  const benchmarkId = await nextArtifactId(`${options.label}-benchmark`, (id) => join(runDir, "artifacts", "benchmarks", id));
  return buildBenchmark({ runDir, left: options.left, right: options.right, attemptIds: [attemptId], comparisonId: benchmarkId, judgmentComparisonId: comparisonId, partitions: ["training"] });
}
