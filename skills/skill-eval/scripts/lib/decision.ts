import { join, resolve } from "node:path";
import { hashTree, hashValue, readJson, writeJson } from "./json.ts";
import { loadRun, verifyRunIntegrity } from "./workspace.ts";
import type { BenchmarkArtifact, DecisionArtifact } from "./types.ts";

export interface SealDecisionOptions {
  runDir: string;
  winner: string;
  anchorBenchmarkId: string;
  incumbentBenchmarkId?: string;
  decisionId?: string;
}

export function verifyBenchmarkHash(benchmark: BenchmarkArtifact): boolean {
  const { evidence_hash, ...unsigned } = benchmark;
  return hashValue(unsigned) === evidence_hash;
}

export async function sealDecision(options: SealDecisionOptions): Promise<DecisionArtifact> {
  const runDir = resolve(options.runDir);
  await verifyRunIntegrity(runDir);
  const state = await loadRun(runDir);
  const winner = state.versions[options.winner];
  if (!winner) throw new Error(`unknown winner: ${options.winner}`);
  const benchmarks = await readJson<BenchmarkArtifact[]>(join(runDir, "benchmarks.json"));
  const anchor = benchmarks.find((item) => item.comparison_id === options.anchorBenchmarkId);
  const incumbent = options.incumbentBenchmarkId ? benchmarks.find((item) => item.comparison_id === options.incumbentBenchmarkId) : null;
  if (!anchor) throw new Error(`missing anchor benchmark: ${options.anchorBenchmarkId}`);
  if (options.incumbentBenchmarkId && !incumbent) throw new Error(`missing incumbent benchmark: ${options.incumbentBenchmarkId}`);
  const reasons: string[] = [];
  for (const benchmark of [anchor, ...(incumbent ? [incumbent] : [])]) {
    if (!verifyBenchmarkHash(benchmark)) reasons.push(`benchmark hash mismatch: ${benchmark.comparison_id}`);
    if (benchmark.comparison.right !== options.winner) reasons.push(`benchmark does not evaluate winner: ${benchmark.comparison_id}`);
    if (!benchmark.partitions.training || !benchmark.partitions.holdout) reasons.push(`benchmark lacks training or holdout evidence: ${benchmark.comparison_id}`);
    if (!benchmark.gates.passed) reasons.push(`benchmark gates failed: ${benchmark.comparison_id}`);
  }
  if (anchor.comparison.left !== "anchor") reasons.push("anchor benchmark does not use the fixed anchor");
  const parent = winner.parent;
  if (parent && parent !== "anchor" && !incumbent) reasons.push(`winner requires an incumbent benchmark against ${parent}`);
  if (parent && parent !== "anchor" && incumbent?.comparison.left !== parent) reasons.push(`incumbent benchmark does not compare winner parent ${parent}`);
  if (anchor.verdict !== "improvement demonstrated") reasons.push("winner did not demonstrate improvement over the fixed anchor");
  if (incumbent && !["improvement demonstrated", "no regression found"].includes(incumbent.verdict)) reasons.push("winner regressed against the incumbent");
  if (reasons.length > 0) throw new Error(`cannot approve winner: ${reasons.join("; ")}`);
  const winnerHash = await hashTree(winner.path);
  if (state.hashes.versions[options.winner] !== winnerHash) throw new Error("winner snapshot hash does not match run state");
  const id = options.decisionId ?? `decision-${Date.now()}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error("decision id must contain only letters, digits, dot, underscore, or hyphen");
  const unsigned = {
    schema_version: 1 as const,
    decision_id: id,
    created_at: new Date().toISOString(),
    winner: options.winner,
    winner_hash: winnerHash,
    anchor_benchmark_id: anchor.comparison_id,
    incumbent_benchmark_id: incumbent?.comparison_id ?? null,
    approved: true,
    reasons: [] as string[],
    benchmark_hashes: Object.fromEntries([anchor, ...(incumbent ? [incumbent] : [])].map((item) => [item.comparison_id, item.evidence_hash])),
  };
  const decision: DecisionArtifact = { ...unsigned, decision_hash: hashValue(unsigned) };
  const path = join(runDir, "decisions", `${id}.json`);
  try { await readJson(path); throw new Error(`decision id already exists: ${id}`); } catch (error) { if (error instanceof Error && error.message.startsWith("decision id already")) throw error; }
  await writeJson(path, decision);
  return decision;
}

export function verifyDecisionHash(decision: DecisionArtifact): boolean {
  const { decision_hash, ...unsigned } = decision;
  return hashValue(unsigned) === decision_hash;
}
