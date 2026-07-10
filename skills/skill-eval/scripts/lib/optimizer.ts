import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { behaviorAttemptId, nextArtifactId, relatedId, validateEvaluationInputs } from "./artifacts.ts";
import { gradeMatrix } from "./assertions.ts";
import { buildBenchmark } from "./benchmark.ts";
import { sealDecision, verifyDecisionHash } from "./decision.ts";
import { runMatrix } from "./executor.ts";
import { createHostAdapters } from "./hosts.ts";
import { createOperation, instrumentAdapters } from "./operations.ts";
import type { OperationLimits } from "./operations.ts";
import { runBlindJudges } from "./judges.ts";
import { copyTree, readJson, writeJson } from "./json.ts";
import { runModelGraders } from "./model-grader.ts";
import { addVersion, loadRun, loadSuite } from "./workspace.ts";
import type { BenchmarkArtifact, EvidencePartition, ExecutionRecord, GradingResult, HostAdapter, HostName, JudgeResult, ModelGradingResult } from "./types.ts";

export interface RevisionRequest {
  iteration: number;
  incumbent: string;
  training_feedback: string[];
}

export interface CandidateEvaluation {
  candidate: string;
  accepted: boolean;
  converged: boolean;
  decision_id: string | null;
  training_feedback: string[];
  summary: string;
  cross_model?: BenchmarkArtifact["cross_model"];
}

export interface RevisionProposal {
  candidate: string;
  hypothesis: string;
}

export interface OptimizationProgress {
  iteration: number;
  candidate: string;
  accepted: boolean;
  summary: string;
  next_adjustment: string | null;
  hypothesis: string;
  takeaway: string;
  cross_model?: BenchmarkArtifact["cross_model"];
}

export interface OptimizationState {
  schema_version: 1;
  status: "active" | "converged" | "stalled" | "max-revisions";
  incumbent: string;
  decision_id: string | null;
  training_feedback: string[];
  iterations: Array<CandidateEvaluation & { iteration: number; hypothesis: string; takeaway: string }>;
  consecutive_no_progress: number;
  updated_at: string;
}

export interface OptimizationLoopOptions {
  runDir: string;
  initialIncumbent: string;
  initialTrainingFeedback: string[];
  maxRevisions?: number;
  revise(request: RevisionRequest): Promise<RevisionProposal>;
  evaluate(request: { iteration: number; incumbent: string; candidate: string }): Promise<CandidateEvaluation>;
  onProgress?(event: OptimizationProgress): void | Promise<void>;
}

export async function runOptimizationLoop(options: OptimizationLoopOptions): Promise<OptimizationState> {
  const runDir = resolve(options.runDir);
  const statePath = join(runDir, "optimization.json");
  let state: OptimizationState;
  try { state = await readJson<OptimizationState>(statePath); }
  catch {
    state = { schema_version: 1, status: "active", incumbent: options.initialIncumbent, decision_id: null, training_feedback: [...options.initialTrainingFeedback], iterations: [], consecutive_no_progress: 0, updated_at: new Date().toISOString() };
    await writeJson(statePath, state);
  }
  if (state.status !== "active") return state;
  const limit = Math.min(5, Math.max(1, options.maxRevisions ?? 5));
  for (let iteration = state.iterations.length + 1; iteration <= limit; iteration += 1) {
    const incumbent = state.incumbent;
    const proposal = await options.revise({ iteration, incumbent, training_feedback: [...state.training_feedback] });
    const candidate = proposal.candidate;
    if (!candidate || candidate === incumbent) {
      state.status = "stalled";
      state.updated_at = new Date().toISOString();
      await writeJson(statePath, state);
      return state;
    }
    const evaluation = await options.evaluate({ iteration, incumbent, candidate });
    let takeaway = evaluation.summary;
    const previousDisagreements = state.iterations.at(-1)?.cross_model?.disagreement_cases;
    const currentDisagreements = evaluation.cross_model?.disagreement_cases;
    if (previousDisagreements !== undefined && currentDisagreements !== undefined && currentDisagreements < previousDisagreements) takeaway += `; cross-model disagreements ${previousDisagreements} -> ${currentDisagreements}`;
    else if ((currentDisagreements ?? 0) > 0) takeaway += `; ${currentDisagreements} cross-model judge disagreement${currentDisagreements === 1 ? "" : "s"} remain`;
    state.iterations.push({ iteration, ...evaluation, hypothesis: proposal.hypothesis, takeaway });
    if (evaluation.accepted) {
      state.incumbent = candidate;
      state.decision_id = evaluation.decision_id;
      state.consecutive_no_progress = 0;
    } else {
      state.consecutive_no_progress += 1;
    }
    state.training_feedback = [...evaluation.training_feedback];
    state.updated_at = new Date().toISOString();
    if (evaluation.converged && evaluation.accepted) state.status = "converged";
    else if (state.consecutive_no_progress >= 2) state.status = "stalled";
    else if (iteration === limit) state.status = "max-revisions";
    await writeJson(statePath, state);
    await options.onProgress?.({ iteration, candidate, accepted: evaluation.accepted, summary: evaluation.summary, hypothesis: proposal.hypothesis, takeaway, cross_model: evaluation.cross_model, next_adjustment: state.status === "active" ? state.training_feedback[0] ?? "generate a materially different challenger" : null });
    if (state.status !== "active") return state;
  }
  return state;
}

