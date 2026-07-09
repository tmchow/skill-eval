#!/usr/bin/env bun
import { resolve } from "node:path";
import { gradeMatrix } from "./lib/assertions.ts";
import { buildBenchmark } from "./lib/benchmark.ts";
import { sealDecision } from "./lib/decision.ts";
import { optimizeDescriptions } from "./lib/description-optimizer.ts";
import { runMatrix } from "./lib/executor.ts";
import { generateEvalReview } from "./lib/eval-review.ts";
import { ingestHumanFeedback } from "./lib/human-feedback.ts";
import { runBlindJudges } from "./lib/judges.ts";
import { runModelGraders } from "./lib/model-grader.ts";
import { certifyCandidate, optimizeBehavior } from "./lib/optimizer.ts";
import { preflight } from "./lib/preflight.ts";
import { promoteVersion } from "./lib/promotion.ts";
import { generateReview } from "./lib/review.ts";
import { runTriggerSuite } from "./lib/triggers.ts";
import type { HostName } from "./lib/types.ts";
import { addVersion, persistSuite, prepareRun } from "./lib/workspace.ts";

const commands = ["preflight", "prepare", "add-version", "run", "grade", "grade-model", "judge", "trigger", "benchmark", "decide", "optimize", "optimize-description", "certify", "persist-suite", "review-suite", "review", "ingest-feedback", "promote"] as const;
type Command = typeof commands[number];

const allowedOptions: Record<Command, Set<string>> = {
  preflight: new Set(["target", "invoking-host", "hosts"]),
  prepare: new Set(["target", "suite", "invoking-host", "hosts", "run-root", "run-id"]),
  "add-version": new Set(["run-dir", "id", "path", "parent"]),
  run: new Set(["run-dir", "versions", "hosts", "repetitions", "timeout-ms", "concurrency", "attempt-id", "partition", "evals", "claude-model", "codex-model"]),
  grade: new Set(["run-dir"]),
  "grade-model": new Set(["run-dir", "attempts", "grading-id", "grader-hosts", "timeout-ms", "claude-model", "codex-model"]),
  judge: new Set(["run-dir", "left", "right", "attempts", "comparison-id", "judge-hosts", "timeout-ms", "seed", "claude-model", "codex-model"]),
  trigger: new Set(["run-dir", "version", "hosts", "repetitions", "timeout-ms", "concurrency", "attempt-id", "partition", "queries", "claude-model", "codex-model"]),
  benchmark: new Set(["run-dir", "left", "right", "attempts", "comparison-id", "minimum-effect"]),
  decide: new Set(["run-dir", "winner", "anchor-benchmark", "incumbent-benchmark", "decision-id"]),
  optimize: new Set(["run-dir", "hosts", "judge-hosts", "reviser-host", "repetitions", "max-revisions", "timeout-ms", "claude-model", "codex-model", "skill-creator"]),
  "optimize-description": new Set(["run-dir", "version", "hosts", "improver-host", "repetitions", "max-iterations", "timeout-ms", "claude-model", "codex-model"]),
  certify: new Set(["run-dir", "candidate", "incumbent", "label", "hosts", "judge-hosts", "repetitions", "timeout-ms", "claude-model", "codex-model"]),
  "persist-suite": new Set(["run-dir"]),
  "review-suite": new Set(["suite", "output"]),
  review: new Set(["run-dir", "output", "all"]),
  "ingest-feedback": new Set(["run-dir", "feedback", "feedback-id"]),
  promote: new Set(["run-dir", "decision", "policy-allows-commit", "commit-message", "protected-branch"]),
};

const help = `skill-eval - reproducible cross-harness skill evaluation\n\nCommands:\n  preflight      Check dependencies, authentication, target, and host coverage\n  prepare        Freeze suite, fixtures, HEAD anchor, and authored candidate\n  add-version    Add one isolated challenger snapshot\n  run            Execute a partitioned host x version x eval matrix\n  grade          Apply deterministic expectations to matrix artifacts\n  grade-model    Grade qualitative expectations from anonymous artifacts and events\n  judge          Run repetition-aware blind qualitative A/B comparisons\n  trigger        Measure project-local skill discovery\n  benchmark      Aggregate variance, preference, cost, and size deltas\n  decide         Seal complete anchor/incumbent evidence for one winner\n  optimize       Run or resume the evidence-driven behavior revision loop\n  optimize-description  Run held-out-selected trigger description optimization\n  certify        Rerun complete behavior gates for a selected version\n  persist-suite  Save a calibrated suite under .skill-eval/<skill>/\n  review-suite   Generate an optional editable suite review page\n  review         Generate anonymous artifact review for disputed cases\n  ingest-feedback  Map completed anonymous human review into evidence\n  promote        Apply a sealed winner and optionally create one commit\n\nRun a command with explicit --key value options. Every command emits JSON.\n`;

