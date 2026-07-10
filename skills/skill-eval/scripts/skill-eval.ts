#!/usr/bin/env bun
import { resolve } from "node:path";
import { gradeMatrix } from "./lib/assertions.ts";
import { buildBenchmark } from "./lib/benchmark.ts";
import { buildCampaignContext, createCampaign, listCampaigns, recordCampaignCheckpoint } from "./lib/campaign.ts";
import type { CampaignCheckpointInput } from "./lib/campaign.ts";
import { compareVersions } from "./lib/comparison.ts";
import { sealDecision } from "./lib/decision.ts";
import { optimizeDescriptions } from "./lib/description-optimizer.ts";
import { runMatrix } from "./lib/executor.ts";
import { generateEvalReview } from "./lib/eval-review.ts";
import { recordHumanFeedback } from "./lib/human-feedback.ts";
import { runBlindJudges } from "./lib/judges.ts";
import { runModelGraders } from "./lib/model-grader.ts";
import { certifyCandidate, optimizeBehavior } from "./lib/optimizer.ts";
import { preflight } from "./lib/preflight.ts";
import { promoteVersion } from "./lib/promotion.ts";
import { generateReview } from "./lib/review.ts";
import { runScriptCheck } from "./lib/script-checks.ts";
import { readJson } from "./lib/json.ts";
import { readRunStatus, waitForRun } from "./lib/status.ts";
import { runTriggerSuite } from "./lib/triggers.ts";
import type { HostName } from "./lib/types.ts";
import { addVersion, persistSuite, prepareRun } from "./lib/workspace.ts";

const commands = ["preflight", "campaign-init", "campaign-list", "campaign-checkpoint", "campaign-context", "prepare", "add-version", "check-script", "run", "grade", "grade-model", "judge", "trigger", "benchmark", "compare", "decide", "optimize", "optimize-description", "certify", "status", "persist-suite", "review-suite", "review", "record-feedback", "promote"] as const;
type Command = typeof commands[number];

const allowedOptions: Record<Command, Set<string>> = {
  preflight: new Set(["target", "invoking-host", "hosts"]),
  "campaign-init": new Set(["target", "goal", "campaign-root", "campaign-id"]),
  "campaign-list": new Set(["target", "campaign-root"]),
  "campaign-checkpoint": new Set(["campaign", "input"]),
  "campaign-context": new Set(["campaign"]),
  prepare: new Set(["target", "suite", "invoking-host", "hosts", "anchor-ref", "run-root", "run-id", "exclude-from-executor", "campaign", "role"]),
  "add-version": new Set(["run-dir", "id", "path", "parent"]),
  "check-script": new Set(["run-dir", "check-id", "version", "script", "fixture", "runtime", "args", "timeout-ms", "stdout-contains", "stderr-not-contains"]),
  run: new Set(["run-dir", "versions", "hosts", "repetitions", "timeout-ms", "concurrency", "attempt-id", "partition", "evals", "resume", "claude-model", "codex-model"]),
  grade: new Set(["run-dir"]),
  "grade-model": new Set(["run-dir", "attempts", "grading-id", "grader-hosts", "timeout-ms", "concurrency", "claude-model", "codex-model"]),
  judge: new Set(["run-dir", "left", "right", "attempts", "comparison-id", "judge-hosts", "timeout-ms", "concurrency", "seed", "claude-model", "codex-model"]),
  trigger: new Set(["run-dir", "version", "hosts", "repetitions", "timeout-ms", "concurrency", "attempt-id", "partition", "queries", "claude-model", "codex-model", "max-model-calls", "max-elapsed-ms"]),
  benchmark: new Set(["run-dir", "left", "right", "attempts", "comparison-id", "judgment-comparison-id", "minimum-effect"]),
  compare: new Set(["run-dir", "left", "right", "label", "hosts", "judge-hosts", "repetitions", "executor-timeout-ms", "grader-timeout-ms", "judge-timeout-ms", "claude-model", "codex-model"]),
  decide: new Set(["run-dir", "winner", "anchor-benchmark", "incumbent-benchmark", "decision-id"]),
  optimize: new Set(["run-dir", "hosts", "judge-hosts", "reviser-host", "repetitions", "max-revisions", "timeout-ms", "executor-timeout-ms", "grader-timeout-ms", "judge-timeout-ms", "reviser-timeout-ms", "claude-model", "codex-model", "skill-creator", "max-model-calls", "max-elapsed-ms"]),
  "optimize-description": new Set(["run-dir", "version", "hosts", "improver-host", "repetitions", "max-iterations", "minimum-improvement", "timeout-ms", "claude-model", "codex-model", "max-model-calls", "max-elapsed-ms"]),
  certify: new Set(["run-dir", "candidate", "incumbent", "label", "hosts", "judge-hosts", "repetitions", "timeout-ms", "executor-timeout-ms", "grader-timeout-ms", "judge-timeout-ms", "claude-model", "codex-model"]),
  status: new Set(["run-dir", "wait", "timeout-ms", "poll-ms"]),
  "persist-suite": new Set(["run-dir"]),
  "review-suite": new Set(["suite", "output"]),
  review: new Set(["run-dir", "output", "all"]),
  "record-feedback": new Set(["run-dir", "case-id", "winner", "reason", "feedback-id"]),
  promote: new Set(["run-dir", "decision", "policy-allows-commit", "commit-message", "protected-branch"]),
};

