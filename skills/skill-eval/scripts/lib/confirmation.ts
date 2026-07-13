import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { behaviorAttemptId, nextArtifactId, relatedId, validateEvaluationInputs } from "./artifacts.ts";
import { gradeMatrix } from "./assertions.ts";
import { buildBenchmark } from "./benchmark.ts";
import { sealEvidenceClaim, verifyEvidenceClaimHash } from "./evidence-claim.ts";
import { runMatrix } from "./executor.ts";
import { hasBlindJudgeCriteria } from "./expectations.ts";
import { readJson } from "./json.ts";
import { runBlindJudges } from "./judges.ts";
import { runModelGraders } from "./model-grader.ts";
import { runtimeOverrides } from "./runtime.ts";
import { assertSuiteApproved } from "./suite-critic.ts";
import { assertConfirmationValidity } from "./validity.ts";
import { loadRun, loadSuite } from "./workspace.ts";
import type { BenchmarkArtifact, EvidenceClaim, ExecutionRecord, GradingResult, HostAdapter, HostName, JudgeResult, ModelGradingResult, RuntimeRoleProfiles } from "./types.ts";

export interface ConfirmOptions {
  runDir: string;
  label: string;
  hosts: HostName[];
  judgeHosts: HostName[];
  repetitions?: number;
  executorTimeoutMs?: number;
  graderTimeoutMs?: number;
  judgeTimeoutMs?: number;
  adapters?: Partial<Record<HostName, HostAdapter>>;
  models?: Partial<Record<HostName, string>>;
  reasoningEfforts?: Partial<Record<HostName, string>>;
  runtimeProfiles?: RuntimeRoleProfiles;
}

export interface ConfirmationResult {
  benchmark: BenchmarkArtifact;
  claim: EvidenceClaim;
}

function criticalObjectiveFailure(grades: GradingResult[], attemptIds: string[]): boolean {
  const attempts = new Set(attemptIds);
  return grades.some((item) => item.attempt_id && attempts.has(item.attempt_id) && item.version === "authored"
    && (item.summary.critical_failed > 0 || item.summary.critical_blocked > 0));
}

export async function confirmAuthored(options: ConfirmOptions): Promise<ConfirmationResult> {
  const runDir = resolve(options.runDir);
  const suite = await loadSuite(runDir);
  const state = await loadRun(runDir);
  assertConfirmationValidity(suite);
  await assertSuiteApproved(runDir);
  if (!suite.evals.some((item) => !item.validation) || !suite.evals.some((item) => item.validation)) {
    throw new Error("confirmation requires both training and validation behavior cases");
  }
  validateEvaluationInputs(state, ["anchor", "authored"], options.hosts, options.judgeHosts);
  if (JSON.stringify([...new Set(options.hosts)].sort()) !== JSON.stringify([...new Set(state.requested_hosts)].sort())) {
    throw new Error("confirmation hosts must exactly match the hosts frozen during prepare");
  }

  let executions: ExecutionRecord[] = [];
  try { executions = await readJson<ExecutionRecord[]>(join(runDir, "executions.json")); } catch { /* first confirmation */ }
  const trainingAttempt = await behaviorAttemptId(runDir, `${options.label}-training`, executions);
  const validationAttempt = await behaviorAttemptId(runDir, `${options.label}-validation`, executions);
  const behaviorRuntime = runtimeOverrides(options, "behavior");
  const evaluatorRuntime = runtimeOverrides(options, "evaluator");
  const common = {
    runDir,
    versions: ["anchor", "authored"],
    hosts: options.hosts,
    repetitions: options.repetitions ?? 1,
    timeoutMs: options.executorTimeoutMs ?? 1_800_000,
    adapters: options.adapters,
    models: behaviorRuntime.models,
    reasoningEfforts: behaviorRuntime.reasoningEfforts,
    resume: true,
  };
  await runMatrix({ ...common, attemptId: trainingAttempt, partition: "training" });
  await runMatrix({ ...common, attemptId: validationAttempt, partition: "validation" });
  const attempts = [trainingAttempt, validationAttempt];
  const grades = await gradeMatrix(runDir);
  const skipQualitative = criticalObjectiveFailure(grades, attempts);

  if (!skipQualitative && suite.evals.some((item) => item.expectations.some((expectation) => !expectation.check && expectation.scope !== "comparison"))) {
    let modelGradings: ModelGradingResult[] = [];
    try { modelGradings = await readJson<ModelGradingResult[]>(join(runDir, "model-gradings.json")); } catch { /* first grading */ }
    const gradingBase = `${options.label}-qualitative`;
    const existingId = [...new Set(modelGradings.map((item) => item.grading_id).filter((id) => relatedId(id, gradingBase)))].reverse()
      .find((id) => attempts.every((attempt) => modelGradings.some((item) => item.grading_id === id && item.execution_attempt_id === attempt)));
    const gradingId = existingId ?? await nextArtifactId(gradingBase, (id) => join(runDir, "artifacts", "model-graders", id));
    if (!modelGradings.some((item) => item.grading_id === gradingId)) {
      await runModelGraders({ runDir, executionAttemptIds: attempts, gradingId, graderHosts: options.judgeHosts, adapters: options.adapters, timeoutMs: options.graderTimeoutMs ?? 300_000, models: evaluatorRuntime.models, reasoningEfforts: evaluatorRuntime.reasoningEfforts });
    }
  }

  let judgments: JudgeResult[] = [];
  try { judgments = await readJson<JudgeResult[]>(join(runDir, "judgments.json")); } catch { /* first comparison */ }
  const judgeBase = `${options.label}-judge`;
  const hasQualitativeComparison = suite.evals.some((item) => hasBlindJudgeCriteria(item, "anchor", "authored"));
  const comparisonId = skipQualitative || !hasQualitativeComparison ? undefined : [...new Set(judgments.filter((item) => relatedId(item.comparison_id, judgeBase)
    && item.left_version === "anchor" && item.right_version === "authored").map((item) => item.comparison_id))].reverse()
    .find((id) => attempts.every((attempt) => judgments.some((item) => item.comparison_id === id && item.execution_attempt_id === attempt)))
    ?? await nextArtifactId(judgeBase, (id) => join(runDir, "artifacts", "judges", createHash("sha256").update(id).digest("hex").slice(0, 16)));
  if (comparisonId && !judgments.some((item) => item.comparison_id === comparisonId)) {
    await runBlindJudges({ runDir, left: "anchor", right: "authored", executionAttemptIds: attempts, comparisonId, judgeHosts: options.judgeHosts, adapters: options.adapters, timeoutMs: options.judgeTimeoutMs ?? 300_000, models: evaluatorRuntime.models, reasoningEfforts: evaluatorRuntime.reasoningEfforts });
  }

  const benchmarkId = await nextArtifactId(`${options.label}-benchmark`, (id) => join(runDir, "artifacts", "benchmarks", id));
  const benchmark = await buildBenchmark({ runDir, left: "anchor", right: "authored", attemptIds: attempts, comparisonId: benchmarkId, judgmentComparisonId: comparisonId, partitions: ["training", "validation"] });
  const claimId = await nextArtifactId(`${options.label}-claim`, (id) => join(runDir, "claims", `${id}.json`));
  const claim = await sealEvidenceClaim({ runDir, benchmarkId: benchmark.comparison_id, claimId });
  if (!verifyEvidenceClaimHash(claim)) throw new Error("sealed evidence claim hash is invalid");
  return { benchmark, claim };
}