function parse(args: string[]): { command: string; options: Map<string, string[]> } {
  const command = args.shift() ?? "--help";
  const options = new Map<string, string[]>();
  while (args.length > 0) {
    const key = args.shift()!;
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    if (["--policy-allows-commit", "--all"].includes(key)) {
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

function partition(options: Map<string, string[]>): "training" | "holdout" | "all" {
  const value = option(options, "partition", false) ?? "training";
  if (!["training", "holdout", "all"].includes(value)) throw new Error("--partition must be training, holdout, or all");
  return value as "training" | "holdout" | "all";
}

function models(options: Map<string, string[]>): Partial<Record<HostName, string>> {
  return { ...(option(options, "claude-model", false) ? { claude: option(options, "claude-model", false)! } : {}), ...(option(options, "codex-model", false) ? { codex: option(options, "codex-model", false)! } : {}) };
}

async function main(): Promise<unknown> {
  const parsed = parse(process.argv.slice(2));
  if (["--help", "help", "-h"].includes(parsed.command)) return help;
  if (!commands.includes(parsed.command as any)) throw new Error(`unknown command: ${parsed.command}`);
  const o = parsed.options;
  const command = parsed.command as Command;
  for (const key of o.keys()) if (!allowedOptions[command].has(key)) throw new Error(`unknown option for ${command}: --${key}`);
  switch (parsed.command) {
    case "preflight":
      return preflight(option(o, "target")!, { invokingHost: host(o, "invoking-host"), requestedHosts: hosts(o) });
    case "prepare":
      return prepareRun({ targetPath: option(o, "target")!, suitePath: option(o, "suite")!, invokingHost: host(o, "invoking-host"), hosts: hosts(o), runRoot: option(o, "run-root", false), runId: option(o, "run-id", false) });
    case "add-version":
      return addVersion(option(o, "run-dir")!, option(o, "id")!, option(o, "path")!, option(o, "parent", false) ?? null);
    case "run":
      return runMatrix({ runDir: option(o, "run-dir")!, versions: list(o, "versions"), hosts: hosts(o), repetitions: numberOption(o, "repetitions", 1), timeoutMs: numberOption(o, "timeout-ms", 600_000), concurrency: numberOption(o, "concurrency", 2), attemptId: option(o, "attempt-id", false), partition: partition(o), evalIds: o.has("evals") ? list(o, "evals") : undefined, models: models(o) });
    case "grade":
      return gradeMatrix(option(o, "run-dir")!);
    case "grade-model":
      return runModelGraders({ runDir: option(o, "run-dir")!, executionAttemptIds: list(o, "attempts"), gradingId: option(o, "grading-id")!, graderHosts: hosts(o, "grader-hosts"), timeoutMs: numberOption(o, "timeout-ms", 300_000), models: models(o) });
    case "judge":
      return runBlindJudges({ runDir: option(o, "run-dir")!, left: option(o, "left")!, right: option(o, "right")!, executionAttemptIds: list(o, "attempts"), comparisonId: option(o, "comparison-id", false), judgeHosts: hosts(o, "judge-hosts"), timeoutMs: numberOption(o, "timeout-ms", 300_000), seed: option(o, "seed", false), models: models(o) });
    case "trigger":
      return runTriggerSuite({ runDir: option(o, "run-dir")!, version: option(o, "version")!, hosts: hosts(o), repetitions: numberOption(o, "repetitions", 3), timeoutMs: numberOption(o, "timeout-ms", 60_000), concurrency: numberOption(o, "concurrency", 6), attemptId: option(o, "attempt-id", false), partition: partition(o), queryIds: o.has("queries") ? list(o, "queries") : undefined, models: models(o) });
    case "benchmark":
      return buildBenchmark({ runDir: option(o, "run-dir")!, left: option(o, "left")!, right: option(o, "right")!, attemptIds: list(o, "attempts"), comparisonId: option(o, "comparison-id", false), minimumEffect: numberOption(o, "minimum-effect", 0.05) });
    case "decide":
      return sealDecision({ runDir: option(o, "run-dir")!, winner: option(o, "winner")!, anchorBenchmarkId: option(o, "anchor-benchmark")!, incumbentBenchmarkId: option(o, "incumbent-benchmark", false), decisionId: option(o, "decision-id", false) });
    case "optimize":
      return optimizeBehavior({ runDir: option(o, "run-dir")!, hosts: hosts(o), judgeHosts: hosts(o, "judge-hosts"), reviserHost: host(o, "reviser-host"), repetitions: numberOption(o, "repetitions", 3), maxRevisions: numberOption(o, "max-revisions", 5), timeoutMs: numberOption(o, "timeout-ms", 600_000), models: models(o), skillCreatorPath: option(o, "skill-creator", false), onProgress: (event) => { process.stderr.write(`${JSON.stringify({ type: "progress", ...event })}\n`); } });
    case "optimize-description":
      return optimizeDescriptions({ runDir: option(o, "run-dir")!, initialVersion: option(o, "version")!, hosts: hosts(o), improverHost: host(o, "improver-host"), repetitions: numberOption(o, "repetitions", 3), maxIterations: numberOption(o, "max-iterations", 5), timeoutMs: numberOption(o, "timeout-ms", 300_000), models: models(o), onProgress: (event) => { process.stderr.write(`${JSON.stringify({ type: "progress", phase: "description", ...event })}\n`); } });
    case "certify":
      return certifyCandidate({ runDir: option(o, "run-dir")!, candidate: option(o, "candidate")!, incumbent: option(o, "incumbent")!, label: option(o, "label")!, hosts: hosts(o), judgeHosts: hosts(o, "judge-hosts"), repetitions: numberOption(o, "repetitions", 3), timeoutMs: numberOption(o, "timeout-ms", 600_000), models: models(o) });
    case "persist-suite":
      return persistSuite(option(o, "run-dir")!);
    case "review-suite":
      return generateEvalReview(option(o, "suite")!, option(o, "output", false));
    case "review":
      return generateReview(option(o, "run-dir")!, option(o, "output", false), option(o, "all", false) === "true");
    case "ingest-feedback":
      return ingestHumanFeedback({ runDir: option(o, "run-dir")!, feedbackPath: option(o, "feedback")!, feedbackId: option(o, "feedback-id")! });
    case "promote":
      return promoteVersion({ runDir: option(o, "run-dir")!, decisionId: option(o, "decision")!, policyAllowsCommit: option(o, "policy-allows-commit", false) === "true", commitMessage: option(o, "commit-message", false), protectedBranches: o.get("protected-branch") });
  }
}

try {
  const result = await main();
  if (typeof result === "string") process.stdout.write(result);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
}