const help = `skill-eval - reproducible cross-harness skill evaluation\n\nCommands:\n  preflight      Check dependencies, authentication, target, and host coverage\n  campaign-init  Create a durable multi-run evaluation context\n  campaign-list  Find prior campaigns for this exact source skill\n  campaign-checkpoint  Persist one agent-authored reasoning checkpoint\n  campaign-context  Assemble factual run evidence plus reasoning checkpoints\n  prepare        Freeze suite, fixtures, selected Git/no-skill anchor, and authored candidate\n  add-version    Add one isolated challenger snapshot\n  check-script   Run a frozen skill script as model-free mechanism evidence\n  run            Execute or resume a partitioned host x version x eval matrix\n  grade          Apply deterministic expectations to matrix artifacts\n  grade-model    Grade qualitative expectations from anonymous artifacts and events\n  judge          Run repetition-aware blind qualitative A/B comparisons\n  trigger        Measure project-local skill discovery\n  benchmark      Aggregate variance, preference, resource use, and size deltas\n  compare        Run an evaluation-only comparison without holdout or promotion\n  decide         Seal complete anchor/incumbent evidence for one winner\n  optimize       Run or resume the evidence-driven behavior revision loop\n  optimize-description  Run held-out-selected trigger description optimization\n  certify        Run promotion-grade training and held-out behavior gates\n  status         Read durable progress or wait without making model calls\n  persist-suite  Save a calibrated suite under .skill-eval/<skill>/\n  review-suite   Generate an optional editable suite review page\n  review         Generate anonymous artifact review for disputed cases\n  record-feedback  Record one native-harness human decision as evidence\n  promote        Apply a sealed winner and optionally create one commit\n\nRun a command with explicit --key value options. Every command emits JSON.\n`;