export interface BehaviorOptimizerOptions {
  runDir: string;
  hosts: HostName[];
  judgeHosts: HostName[];
  reviserHost?: HostName;
  repetitions?: number;
  maxRevisions?: number;
  timeoutMs?: number;
  executorTimeoutMs?: number;
  graderTimeoutMs?: number;
  judgeTimeoutMs?: number;
  reviserTimeoutMs?: number;
  adapters?: Partial<Record<HostName, HostAdapter>>;
  models?: Partial<Record<HostName, string>>;
  skillCreatorPath?: string;
  limits?: OperationLimits;
  onProgress?(event: OptimizationProgress): void | Promise<void>;
}

function criticalObjectiveFailure(grades: GradingResult[], attemptIds: string[], candidate: string): boolean {
  const attempts = new Set(attemptIds);
  return grades.some((item) => item.attempt_id && attempts.has(item.attempt_id) && item.version === candidate
    && (item.summary.critical_failed > 0 || item.summary.critical_blocked > 0));
}

function benchmarkConverged(benchmark: BenchmarkArtifact, candidate: string): boolean {
  return benchmark.gates.passed && (["training", "holdout"] as EvidencePartition[]).every((partition) => {
    const summary = benchmark.partitions[partition]?.versions?.[candidate];
    return summary?.pass_rate?.mean === 1 && summary?.critical_failed === 0 && summary?.critical_blocked === 0;
  });
}

async function trainingFeedback(runDir: string, attemptId: string, candidate: string, benchmarks: BenchmarkArtifact[]): Promise<string[]> {
  const grades = await readJson<GradingResult[]>(join(runDir, "gradings.json"));
  const evidence = grades.filter((item) => item.attempt_id === attemptId && item.partition === "training" && item.version === candidate)
    .flatMap((item) => item.expectations.filter((expectation) => expectation.passed === false || expectation.blocked).map((expectation) => `${item.eval_id}/${expectation.id}: ${expectation.evidence}`));
  let modelGradings: ModelGradingResult[] = [];
  try { modelGradings = await readJson<ModelGradingResult[]>(join(runDir, "model-gradings.json")); } catch { /* no qualitative expectations */ }
  for (const grade of modelGradings.filter((item) => item.execution_attempt_id === attemptId && item.partition === "training" && item.version === candidate)) {
    evidence.push(...grade.expectations.filter((item) => item.status !== "PASS").map((item) => `${grade.eval_id}/${item.id}: ${item.status.toLowerCase()} - ${item.evidence}`));
    evidence.push(...grade.eval_feedback.filter((item) => typeof item?.issue === "string" && item.issue.trim()).map((item) => `${grade.eval_id}${item.expectation_id ? `/${item.expectation_id}` : ""}: eval issue - ${item.issue}`));
    evidence.push(...grade.claims.filter((item) => item.verified === false).map((item) => `${grade.eval_id}: unverified ${item.type} claim - ${item.claim}`));
  }
  let judgments: JudgeResult[] = [];
  try { judgments = await readJson<JudgeResult[]>(join(runDir, "judgments.json")); } catch { /* no blind comparisons */ }
  for (const judgment of judgments.filter((item) => item.execution_attempt_id === attemptId && item.valid)) {
    const candidateLabel = judgment.labels.A === candidate ? "A" : judgment.labels.B === candidate ? "B" : null;
    if (candidateLabel) evidence.push(...(judgment.weaknesses?.[candidateLabel] ?? []).map((item) => `${judgment.eval_id}: comparator weakness - ${item}`));
  }
  for (const benchmark of benchmarks) evidence.push(...(benchmark.notes ?? []).filter((note) => note.startsWith("training:")));
  return [...new Set(evidence)].slice(0, 20);
}

