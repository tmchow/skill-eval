#!/usr/bin/env bun
import { resolve } from "node:path";
import { gradeMatrix } from "./lib/assertions.ts";
import { buildBenchmark } from "./lib/benchmark.ts";
import { buildCampaignContext, createCampaign, listCampaigns, recordCampaignCheckpoint, retireCampaignCase } from "./lib/campaign.ts";
import type { CampaignCaseRetirementInput, CampaignCheckpointInput } from "./lib/campaign.ts";
import { compareVersions } from "./lib/comparison.ts";
import { confirmAuthored } from "./lib/confirmation.ts";
import { buildEvidenceIndex } from "./lib/evidence-index.ts";
import { runMatrix } from "./lib/executor.ts";
import { generateEvalReview } from "./lib/eval-review.ts";
import { recordHumanFeedback } from "./lib/human-feedback.ts";
import { invalidateCheck } from "./lib/invalidations.ts";
import { runBlindJudges } from "./lib/judges.ts";
import { runModelGraders } from "./lib/model-grader.ts";
import { estimateCalls } from "./lib/planning.ts";
import { preflight } from "./lib/preflight.ts";
import { generateReview } from "./lib/review.ts";
import { runScriptCheck } from "./lib/script-checks.ts";
import { readJson } from "./lib/json.ts";
import { readRunStatus, waitForRun } from "./lib/status.ts";
import { adjudicateSuiteCritique, runSuiteCritics } from "./lib/suite-critic.ts";
import { runTriggerSuite } from "./lib/triggers.ts";
import type { HostName, RuntimeRoleGroup, RuntimeRoleProfiles, SuiteCritiqueAdjudicationInput } from "./lib/types.ts";
import { persistSuite, prepareRun } from "./lib/workspace.ts";

const commands = ["preflight", "campaign-init", "campaign-list", "campaign-checkpoint", "campaign-retire-case", "campaign-context", "prepare", "estimate", "critique-suite", "adjudicate-suite", "check-script", "run", "grade", "grade-model", "judge", "trigger", "benchmark", "compare", "confirm", "evidence-index", "status", "persist-suite", "review-suite", "review", "record-feedback", "invalidate-check"] as const;
type Command = typeof commands[number];
const genericRuntimeOptions = ["claude-model", "codex-model", "claude-effort", "codex-effort"];
const behaviorRuntimeOptions = ["behavior-claude-model", "behavior-codex-model", "behavior-claude-effort", "behavior-codex-effort"];
const evaluatorRuntimeOptions = ["evaluator-claude-model", "evaluator-codex-model", "evaluator-claude-effort", "evaluator-codex-effort"];

