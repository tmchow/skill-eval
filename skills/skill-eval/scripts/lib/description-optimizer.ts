import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHostAdapters } from "./hosts.ts";
import { createOperation, instrumentAdapters } from "./operations.ts";
import type { OperationLimits } from "./operations.ts";
import { copyTree, readJson, writeJson } from "./json.ts";
import { readSkill, writeSkillDescription } from "./skill.ts";
import { runTriggerSuite, summarizeCrossHostTriggers, summarizeTriggers } from "./triggers.ts";
import type { CrossHostTriggerSummary } from "./triggers.ts";
import { addVersion, loadRun, loadSuite } from "./workspace.ts";
import type { HostAdapter, HostName, TriggerResult } from "./types.ts";

export interface DescriptionEvaluation {
  version: string;
  training: number;
  holdout: number;
  training_failures: string[];
  cross_model?: { training: CrossHostTriggerSummary; holdout: CrossHostTriggerSummary };
}

export interface DescriptionProgressEvent {
  iteration: number;
  version: string;
  training_score: number;
  holdout_score: number;
  selected: boolean;
  takeaway: string;
  cross_model?: DescriptionEvaluation["cross_model"];
}

export interface DescriptionOptimizationState {
  schema_version: 1;
  status: "active" | "converged" | "stalled" | "max-iterations";
  best_version: string;
  best_description?: string;
  best_holdout_score: number;
  history: Array<DescriptionEvaluation & { iteration: number; description?: string; hypothesis?: string; takeaway: string; selected: boolean }>;
  updated_at: string;
  current_version?: string;
  current_description?: string;
  current_hypothesis?: string;
}

export interface DescriptionOptimizationOptions {
  runDir: string;
  initialVersion: string;
  maxIterations?: number;
  minimumImprovement?: number;
  evaluate(version: string): Promise<DescriptionEvaluation>;
  improve(request: { iteration: number; current_version: string; training_score: number; training_failures: string[]; training_history: Array<{ version: string; score: number }> }): Promise<{ version: string; description: string; hypothesis: string }>;
  onProgress?(event: DescriptionProgressEvent): void | Promise<void>;
  onPhase?(event: { phase: "evaluate" | "revise"; iteration: number; version: string }): void | Promise<void>;
}

export async function runDescriptionOptimizationLoop(options: DescriptionOptimizationOptions): Promise<DescriptionOptimizationState> {
  const runDir = resolve(options.runDir);
  const path = join(runDir, "description-optimization.json");
  let state: DescriptionOptimizationState;
  try { state = await readJson<DescriptionOptimizationState>(path); }
  catch {
    state = { schema_version: 1, status: "active", best_version: options.initialVersion, best_holdout_score: -1, history: [], updated_at: new Date().toISOString() };
  }
  if (state.status !== "active") return state;
  const limit = Math.min(5, Math.max(1, options.maxIterations ?? 5));
  let currentVersion = state.current_version ?? state.history.at(-1)?.version ?? options.initialVersion;
  let currentDescription = state.current_description ?? state.history.at(-1)?.description;
  let currentHypothesis = state.current_hypothesis;
  const minimumImprovement = Math.max(0, options.minimumImprovement ?? 0.05);
  while (state.history.length <= limit) {
    const iteration = state.history.length;
    await options.onPhase?.({ phase: "evaluate", iteration, version: currentVersion });
    const evaluation = await options.evaluate(currentVersion);
    const delta = state.best_holdout_score < 0 ? null : evaluation.holdout - state.best_holdout_score;
    const selected = state.best_holdout_score < 0 || (delta! >= minimumImprovement && evaluation.training >= (state.history.find((item) => item.version === state.best_version)?.training ?? 0));
    if (selected) { state.best_version = currentVersion; state.best_description = currentDescription; state.best_holdout_score = evaluation.holdout; }
    let takeaway = delta === null
      ? `baseline held-out score ${evaluation.holdout}`
      : selected
        ? `held-out score improved by ${Number(delta.toFixed(6))}`
        : `held-out score changed by ${Number(delta.toFixed(6))}, below the ${minimumImprovement} selection threshold or with training regression`;
    const disagreementCount = (value?: DescriptionEvaluation["cross_model"]) => (value?.training.disagreements.length ?? 0) + (value?.holdout.disagreements.length ?? 0);
    const previousDisagreements = disagreementCount(state.history.at(-1)?.cross_model);
    const currentDisagreements = disagreementCount(evaluation.cross_model);
    if (previousDisagreements > 0 && currentDisagreements < previousDisagreements) takeaway += `; cross-model disagreements ${previousDisagreements} -> ${currentDisagreements}`;
    else if (currentDisagreements > 0) takeaway += `; ${currentDisagreements} cross-model disagreement${currentDisagreements === 1 ? "" : "s"} remain`;
    state.history.push({ iteration, ...evaluation, description: currentDescription, hypothesis: currentHypothesis, takeaway, selected });
    state.current_version = currentVersion;
    state.current_description = currentDescription;
    state.current_hypothesis = currentHypothesis;
    state.updated_at = new Date().toISOString();
    await writeJson(path, state);
    await options.onProgress?.({ iteration, version: currentVersion, training_score: evaluation.training, holdout_score: evaluation.holdout, selected, takeaway, cross_model: evaluation.cross_model });
    if (selected && evaluation.training === 1 && evaluation.holdout === 1) { state.status = "converged"; break; }
    if (iteration >= limit) { state.status = "max-iterations"; break; }
    const revisionBase = state.best_version;
    await options.onPhase?.({ phase: "revise", iteration: iteration + 1, version: revisionBase });
    const proposal = await options.improve({
      iteration: iteration + 1,
      current_version: revisionBase,
      training_score: evaluation.training,
      training_failures: [...evaluation.training_failures],
      training_history: state.history.map((item) => ({ version: item.version, score: item.training })),
    });
    if (!proposal.version || proposal.version === currentVersion) { state.status = "stalled"; break; }
    currentVersion = proposal.version;
    currentDescription = proposal.description;
    currentHypothesis = proposal.hypothesis;
    state.current_version = currentVersion;
    state.current_description = currentDescription;
    state.current_hypothesis = currentHypothesis;
    await writeJson(path, state);
  }
  state.updated_at = new Date().toISOString();
  await writeJson(path, state);
  return state;
}

