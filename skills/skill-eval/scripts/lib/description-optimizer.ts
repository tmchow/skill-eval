import { join, resolve } from "node:path";
import { createHostAdapters } from "./hosts.ts";
import { copyTree, readJson, writeJson } from "./json.ts";
import { readSkill, writeSkillDescription } from "./skill.ts";
import { runTriggerSuite } from "./triggers.ts";
import { addVersion, loadRun, loadSuite } from "./workspace.ts";
import type { HostAdapter, HostName, TriggerResult } from "./types.ts";

export interface DescriptionEvaluation {
  version: string;
  training: number;
  holdout: number;
  training_failures: string[];
}

export interface DescriptionOptimizationState {
  schema_version: 1;
  status: "active" | "converged" | "stalled" | "max-iterations";
  best_version: string;
  best_description?: string;
  best_holdout_score: number;
  history: Array<DescriptionEvaluation & { iteration: number; description?: string }>;
  updated_at: string;
  current_version?: string;
}

export interface DescriptionOptimizationOptions {
  runDir: string;
  initialVersion: string;
  maxIterations?: number;
  evaluate(version: string): Promise<DescriptionEvaluation>;
  improve(request: { iteration: number; current_version: string; training_score: number; training_failures: string[]; training_history: Array<{ version: string; score: number }> }): Promise<{ version: string; description: string }>;
  onProgress?(event: { iteration: number; version: string; training_score: number; holdout_score: number; selected: boolean }): void | Promise<void>;
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
  let currentDescription = state.history.at(-1)?.description;
  while (state.history.length <= limit) {
    const iteration = state.history.length;
    const evaluation = await options.evaluate(currentVersion);
    const selected = evaluation.holdout > state.best_holdout_score;
    if (selected) { state.best_version = currentVersion; state.best_description = currentDescription; state.best_holdout_score = evaluation.holdout; }
    state.history.push({ iteration, ...evaluation, description: currentDescription });
    state.current_version = currentVersion;
    state.updated_at = new Date().toISOString();
    await writeJson(path, state);
    await options.onProgress?.({ iteration, version: currentVersion, training_score: evaluation.training, holdout_score: evaluation.holdout, selected });
    if (evaluation.training === 1 && evaluation.holdout === 1) { state.status = "converged"; break; }
    if (iteration >= limit) { state.status = "max-iterations"; break; }
    const proposal = await options.improve({
      iteration: iteration + 1,
      current_version: currentVersion,
      training_score: evaluation.training,
      training_failures: [...evaluation.training_failures],
      training_history: state.history.map((item) => ({ version: item.version, score: item.training })),
    });
    if (!proposal.version || proposal.version === currentVersion) { state.status = "stalled"; break; }
    currentVersion = proposal.version;
    currentDescription = proposal.description;
    state.current_version = currentVersion;
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
  timeoutMs?: number;
  adapters?: Partial<Record<HostName, HostAdapter>>;
  models?: Partial<Record<HostName, string>>;
  onProgress?(event: { iteration: number; version: string; training_score: number; holdout_score: number; selected: boolean }): void | Promise<void>;
}

function scoreQueries(results: TriggerResult[]): { score: number; failures: string[] } {
  const groups = new Map<string, TriggerResult[]>();
  for (const item of results) {
    const key = `${item.host}:${item.query_id}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  let passed = 0; const failures: string[] = [];
  for (const [key, items] of groups) {
    const rate = items.filter((item) => item.triggered).length / items.length;
    const expected = items[0]!.should_trigger;
    const ok = expected ? rate >= 0.5 : rate < 0.5;
    if (ok) passed += 1; else failures.push(`${key}: expected ${expected ? "trigger" : "no trigger"}, observed ${Math.round(rate * 100)}%`);
  }
  return { score: groups.size > 0 ? passed / groups.size : 0, failures };
}

export async function optimizeDescriptions(options: ConcreteDescriptionOptimizerOptions): Promise<DescriptionOptimizationState> {
  const runDir = resolve(options.runDir);
  const suite = await loadSuite(runDir);
  const queries = suite.trigger_queries ?? [];
  if (!queries.some((item) => !item.holdout) || !queries.some((item) => item.holdout)) throw new Error("description optimization requires both training and held-out trigger queries");
  const adapters = { ...createHostAdapters(), ...options.adapters };
  return runDescriptionOptimizationLoop({
    runDir, initialVersion: options.initialVersion, maxIterations: options.maxIterations, onProgress: options.onProgress,
    evaluate: async (version) => {
      const label = version.replace(/[^a-zA-Z0-9._-]/g, "-");
      const trainingAttempt = `description-${label}-training`; const holdoutAttempt = `description-${label}-holdout`;
      let existing: TriggerResult[] = [];
      try { existing = await readJson<TriggerResult[]>(join(runDir, "triggers.json")); } catch { /* first trigger attempt */ }
      const training = existing.filter((item) => item.attempt_id === trainingAttempt).length > 0
        ? existing.filter((item) => item.attempt_id === trainingAttempt)
        : await runTriggerSuite({ runDir, version, hosts: options.hosts, repetitions: options.repetitions ?? 3, timeoutMs: options.timeoutMs, attemptId: trainingAttempt, partition: "training", concurrency: 10, models: options.models });
      const holdout = existing.filter((item) => item.attempt_id === holdoutAttempt).length > 0
        ? existing.filter((item) => item.attempt_id === holdoutAttempt)
        : await runTriggerSuite({ runDir, version, hosts: options.hosts, repetitions: options.repetitions ?? 3, timeoutMs: options.timeoutMs, attemptId: holdoutAttempt, partition: "holdout", concurrency: 10, models: options.models });
      const trainingScore = scoreQueries(training); const holdoutScore = scoreQueries(holdout);
      return { version, training: trainingScore.score, holdout: holdoutScore.score, training_failures: trainingScore.failures };
    },
    improve: async ({ iteration, current_version, training_score, training_failures, training_history }) => {
      const state = await loadRun(runDir); const currentPath = state.versions[current_version]?.path;
      if (!currentPath) throw new Error(`unknown description version: ${current_version}`);
      const skill = await readSkill(currentPath);
      const revisionRoot = join(runDir, "description-workspaces", `iteration-${iteration}`); const candidatePath = join(revisionRoot, "skill");
      await copyTree(currentPath, candidatePath);
      const schemaPath = join(revisionRoot, "description.schema.json"); await writeJson(schemaPath, { type: "object", properties: { description: { type: "string", maxLength: 1024 } }, required: ["description"], additionalProperties: false });
      const basePrompt = `Optimize only the frontmatter description for skill discovery. Generalize from training failures; do not enumerate queries, reveal workflow details that suppress SKILL.md loading, or claim unsupported scope. Use natural user intent and difficult adjacent boundaries.\n\nSkill name: ${skill.name}\nCurrent description: ${skill.description}\nTraining score: ${training_score}\nTraining failures:\n${training_failures.map((item) => `- ${item}`).join("\n")}\nPrior training scores:\n${training_history.map((item) => `- ${item.version}: ${item.score}`).join("\n")}\n\nSkill body:\n${skill.content}\n\nReturn only JSON with description.`;
      let description = ""; let failure = "invalid response";
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const suffix = attempt === 1 ? "" : "-retry";
        const eventPath = join(revisionRoot, `events${suffix}.jsonl`); const stderrPath = join(revisionRoot, `stderr${suffix}.txt`); const finalPath = join(revisionRoot, `final${suffix}.json`);
        const prompt = attempt === 1 ? basePrompt : `${basePrompt}\n\nThe previous response was invalid: ${failure}. Return a non-empty, single-line description under 1024 characters with no angle brackets.`;
        const hostResult = await adapters[options.improverHost].execute({ cwd: revisionRoot, prompt, eventPath, stderrPath, finalPath, outputSchemaPath: schemaPath, timeoutMs: options.timeoutMs ?? 300_000, model: options.models?.[options.improverHost] });
        if (hostResult.timed_out) throw new Error(`description improver timed out on iteration ${iteration}`);
        try {
          if (hostResult.exit_code !== 0) throw new Error(`host exited ${hostResult.exit_code}`);
          const parsed = JSON.parse(hostResult.final_text); description = String(parsed.description ?? "").trim();
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
      return { version, description };
    },
  });
}