const allowedOptions: Record<Command, Set<string>> = {
  preflight: new Set(["target", "invoking-host", "hosts"]),
  "campaign-init": new Set(["target", "goal", "campaign-root", "campaign-id"]),
  "campaign-list": new Set(["target", "campaign-root"]),
  "campaign-checkpoint": new Set(["campaign", "input"]),
  "campaign-retire-case": new Set(["campaign", "input"]),
  "campaign-context": new Set(["campaign"]),
  prepare: new Set(["target", "suite", "invoking-host", "hosts", "anchor-ref", "run-root", "run-id", "exclude-from-executor", "campaign", "role"]),
  estimate: new Set(["run-dir", "suite", "workflow", "versions", "hosts", "judge-hosts", "critic-hosts", "repetitions", "partition"]),
  "critique-suite": new Set(["run-dir", "critic-hosts", "timeout-ms", ...genericRuntimeOptions]),
  "adjudicate-suite": new Set(["run-dir", "input"]),
  "check-script": new Set(["run-dir", "check-id", "version", "script", "fixture", "runtime", "args", "timeout-ms", "stdout-contains", "stderr-not-contains"]),
  run: new Set(["run-dir", "versions", "hosts", "repetitions", "timeout-ms", "concurrency", "attempt-id", "partition", "evals", "resume", ...genericRuntimeOptions]),
  grade: new Set(["run-dir"]),
  "grade-model": new Set(["run-dir", "attempts", "grading-id", "grader-hosts", "timeout-ms", "concurrency", ...genericRuntimeOptions]),
  judge: new Set(["run-dir", "left", "right", "attempts", "comparison-id", "judge-hosts", "timeout-ms", "concurrency", "seed", ...genericRuntimeOptions]),
  trigger: new Set(["run-dir", "version", "hosts", "repetitions", "timeout-ms", "concurrency", "attempt-id", "partition", "queries", "resume", ...genericRuntimeOptions, "max-model-calls", "max-elapsed-ms"]),
  benchmark: new Set(["run-dir", "left", "right", "attempts", "comparison-id", "judgment-comparison-id", "minimum-effect", "partitions"]),
  compare: new Set(["run-dir", "left", "right", "label", "hosts", "judge-hosts", "repetitions", "executor-timeout-ms", "grader-timeout-ms", "judge-timeout-ms", ...genericRuntimeOptions, ...behaviorRuntimeOptions, ...evaluatorRuntimeOptions]),
  confirm: new Set(["run-dir", "label", "hosts", "judge-hosts", "repetitions", "executor-timeout-ms", "grader-timeout-ms", "judge-timeout-ms", ...genericRuntimeOptions, ...behaviorRuntimeOptions, ...evaluatorRuntimeOptions]),
  "evidence-index": new Set(["run-dir"]),
  status: new Set(["run-dir", "wait", "timeout-ms", "poll-ms"]),
  "persist-suite": new Set(["run-dir"]),
  "review-suite": new Set(["suite", "output"]),
  review: new Set(["run-dir", "output", "all"]),
  "record-feedback": new Set(["run-dir", "case-id", "winner", "reason", "feedback-id"]),
  "invalidate-check": new Set(["run-dir", "attempt-id", "eval-id", "expectation-id", "reason"]),
};

const help = `skill-eval - reproducible cross-harness skill evaluation

Commands:
  preflight      Check dependencies, authentication, target, and host coverage
  campaign-init  Create a durable multi-run evaluation context
  campaign-list  Find prior campaigns for this exact source skill
  campaign-checkpoint  Persist one agent-authored reasoning checkpoint
  campaign-retire-case  Retire one invalid case with hash-bound evidence
  campaign-context  Assemble factual run evidence plus reasoning checkpoints
  prepare        Freeze suite, fixtures, selected Git/no-skill anchor, and authored candidate
  estimate       Compute exact planned direct calls without invoking a model
  critique-suite Identify independent threats to the frozen suite's validity
  adjudicate-suite Reconcile critic findings against the confirmed hypothesis
  check-script   Run a frozen skill script as model-free mechanism evidence
  run            Execute or resume a partitioned host x version x eval matrix
  grade          Apply deterministic expectations to matrix artifacts
  grade-model    Grade qualitative expectations from anonymous artifacts and events
  judge          Run repetition-aware blind qualitative A/B comparisons
  trigger        Measure project-local skill discovery
  benchmark      Aggregate variance, preference, resource use, and size deltas
  compare        Run a training comparison for calibration and diagnosis
  confirm        Run training and validation gates and seal an authored evidence claim
  evidence-index Build a factual, hash-bound index for agent interpretation
  status         Read durable progress or wait without making model calls
  persist-suite  Save a calibrated suite under .skill-eval/<skill>/
  review-suite   Generate an optional editable suite review page
  review         Generate anonymous artifact review for disputed cases
  record-feedback  Record one native-harness human decision as evidence
  invalidate-check Record a broken check so it cannot count as passing evidence

Run a command with explicit --key value options. Every command emits JSON.
`;

