import { mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { verifyBenchmarkHash, verifyDecisionHash } from "./decision.ts";
import { copyTree, hashTree, readJson, writeJson } from "./json.ts";
import { loadRun, verifyRunIntegrity } from "./workspace.ts";
import type { BenchmarkArtifact, DecisionArtifact } from "./types.ts";

export interface PromoteOptions {
  runDir: string;
  decisionId: string;
  policyAllowsCommit: boolean;
  commitMessage?: string;
  protectedBranches?: string[];
}

export interface PromotionResult {
  applied: boolean;
  committed: boolean;
  commit: string | null;
  reason: string;
  backup_path: string;
  target_path: string;
}

function git(cwd: string, args: string[], allowFailure = false): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const output = { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString().trim() };
  if (!allowFailure && output.exitCode !== 0) throw new Error(output.stderr || `git ${args.join(" ")} failed`);
  return output;
}

export async function promoteVersion(options: PromoteOptions): Promise<PromotionResult> {
  const runDir = resolve(options.runDir);
  await verifyRunIntegrity(runDir);
  const state = await loadRun(runDir);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.decisionId)) throw new Error("promotion requires a sealed decision");
  let decision: DecisionArtifact;
  try { decision = await readJson<DecisionArtifact>(join(state.run_dir, "decisions", `${options.decisionId}.json`)); }
  catch { throw new Error(`promotion requires a sealed decision: ${options.decisionId}`); }
  if (!decision.approved) throw new Error("sealed decision is not approved");
  if (!verifyDecisionHash(decision)) throw new Error("decision hash mismatch");
  const benchmarks = await readJson<BenchmarkArtifact[]>(join(state.run_dir, "benchmarks.json"));
  for (const [id, expectedHash] of Object.entries(decision.benchmark_hashes)) {
    const benchmark = benchmarks.find((item) => item.comparison_id === id);
    if (!benchmark || benchmark.evidence_hash !== expectedHash || !verifyBenchmarkHash(benchmark)) throw new Error(`decision benchmark evidence changed: ${id}`);
  }
  const version = state.versions[decision.winner];
  if (!version) throw new Error(`decision references unknown winner: ${decision.winner}`);
  const expectedWinnerHash = state.hashes.versions[decision.winner];
  if (!expectedWinnerHash || await hashTree(version.path) !== expectedWinnerHash) throw new Error("winner snapshot hash does not match run state");
  if (decision.winner_hash !== expectedWinnerHash) throw new Error("decision winner hash does not match run state");
  const authoredHash = state.hashes.versions.authored;
  if (!authoredHash || await hashTree(state.target_path) !== authoredHash) throw new Error("target changed after the authored snapshot; refusing to overwrite it");

  const promotionDir = join(state.run_dir, "promotion");
  const backupPath = join(promotionDir, "original");
  await mkdir(promotionDir, { recursive: true });
  await copyTree(state.target_path, backupPath);
  await copyTree(version.path, state.target_path);

  const currentBranch = git(state.repo_root, ["branch", "--show-current"], true).stdout.trim() || null;
  const currentStatus = git(state.repo_root, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout.trimEnd();
  const protectedBranches = new Set(["main", "master", ...(options.protectedBranches ?? [])]);
  let reason = "winner applied; repository policy left changes uncommitted";
  let committed = false;
  let commit: string | null = null;
  if (!state.git.initial_clean || !state.git.target_tracked) {
    reason = "winner applied without commit because the repository started dirty or the target was untracked";
  } else if (!options.policyAllowsCommit) {
    reason = "winner applied without commit because project policy was not confirmed";
  } else if (!currentBranch || currentBranch !== state.git.branch) {
    reason = "winner applied without commit because the branch changed during evaluation";
  } else if (protectedBranches.has(currentBranch)) {
    reason = "winner applied without commit on a protected or default branch";
  } else {
    const targetRelative = relative(state.repo_root, state.target_path);
    const unrelated = currentStatus.split("\n").filter(Boolean).filter((line) => !line.slice(3).startsWith(targetRelative));
    if (unrelated.length > 0) {
      reason = "winner applied without commit because unrelated changes appeared during evaluation";
    } else {
      git(state.repo_root, ["add", "--", targetRelative]);
      git(state.repo_root, ["commit", "-m", options.commitMessage ?? `fix(${state.skill_name}): promote evaluated skill revision`]);
      commit = git(state.repo_root, ["rev-parse", "HEAD"]).stdout.trim();
      committed = true;
      reason = "winner applied and committed";
    }
  }
  const result: PromotionResult = { applied: true, committed, commit, reason, backup_path: backupPath, target_path: state.target_path };
  await writeJson(join(promotionDir, "result.json"), result);
  return result;
}