export async function certifyCandidate(options: BehaviorOptimizerOptions & { candidate: string; incumbent: string; label: string }): Promise<CandidateEvaluation> {
  const runDir = resolve(options.runDir);
  const suite = await loadSuite(runDir);
  if (!suite.evals.some((item) => !item.holdout) || !suite.evals.some((item) => item.holdout)) {
    throw new Error("behavior certification requires both training and held-out evals");
  }
  const versions = [...new Set(["anchor", options.incumbent, options.candidate])];
  validateEvaluationInputs(await loadRun(runDir), versions, options.hosts, options.judgeHosts);
  let executions: ExecutionRecord[] = [];
  try { executions = await readJson<ExecutionRecord[]>(join(runDir, "executions.json")); } catch { /* first certification */ }
  const trainingAttempt = await behaviorAttemptId(runDir, `${options.label}-training`, executions);
  const holdoutAttempt = await behaviorAttemptId(runDir, `${options.label}-holdout`, executions);
  const common = { runDir, versions, hosts: options.hosts, repetitions: options.repetitions ?? 1, timeoutMs: options.executorTimeoutMs ?? options.timeoutMs ?? 1_800_000, adapters: options.adapters, models: options.models, resume: true };
  await runMatrix({ ...common, attemptId: trainingAttempt, partition: "training" });
  await runMatrix({ ...common, attemptId: holdoutAttempt, partition: "holdout" });
  const grades = await gradeMatrix(runDir);
  const attempts = [trainingAttempt, holdoutAttempt];
  const skipQualitative = criticalObjectiveFailure(grades, attempts, options.candidate);
  if (!skipQualitative && suite.evals.some((item) => item.expectations.some((expectation) => !expectation.check))) {
    let modelGradings: ModelGradingResult[] = [];
    try { modelGradings = await readJson<ModelGradingResult[]>(join(runDir, "model-gradings.json")); } catch { /* first qualitative grading */ }
    const gradingBase = `${options.label}-qualitative`;
    const qualitativeAttempts = attempts.filter((attempt, index) => suite.evals.some((item) => item.holdout === (index === 1) && item.expectations.some((expectation) => !expectation.check)));
    const existingGradingId = [...new Set(modelGradings.map((item) => item.grading_id).filter((id) => relatedId(id, gradingBase)))].reverse()
      .find((id) => qualitativeAttempts.every((attempt) => modelGradings.some((item) => item.grading_id === id && item.execution_attempt_id === attempt)));
    const gradingId = existingGradingId
      ?? await nextArtifactId(gradingBase, (id) => join(runDir, "artifacts", "model-graders", id));
    if (!modelGradings.some((item) => item.grading_id === gradingId)) await runModelGraders({ runDir, executionAttemptIds: attempts, gradingId, graderHosts: options.judgeHosts, adapters: options.adapters, timeoutMs: options.graderTimeoutMs ?? 300_000, models: options.models });
  }
  let judgments: JudgeResult[] = [];
  try { judgments = await readJson<JudgeResult[]>(join(runDir, "judgments.json")); } catch { /* first comparison */ }
  const anchorBase = `${options.label}-anchor`;
  const anchorComparisonId = skipQualitative ? undefined : [...new Set(judgments.filter((item) => relatedId(item.comparison_id, anchorBase) && item.left_version === "anchor" && item.right_version === options.candidate).map((item) => item.comparison_id))].reverse()
    .find((id) => attempts.every((attempt) => judgments.some((item) => item.comparison_id === id && item.execution_attempt_id === attempt)))
    ?? await nextArtifactId(anchorBase, (id) => join(runDir, "artifacts", "judges", createHash("sha256").update(id).digest("hex").slice(0, 16)));
  if (anchorComparisonId && !judgments.some((item) => item.comparison_id === anchorComparisonId)) await runBlindJudges({ runDir, left: "anchor", right: options.candidate, executionAttemptIds: attempts, comparisonId: anchorComparisonId, judgeHosts: options.judgeHosts, adapters: options.adapters, timeoutMs: options.judgeTimeoutMs ?? 300_000, models: options.models });
  const anchorBenchmarkId = await nextArtifactId(anchorBase, (id) => join(runDir, "artifacts", "benchmarks", id));
  const anchorBenchmark = await buildBenchmark({ runDir, left: "anchor", right: options.candidate, attemptIds: attempts, comparisonId: anchorBenchmarkId, judgmentComparisonId: anchorComparisonId });
  let incumbentBenchmark: BenchmarkArtifact | null = null;
  if (options.incumbent !== "anchor") {
    const incumbentBase = `${options.label}-incumbent`;
    const incumbentComparisonId = skipQualitative ? undefined : [...new Set(judgments.filter((item) => relatedId(item.comparison_id, incumbentBase) && item.left_version === options.incumbent && item.right_version === options.candidate).map((item) => item.comparison_id))].reverse()
      .find((id) => attempts.every((attempt) => judgments.some((item) => item.comparison_id === id && item.execution_attempt_id === attempt)))
      ?? await nextArtifactId(incumbentBase, (id) => join(runDir, "artifacts", "judges", createHash("sha256").update(id).digest("hex").slice(0, 16)));
    if (incumbentComparisonId && !judgments.some((item) => item.comparison_id === incumbentComparisonId)) await runBlindJudges({ runDir, left: options.incumbent, right: options.candidate, executionAttemptIds: attempts, comparisonId: incumbentComparisonId, judgeHosts: options.judgeHosts, adapters: options.adapters, timeoutMs: options.judgeTimeoutMs ?? 300_000, models: options.models });
    const incumbentBenchmarkId = await nextArtifactId(incumbentBase, (id) => join(runDir, "artifacts", "benchmarks", id));
    incumbentBenchmark = await buildBenchmark({ runDir, left: options.incumbent, right: options.candidate, attemptIds: attempts, comparisonId: incumbentBenchmarkId, judgmentComparisonId: incumbentComparisonId });
  }
  let decisionId: string | null = null;
  const desiredDecisionId = await nextArtifactId(`${options.label}-decision`, (id) => join(runDir, "decisions", `${id}.json`));
  try {
    const decision = await sealDecision({ runDir, winner: options.candidate, anchorBenchmarkId: anchorBenchmark.comparison_id, incumbentBenchmarkId: incumbentBenchmark?.comparison_id, decisionId: desiredDecisionId });
    if (!decision.approved || !verifyDecisionHash(decision)) throw new Error("sealed decision is invalid");
    decisionId = decision.decision_id;
  } catch { /* rejected evidence becomes revision feedback */ }
  const feedback = await trainingFeedback(runDir, trainingAttempt, options.candidate, [anchorBenchmark, ...(incumbentBenchmark ? [incumbentBenchmark] : [])]);
  const accepted = decisionId !== null;
  const converged = accepted && benchmarkConverged(anchorBenchmark, options.candidate) && (!incumbentBenchmark || benchmarkConverged(incumbentBenchmark, options.candidate));
  const summary = accepted
    ? converged ? "all critical training and held-out gates pass" : "candidate is better without regression but quality headroom remains"
    : anchorBenchmark.gates.reasons[0] ?? incumbentBenchmark?.gates.reasons[0] ?? "candidate did not demonstrate net benefit";
  return { candidate: options.candidate, accepted, converged, decision_id: decisionId, training_feedback: feedback, summary, cross_model: anchorBenchmark.cross_model };
}