function parse(args: string[]): { command: string; options: Map<string, string[]> } {
  const command = args.shift() ?? "--help";
  const options = new Map<string, string[]>();
  while (args.length > 0) {
    const key = args.shift()!;
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    if (["--policy-allows-commit", "--all", "--resume", "--wait"].includes(key)) {
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

function partition(options: Map<string, string[]>, required = false): "training" | "holdout" | "all" {
  const value = option(options, "partition", required) ?? "training";
  if (!["training", "holdout", "all"].includes(value)) throw new Error("--partition must be training, holdout, or all");
  return value as "training" | "holdout" | "all";
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
    case "campaign-context":
      return buildCampaignContext(option(o, "campaign")!);
    case "prepare":
      return prepareRun({ targetPath: option(o, "target")!, suitePath: option(o, "suite")!, invokingHost: host(o, "invoking-host"), hosts: hosts(o), anchorRef: option(o, "anchor-ref", false), runRoot: option(o, "run-root", false), runId: option(o, "run-id", false), executorExclusions: o.has("exclude-from-executor") ? list(o, "exclude-from-executor") : undefined, campaignDir: option(o, "campaign", false), campaignRole: option(o, "role", false) });
    case "add-version":
      return addVersion(option(o, "run-dir")!, option(o, "id")!, option(o, "path")!, option(o, "parent", false) ?? null);
    case "check-script":
      return runScriptCheck({ runDir: option(o, "run-dir")!, checkId: option(o, "check-id")!, version: option(o, "version")!, script: option(o, "script")!, fixtureId: option(o, "fixture", false), runtime: option(o, "runtime", false), args: o.has("args") ? list(o, "args") : undefined, timeoutMs: numberOption(o, "timeout-ms", 60_000), stdoutContains: option(o, "stdout-contains", false), stderrNotContains: option(o, "stderr-not-contains", false) });
    case "run":
      return runMatrix({ runDir: option(o, "run-dir")!, versions: list(o, "versions"), hosts: hosts(o), repetitions: numberOption(o, "repetitions", 1), timeoutMs: numberOption(o, "timeout-ms", 1_800_000), concurrency: numberOption(o, "concurrency", 2), attemptId: option(o, "attempt-id", false), partition: partition(o), evalIds: o.has("evals") ? list(o, "evals") : undefined, resume: option(o, "resume", false) === "true", models: models(o) });
    case "grade":
      return gradeMatrix(option(o, "run-dir")!);
    case "grade-model":
      return runModelGraders({ runDir: option(o, "run-dir")!, executionAttemptIds: list(o, "attempts"), gradingId: option(o, "grading-id")!, graderHosts: hosts(o, "grader-hosts"), timeoutMs: numberOption(o, "timeout-ms", 300_000), concurrency: numberOption(o, "concurrency", 2), models: models(o) });
    case "judge":
      return runBlindJudges({ runDir: option(o, "run-dir")!, left: option(o, "left")!, right: option(o, "right")!, executionAttemptIds: list(o, "attempts"), comparisonId: option(o, "comparison-id", false), judgeHosts: hosts(o, "judge-hosts"), timeoutMs: numberOption(o, "timeout-ms", 300_000), concurrency: numberOption(o, "concurrency", 2), seed: option(o, "seed", false), models: models(o) });
    case "trigger":
      return runTriggerSuite({ runDir: option(o, "run-dir")!, version: option(o, "version")!, hosts: hosts(o), repetitions: numberOption(o, "repetitions", 3), timeoutMs: numberOption(o, "timeout-ms", 60_000), concurrency: numberOption(o, "concurrency", 6), attemptId: option(o, "attempt-id", false), partition: partition(o, true), queryIds: o.has("queries") ? list(o, "queries") : undefined, models: models(o), limits: limits(o) });
    case "benchmark":
      return buildBenchmark({ runDir: option(o, "run-dir")!, left: option(o, "left")!, right: option(o, "right")!, attemptIds: list(o, "attempts"), comparisonId: option(o, "comparison-id", false), judgmentComparisonId: option(o, "judgment-comparison-id", false), minimumEffect: numberOption(o, "minimum-effect", 0.05) });
    case "compare":
      return compareVersions({ runDir: option(o, "run-dir")!, left: option(o, "left")!, right: option(o, "right")!, label: option(o, "label")!, hosts: hosts(o), judgeHosts: hosts(o, "judge-hosts"), repetitions: numberOption(o, "repetitions", 1), executorTimeoutMs: numberOption(o, "executor-timeout-ms", 1_800_000), graderTimeoutMs: numberOption(o, "grader-timeout-ms", 300_000), judgeTimeoutMs: numberOption(o, "judge-timeout-ms", 300_000), models: models(o) });
    case "decide":
      return sealDecision({ runDir: option(o, "run-dir")!, winner: option(o, "winner")!, anchorBenchmarkId: option(o, "anchor-benchmark")!, incumbentBenchmarkId: option(o, "incumbent-benchmark", false), decisionId: option(o, "decision-id", false) });
    case "optimize":
      return optimizeBehavior({ runDir: option(o, "run-dir")!, hosts: hosts(o), judgeHosts: hosts(o, "judge-hosts"), reviserHost: host(o, "reviser-host"), repetitions: numberOption(o, "repetitions", 3), maxRevisions: numberOption(o, "max-revisions", 5), timeoutMs: o.has("timeout-ms") ? numberOption(o, "timeout-ms", 600_000) : undefined, executorTimeoutMs: numberOption(o, "executor-timeout-ms", 1_800_000), graderTimeoutMs: numberOption(o, "grader-timeout-ms", 300_000), judgeTimeoutMs: numberOption(o, "judge-timeout-ms", 300_000), reviserTimeoutMs: numberOption(o, "reviser-timeout-ms", 600_000), models: models(o), skillCreatorPath: option(o, "skill-creator", false), limits: limits(o), onProgress: (event) => { process.stderr.write(`${JSON.stringify({ type: "progress", ...event })}\n`); } });
    case "optimize-description":
      return optimizeDescriptions({ runDir: option(o, "run-dir")!, initialVersion: option(o, "version")!, hosts: hosts(o), improverHost: host(o, "improver-host"), repetitions: numberOption(o, "repetitions", 3), maxIterations: numberOption(o, "max-iterations", 5), minimumImprovement: numberOption(o, "minimum-improvement", 0.05), timeoutMs: numberOption(o, "timeout-ms", 300_000), models: models(o), limits: limits(o), onProgress: (event) => { process.stderr.write(`${JSON.stringify({ type: "progress", phase: "description", ...event })}\n`); } });
    case "certify":
      return certifyCandidate({ runDir: option(o, "run-dir")!, candidate: option(o, "candidate")!, incumbent: option(o, "incumbent")!, label: option(o, "label")!, hosts: hosts(o), judgeHosts: hosts(o, "judge-hosts"), repetitions: numberOption(o, "repetitions", 3), timeoutMs: o.has("timeout-ms") ? numberOption(o, "timeout-ms", 600_000) : undefined, executorTimeoutMs: numberOption(o, "executor-timeout-ms", 1_800_000), graderTimeoutMs: numberOption(o, "grader-timeout-ms", 300_000), judgeTimeoutMs: numberOption(o, "judge-timeout-ms", 300_000), models: models(o) });
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
    case "promote":
      return promoteVersion({ runDir: option(o, "run-dir")!, decisionId: option(o, "decision")!, policyAllowsCommit: option(o, "policy-allows-commit", false) === "true", commitMessage: option(o, "commit-message", false), protectedBranches: o.get("protected-branch") });
  }
}

try {
  const result = await main();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
}