function parse(args: string[]): { command: string; options: Map<string, string[]> } {
  const command = args.shift() ?? "--help";
  const options = new Map<string, string[]>();
  while (args.length > 0) {
    const key = args.shift()!;
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    if (["--all", "--resume", "--wait"].includes(key)) {
      options.set(key.slice(2), ["true"]);
      continue;
    }
    const value = args.shift();
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${key}`);
    options.set(key.slice(2), [...(options.get(key.slice(2)) ?? []), value]);
  }
  return { command, options };
}

function option(options: Map<string, string[]>, key: string, required = true): string | undefined {
  const value = options.get(key)?.at(-1);
  if (required && value === undefined) throw new Error(`missing --${key}`);
  return value;
}

function list(options: Map<string, string[]>, key: string): string[] {
  return (option(options, key) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function hosts(options: Map<string, string[]>, key = "hosts"): HostName[] {
  const values = list(options, key);
  for (const value of values) if (!["claude", "codex"].includes(value)) throw new Error(`invalid host: ${value}`);
  return values as HostName[];
}

function host(options: Map<string, string[]>, key: string): HostName {
  const value = option(options, key)!;
  if (!["claude", "codex"].includes(value)) throw new Error(`invalid host: ${value}`);
  return value as HostName;
}

function numberOption(options: Map<string, string[]>, key: string, fallback: number): number {
  const value = option(options, key, false);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${key} must be a positive number`);
  return parsed;
}

function partition(options: Map<string, string[]>, required = false): "training" | "validation" | "all" {
  const value = option(options, "partition", required) ?? "training";
  if (!["training", "validation", "all"].includes(value)) throw new Error("--partition must be training, validation, or all");
  return value as "training" | "validation" | "all";
}

function evidencePartitions(options: Map<string, string[]>): Array<"training" | "validation"> | undefined {
  if (!options.has("partitions")) return undefined;
  const values = list(options, "partitions");
  if (values.length === 0 || values.some((value) => !["training", "validation"].includes(value))) {
    throw new Error("--partitions must contain training, validation, or both");
  }
  return [...new Set(values)] as Array<"training" | "validation">;
}

function limits(options: Map<string, string[]>) {
  return {
    ...(options.has("max-model-calls") ? { max_model_calls: numberOption(options, "max-model-calls", 1) } : {}),
    ...(options.has("max-elapsed-ms") ? { max_elapsed_ms: numberOption(options, "max-elapsed-ms", 1) } : {}),
  };
}

function models(options: Map<string, string[]>): Partial<Record<HostName, string>> {
  return { ...(option(options, "claude-model", false) ? { claude: option(options, "claude-model", false)! } : {}), ...(option(options, "codex-model", false) ? { codex: option(options, "codex-model", false)! } : {}) };
}

function reasoningEfforts(options: Map<string, string[]>): Partial<Record<HostName, string>> {
  return { ...(option(options, "claude-effort", false) ? { claude: option(options, "claude-effort", false)! } : {}), ...(option(options, "codex-effort", false) ? { codex: option(options, "codex-effort", false)! } : {}) };
}

function runtimeProfiles(options: Map<string, string[]>): RuntimeRoleProfiles {
  const profiles: RuntimeRoleProfiles = {};
  for (const role of ["behavior", "evaluator"] as RuntimeRoleGroup[]) {
    const profile: NonNullable<RuntimeRoleProfiles[RuntimeRoleGroup]> = {};
    for (const runtimeHost of ["claude", "codex"] as HostName[]) {
      const model = option(options, `${role}-${runtimeHost}-model`, false);
      const reasoning = option(options, `${role}-${runtimeHost}-effort`, false);
      if (model || reasoning) profile[runtimeHost] = { ...(model ? { model } : {}), ...(reasoning ? { reasoning_effort: reasoning } : {}) };
    }
    if (Object.keys(profile).length > 0) profiles[role] = profile;
  }
  return profiles;
}

function reviewWinner(options: Map<string, string[]>): "A" | "B" | "TIE" {
  const value = option(options, "winner")!.toUpperCase();
  if (!["A", "B", "TIE"].includes(value)) throw new Error("--winner must be A, B, or TIE");
  return value as "A" | "B" | "TIE";
}