export async function optimizeBehavior(options: BehaviorOptimizerOptions): Promise<OptimizationState> {
  const runDir = resolve(options.runDir);
  const suite = await loadSuite(runDir);
  if (!suite.evals.some((item) => !item.holdout) || !suite.evals.some((item) => item.holdout)) throw new Error("behavior optimization requires both training and held-out evals");
  const state = await loadRun(runDir);
  const reviserHost = options.reviserHost ?? options.hosts[0];
  if (!reviserHost) throw new Error("behavior optimization requires a reviser host");
  const operation = await createOperation(runDir, { kind: "behavior-optimization", phase: "certifying authored", limits: options.limits, max_iterations: options.maxRevisions ?? 5 });
  const adapters = instrumentAdapters({ ...createHostAdapters(), ...options.adapters }, operation);
  const trackedOptions = { ...options, adapters };
  let initialFeedback: string[] = [];
  const optimizationPath = join(runDir, "optimization.json");
  try {
    let existing: OptimizationState | null = null;
    try { existing = await readJson<OptimizationState>(optimizationPath); } catch { /* new optimization */ }
    if (!existing) {
      const initial = await certifyCandidate({ ...trackedOptions, candidate: "authored", incumbent: "anchor", label: "initial-authored" });
      if (initial.accepted && initial.converged) {
        const done: OptimizationState = { schema_version: 1, status: "converged", incumbent: "authored", decision_id: initial.decision_id, training_feedback: initial.training_feedback, iterations: [], consecutive_no_progress: 0, updated_at: new Date().toISOString() };
        await writeJson(optimizationPath, done);
        await operation.update({ phase: "complete", iteration: 0, current_candidate: "authored", best_candidate: "authored" });
        await operation.complete("converged");
        await options.onProgress?.({ iteration: 0, candidate: "authored", accepted: true, summary: initial.summary, hypothesis: "validate the authored version before revision", takeaway: initial.summary, next_adjustment: null });
        return done;
      }
      initialFeedback = initial.training_feedback;
    }
    const result = await runOptimizationLoop({
    runDir, initialIncumbent: existing?.incumbent ?? "authored", initialTrainingFeedback: existing?.training_feedback ?? initialFeedback, maxRevisions: options.maxRevisions,
    revise: async ({ iteration, incumbent, training_feedback }) => {
      const candidateId = `challenger-${iteration}`;
      if (state.versions[candidateId]) return { candidate: candidateId, hypothesis: `resume existing ${candidateId}` };
      await operation.update({ phase: "revising", iteration, current_candidate: candidateId });
      const revisionRoot = await mkdtemp(join(tmpdir(), `skill-eval-revision-${candidateId}-`));
      const candidatePath = join(revisionRoot, "skill"); await mkdir(revisionRoot, { recursive: true }); await copyTree((await loadRun(runDir)).versions[incumbent]!.path, candidatePath);
      const schemaPath = join(revisionRoot, "result.schema.json"); await writeJson(schemaPath, { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false });
      let creatorGuidance = "";
      if (options.skillCreatorPath) {
        const skillCreatorFile = options.skillCreatorPath.endsWith("SKILL.md") ? options.skillCreatorPath : join(options.skillCreatorPath, "SKILL.md");
        creatorGuidance = `\n\nCurrent-host skill-creator instructions:\n${await readFile(skillCreatorFile, "utf8")}`;
      } else {
        creatorGuidance = `\n\nBundled revision contract:\n${await readFile(resolve(import.meta.dir, "../../references/revision.md"), "utf8")}`;
      }
      const prompt = `Revise the isolated skill at ${candidatePath}. Apply the current host's skill-creator instructions when supplied below; otherwise use evidence-driven skill authoring directly. Address the generalized training evidence without encoding examples or expanding unsupported scope. Do not read any held-out material or files outside this revision workspace. Edit only the copied skill.\n\nTraining evidence:\n${training_feedback.map((item) => `- ${item}`).join("\n") || "- Improve the stated hypothesis while preserving adjacent behavior."}${creatorGuidance}\n\nReturn JSON with a concise summary after editing.`;
      const eventPath = join(revisionRoot, "events.jsonl"); const stderrPath = join(revisionRoot, "stderr.txt"); const finalPath = join(revisionRoot, "final.json");
      try {
        const adapter = adapters[reviserHost];
        if (!adapter) throw new Error(`missing adapter: ${reviserHost}`);
        const result = await adapter.execute({ cwd: revisionRoot, prompt, eventPath, stderrPath, finalPath, outputSchemaPath: schemaPath, timeoutMs: options.reviserTimeoutMs ?? options.timeoutMs ?? 600_000, model: options.models?.[reviserHost] });
        if (result.exit_code !== 0 || result.timed_out) throw new Error(`reviser failed on iteration ${iteration}`);
        const parsed = JSON.parse(result.final_text) as { summary?: string };
        const hypothesis = String(parsed.summary ?? "address the current training evidence").trim();
        await addVersion(runDir, candidateId, candidatePath, incumbent);
        return { candidate: candidateId, hypothesis };
      } finally {
        try { await copyTree(revisionRoot, join(runDir, "artifacts", "revisions", candidateId)); } catch { /* preserve the primary result */ }
        await rm(revisionRoot, { recursive: true, force: true });
      }
    },
    evaluate: async ({ iteration, incumbent, candidate }) => {
      await operation.update({ phase: "evaluating", iteration, current_candidate: candidate });
      return certifyCandidate({ ...trackedOptions, candidate, incumbent, label: `iteration-${iteration}` });
    },
    onProgress: async (event) => {
      await operation.update({ phase: "iteration complete", iteration: event.iteration, current_candidate: event.candidate, ...(event.accepted ? { best_candidate: event.candidate } : {}), message: event.takeaway });
      await options.onProgress?.(event);
    },
    });
    await operation.complete(result.status);
    return result;
  } catch (error) {
    await operation.fail(error);
    throw error;
  }
}