export interface ConcreteDescriptionOptimizerOptions {
  runDir: string;
  initialVersion: string;
  hosts: HostName[];
  improverHost: HostName;
  repetitions?: number;
  maxIterations?: number;
  minimumImprovement?: number;
  timeoutMs?: number;
  adapters?: Partial<Record<HostName, HostAdapter>>;
  models?: Partial<Record<HostName, string>>;
  onProgress?(event: DescriptionProgressEvent): void | Promise<void>;
  limits?: OperationLimits;
}

function scoreQueries(results: TriggerResult[]): { score: number; failures: string[] } {
  const summary = summarizeTriggers(results);
  return {
    score: summary.accuracy ?? 0,
    failures: summary.queries.filter((item) => !item.passed).map((item) => `${item.key}: expected ${item.should_trigger ? "trigger" : "no trigger"}, observed ${Math.round(item.trigger_rate * 100)}%`),
  };
}

export async function optimizeDescriptions(options: ConcreteDescriptionOptimizerOptions): Promise<DescriptionOptimizationState> {
  const runDir = resolve(options.runDir);
  const suite = await loadSuite(runDir);
  const queries = suite.trigger_queries ?? [];
  if (!queries.some((item) => !item.holdout) || !queries.some((item) => item.holdout)) throw new Error("description optimization requires both training and held-out trigger queries");
  const operation = await createOperation(runDir, { kind: "description-optimization", phase: "starting", limits: options.limits, max_iterations: options.maxIterations ?? 5 });
  const adapters = instrumentAdapters({ ...createHostAdapters(), ...options.adapters }, operation);
  try {
    const result = await runDescriptionOptimizationLoop({
    runDir, initialVersion: options.initialVersion, maxIterations: options.maxIterations, minimumImprovement: options.minimumImprovement,
    onPhase: async ({ phase, iteration, version }) => { await operation.update({ phase: phase === "evaluate" ? `evaluating ${version}` : `revising ${version}`, iteration, current_candidate: version }); },
    onProgress: async (event) => {
      const baseline = event.iteration === 0 ? event.holdout_score : operation.snapshot().baseline_score;
      await operation.update({ phase: "iteration complete", iteration: event.iteration, current_candidate: event.version, message: event.takeaway, ...(baseline === undefined ? {} : { baseline_score: baseline }), ...(event.selected ? { best_candidate: event.version, best_score: event.holdout_score } : {}) });
      await options.onProgress?.(event);
    },
    evaluate: async (version) => {
      const label = version.replace(/[^a-zA-Z0-9._-]/g, "-");
      const trainingAttempt = `description-${label}-training`; const holdoutAttempt = `description-${label}-holdout`;
      const training = await runTriggerSuite({ runDir, version, hosts: options.hosts, repetitions: options.repetitions ?? 3, timeoutMs: options.timeoutMs, attemptId: trainingAttempt, partition: "training", concurrency: 10, models: options.models, operation, resume: true });
      const holdout = await runTriggerSuite({ runDir, version, hosts: options.hosts, repetitions: options.repetitions ?? 3, timeoutMs: options.timeoutMs, attemptId: holdoutAttempt, partition: "holdout", concurrency: 10, models: options.models, operation, resume: true });
      const trainingScore = scoreQueries(training); const holdoutScore = scoreQueries(holdout);
      return {
        version, training: trainingScore.score, holdout: holdoutScore.score, training_failures: trainingScore.failures,
        cross_model: { training: summarizeCrossHostTriggers(training), holdout: summarizeCrossHostTriggers(holdout) },
      };
    },
    improve: async ({ iteration, current_version, training_score, training_failures, training_history }) => {
      const state = await loadRun(runDir); const currentPath = state.versions[current_version]?.path;
      if (!currentPath) throw new Error(`unknown description version: ${current_version}`);
      const skill = await readSkill(currentPath);
      const revisionRoot = await mkdtemp(join(tmpdir(), `skill-eval-description-${iteration}-`)); const candidatePath = join(revisionRoot, "skill");
      try {
        await copyTree(currentPath, candidatePath);
        const schemaPath = join(revisionRoot, "description.schema.json"); await writeJson(schemaPath, { type: "object", properties: { description: { type: "string", maxLength: 1024 }, hypothesis: { type: "string", maxLength: 240 } }, required: ["description", "hypothesis"], additionalProperties: false });
        const basePrompt = `Optimize only the frontmatter description for skill discovery. Generalize from training failures; do not enumerate queries, reveal workflow details that suppress SKILL.md loading, or claim unsupported scope. Use natural user intent and difficult adjacent boundaries.\n\nSkill name: ${skill.name}\nCurrent description: ${skill.description}\nTraining score: ${training_score}\nTraining failures:\n${training_failures.map((item) => `- ${item}`).join("\n")}\nPrior training scores:\n${training_history.map((item) => `- ${item.version}: ${item.score}`).join("\n")}\n\nSkill body:\n${skill.content}\n\nReturn only JSON with the proposed description and a concise hypothesis for why it should address the generalized failures.`;
        let description = ""; let hypothesis = ""; let failure = "invalid response";
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const suffix = attempt === 1 ? "" : "-retry";
          const eventPath = join(revisionRoot, `events${suffix}.jsonl`); const stderrPath = join(revisionRoot, `stderr${suffix}.txt`); const finalPath = join(revisionRoot, `final${suffix}.json`);
          const prompt = attempt === 1 ? basePrompt : `${basePrompt}\n\nThe previous response was invalid: ${failure}. Return a non-empty, single-line description under 1024 characters with no angle brackets and a concise hypothesis.`;
          const adapter = adapters[options.improverHost];
          if (!adapter) throw new Error(`missing adapter: ${options.improverHost}`);
          const hostResult = await adapter.execute({ cwd: revisionRoot, prompt, eventPath, stderrPath, finalPath, outputSchemaPath: schemaPath, timeoutMs: options.timeoutMs ?? 300_000, model: options.models?.[options.improverHost] });
          if (hostResult.timed_out) throw new Error(`description improver timed out on iteration ${iteration}`);
          try {
            if (hostResult.exit_code !== 0) throw new Error(`host exited ${hostResult.exit_code}`);
            const parsed = JSON.parse(hostResult.final_text); description = String(parsed.description ?? "").trim(); hypothesis = String(parsed.hypothesis ?? "").trim();
            if (!hypothesis) throw new Error("hypothesis is empty");
            await writeSkillDescription(candidatePath, description);
            failure = "";
            break;
          } catch (error) {
            failure = error instanceof Error ? error.message : String(error);
          }
        }
        if (failure) throw new Error(`description improver failed on iteration ${iteration}: ${failure}`);
        const version = `description-${iteration}`;
        await addVersion(runDir, version, candidatePath, current_version);
        return { version, description, hypothesis };
      } finally {
        try { await copyTree(revisionRoot, join(runDir, "artifacts", "description-revisions", `iteration-${iteration}`)); } catch { /* preserve the primary result */ }
        await rm(revisionRoot, { recursive: true, force: true });
      }
    },
    });
    await operation.complete(result.status);
    return result;
  } catch (error) {
    await operation.fail(error);
    throw error;
  }
}