async function main(): Promise<unknown> {
  const parsed = parse(process.argv.slice(2));
  if (["--help", "help", "-h"].includes(parsed.command)) return { help };
  if (!commands.includes(parsed.command as any)) throw new Error(`unknown command: ${parsed.command}`);
  const o = parsed.options;
  const command = parsed.command as Command;
  for (const key of o.keys()) if (!allowedOptions[command].has(key)) throw new Error(`unknown option for ${command}: --${key}`);
  switch (parsed.command) {
    case "preflight":
      return preflight(option(o, "target")!, { invokingHost: host(o, "invoking-host"), requestedHosts: hosts(o) });
    case "campaign-init":
      return createCampaign({ targetPath: option(o, "target")!, measurementGoal: option(o, "goal")!, campaignRoot: option(o, "campaign-root", false), campaignId: option(o, "campaign-id", false) });
    case "campaign-list":
      return listCampaigns({ targetPath: option(o, "target")!, campaignRoot: option(o, "campaign-root", false) });
    case "campaign-checkpoint":
      return recordCampaignCheckpoint(option(o, "campaign")!, await readJson<CampaignCheckpointInput>(option(o, "input")!));
    case "campaign-retire-case":
      return retireCampaignCase(option(o, "campaign")!, await readJson<CampaignCaseRetirementInput>(option(o, "input")!));
    case "campaign-context":
      return buildCampaignContext(option(o, "campaign")!);
    case "prepare":
      return prepareRun({ targetPath: option(o, "target")!, suitePath: option(o, "suite")!, invokingHost: host(o, "invoking-host"), hosts: hosts(o), anchorRef: option(o, "anchor-ref", false), runRoot: option(o, "run-root", false), runId: option(o, "run-id", false), executorExclusions: o.has("exclude-from-executor") ? list(o, "exclude-from-executor") : undefined, campaignDir: option(o, "campaign", false), campaignRole: option(o, "role", false) });
    case "estimate":
      return estimateCalls({ runDir: option(o, "run-dir", false), suitePath: option(o, "suite", false), workflow: option(o, "workflow") as "run" | "compare", versions: list(o, "versions"), hosts: hosts(o), judgeHosts: o.has("judge-hosts") ? hosts(o, "judge-hosts") : undefined, criticHosts: o.has("critic-hosts") ? hosts(o, "critic-hosts") : undefined, repetitions: numberOption(o, "repetitions", 1), partition: partition(o) });
    case "critique-suite":
      return runSuiteCritics({ runDir: option(o, "run-dir")!, criticHosts: hosts(o, "critic-hosts"), timeoutMs: numberOption(o, "timeout-ms", 300_000), models: models(o), reasoningEfforts: reasoningEfforts(o) });
    case "adjudicate-suite":
      return adjudicateSuiteCritique(option(o, "run-dir")!, await readJson<SuiteCritiqueAdjudicationInput>(option(o, "input")!));
    case "check-script":
      return runScriptCheck({ runDir: option(o, "run-dir")!, checkId: option(o, "check-id")!, version: option(o, "version")!, script: option(o, "script")!, fixtureId: option(o, "fixture", false), runtime: option(o, "runtime", false), args: o.has("args") ? list(o, "args") : undefined, timeoutMs: numberOption(o, "timeout-ms", 60_000), stdoutContains: option(o, "stdout-contains", false), stderrNotContains: option(o, "stderr-not-contains", false) });
    case "run":
      return runMatrix({ runDir: option(o, "run-dir")!, versions: list(o, "versions"), hosts: hosts(o), repetitions: numberOption(o, "repetitions", 1), timeoutMs: numberOption(o, "timeout-ms", 1_800_000), concurrency: numberOption(o, "concurrency", 2), attemptId: option(o, "attempt-id", false), partition: partition(o), evalIds: o.has("evals") ? list(o, "evals") : undefined, resume: option(o, "resume", false) === "true", models: models(o), reasoningEfforts: reasoningEfforts(o) });
    case "grade":
      return gradeMatrix(option(o, "run-dir")!);
    case "grade-model":
      return runModelGraders({ runDir: option(o, "run-dir")!, executionAttemptIds: list(o, "attempts"), gradingId: option(o, "grading-id")!, graderHosts: hosts(o, "grader-hosts"), timeoutMs: numberOption(o, "timeout-ms", 300_000), concurrency: numberOption(o, "concurrency", 2), models: models(o), reasoningEfforts: reasoningEfforts(o) });
    case "judge":
      return runBlindJudges({ runDir: option(o, "run-dir")!, left: option(o, "left")!, right: option(o, "right")!, executionAttemptIds: list(o, "attempts"), comparisonId: option(o, "comparison-id", false), judgeHosts: hosts(o, "judge-hosts"), timeoutMs: numberOption(o, "timeout-ms", 300_000), concurrency: numberOption(o, "concurrency", 2), seed: option(o, "seed", false), models: models(o), reasoningEfforts: reasoningEfforts(o) });
    case "trigger":
      return runTriggerSuite({ runDir: option(o, "run-dir")!, version: option(o, "version")!, hosts: hosts(o), repetitions: numberOption(o, "repetitions", 3), timeoutMs: numberOption(o, "timeout-ms", 60_000), concurrency: numberOption(o, "concurrency", 6), attemptId: option(o, "attempt-id", false), partition: partition(o, true), queryIds: o.has("queries") ? list(o, "queries") : undefined, models: models(o), reasoningEfforts: reasoningEfforts(o), limits: limits(o), resume: option(o, "resume", false) === "true" });
    case "benchmark":
      return buildBenchmark({ runDir: option(o, "run-dir")!, left: option(o, "left")!, right: option(o, "right")!, attemptIds: list(o, "attempts"), comparisonId: option(o, "comparison-id", false), judgmentComparisonId: option(o, "judgment-comparison-id", false), minimumEffect: numberOption(o, "minimum-effect", 0.05), partitions: evidencePartitions(o) });
    case "compare":
      return compareVersions({ runDir: option(o, "run-dir")!, left: option(o, "left")!, right: option(o, "right")!, label: option(o, "label")!, hosts: hosts(o), judgeHosts: hosts(o, "judge-hosts"), repetitions: numberOption(o, "repetitions", 1), executorTimeoutMs: numberOption(o, "executor-timeout-ms", 1_800_000), graderTimeoutMs: numberOption(o, "grader-timeout-ms", 300_000), judgeTimeoutMs: numberOption(o, "judge-timeout-ms", 300_000), models: models(o), reasoningEfforts: reasoningEfforts(o), runtimeProfiles: runtimeProfiles(o) });
    case "confirm":
      return confirmAuthored({ runDir: option(o, "run-dir")!, label: option(o, "label")!, hosts: hosts(o), judgeHosts: hosts(o, "judge-hosts"), repetitions: numberOption(o, "repetitions", 3), executorTimeoutMs: numberOption(o, "executor-timeout-ms", 1_800_000), graderTimeoutMs: numberOption(o, "grader-timeout-ms", 300_000), judgeTimeoutMs: numberOption(o, "judge-timeout-ms", 300_000), models: models(o), reasoningEfforts: reasoningEfforts(o), runtimeProfiles: runtimeProfiles(o) });
    case "evidence-index":
      return buildEvidenceIndex(option(o, "run-dir")!);
    case "status":
      return o.has("wait")
        ? waitForRun(option(o, "run-dir")!, { timeoutMs: numberOption(o, "timeout-ms", 30 * 60_000), pollMs: numberOption(o, "poll-ms", 1_000) })
        : readRunStatus(option(o, "run-dir")!);
    case "persist-suite":
      return persistSuite(option(o, "run-dir")!);
    case "review-suite":
      return generateEvalReview(option(o, "suite")!, option(o, "output", false));
    case "review":
      return generateReview(option(o, "run-dir")!, option(o, "output", false), option(o, "all", false) === "true");
    case "record-feedback":
      return recordHumanFeedback({ runDir: option(o, "run-dir")!, caseId: option(o, "case-id")!, winner: reviewWinner(o), reason: option(o, "reason", false), feedbackId: option(o, "feedback-id", false) });
    case "invalidate-check":
      return invalidateCheck({ runDir: option(o, "run-dir")!, attempt_id: option(o, "attempt-id")!, eval_id: option(o, "eval-id")!, expectation_id: option(o, "expectation-id")!, reason: option(o, "reason")! });
  }
}

try {
  const result = await main();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
}
