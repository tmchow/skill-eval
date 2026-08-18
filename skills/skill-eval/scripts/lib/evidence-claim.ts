import { join, resolve } from "node:path";
import { hashValue, readJson, writeJson } from "./json.ts";
import { loadRun, loadSuite, verifyRunIntegrity } from "./workspace.ts";
import { assertConfirmationValidity } from "./validity.ts";
import type { BenchmarkArtifact, EvidenceClaim, EvidencePartition, ExecutionRecord, HostName } from "./types.ts";

export interface SealEvidenceClaimOptions {
  runDir: string;
  benchmarkId: string;
  claimId?: string;
}

export function verifyBenchmarkHash(benchmark: BenchmarkArtifact): boolean {
  const { evidence_hash, ...unsigned } = benchmark;
  return hashValue(unsigned) === evidence_hash;
}

export function verifyEvidenceClaimHash(claim: EvidenceClaim): boolean {
  const { claim_hash, ...unsigned } = claim;
  return hashValue(unsigned) === claim_hash;
}

function identifier(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error("claim id must contain only letters, digits, dot, underscore, or hyphen");
  return value;
}

export async function sealEvidenceClaim(options: SealEvidenceClaimOptions): Promise<EvidenceClaim> {
  const runDir = resolve(options.runDir);
  await verifyRunIntegrity(runDir);
  const state = await loadRun(runDir);
  const suite = await loadSuite(runDir);
  assertConfirmationValidity(suite);
  const benchmark = (await readJson<BenchmarkArtifact[]>(join(runDir, "benchmarks.json")))
    .find((item) => item.comparison_id === options.benchmarkId);
  if (!benchmark) throw new Error(`missing confirmation benchmark: ${options.benchmarkId}`);

  const reasons: string[] = [];
  if (!verifyBenchmarkHash(benchmark)) reasons.push("benchmark hash mismatch");
  if (benchmark.comparison.left !== "anchor" || benchmark.comparison.right !== "authored") reasons.push("confirmation must compare anchor to authored");
  if (!benchmark.partitions.training || !benchmark.partitions.validation) reasons.push("confirmation requires training and validation evidence");
  if (!benchmark.gates.passed) reasons.push("benchmark gates failed");
  if (benchmark.verdict !== "improvement demonstrated") reasons.push("authored source did not demonstrate improvement over the fixed anchor");

  const attemptIds = new Set(benchmark.attempt_ids);
  const executions = (await readJson<ExecutionRecord[]>(join(runDir, "executions.json")))
    .filter((item) => attemptIds.has(item.attempt_id));
  const completedHosts = [...new Set(executions.map((item) => item.host))].sort() as HostName[];
  const completedPartitions = [...new Set(executions.map((item) => item.partition))].sort() as EvidencePartition[];
  for (const host of state.requested_hosts) if (!completedHosts.includes(host)) reasons.push(`confirmation is missing requested host: ${host}`);
  for (const partition of ["training", "validation"] as EvidencePartition[]) if (!completedPartitions.includes(partition)) reasons.push(`confirmation is missing partition: ${partition}`);
  if (!state.versions.authored || !state.hashes.versions.authored) reasons.push("authored snapshot is unavailable");
  if (reasons.length > 0) throw new Error(`cannot seal evidence claim: ${reasons.join("; ")}`);

  const limitations = [
    ...suite.environment?.external_state.map((item) => `unfrozen external state: ${item}`) ?? [],
    ...(state.requested_hosts.length < 2 ? ["cross-host portability was not evaluated"] : []),
    "validation evidence was caller-visible and is not a hidden test set",
  ];
  const id = identifier(options.claimId ?? `claim-${Date.now()}`);
  const unsigned = {
    schema_version: 2 as const,
    claim_id: id,
    created_at: new Date().toISOString(),
    authored_version: "authored" as const,
    authored_hash: state.hashes.versions.authored!,
    anchor: {
      kind: state.anchor.kind,
      ref: state.anchor.ref ?? null,
      commit: state.anchor.commit ?? null,
      snapshot_hash: state.hashes.versions.anchor ?? null,
    },
    suite_hash: state.hashes.suite,
    fixture_hashes: { ...state.hashes.fixtures },
    benchmark_id: benchmark.comparison_id,
    benchmark_hash: benchmark.evidence_hash,
    requested_hosts: [...state.requested_hosts],
    completed_hosts: completedHosts,
    completed_partitions: completedPartitions,
    verdict: "improvement demonstrated" as const,
    environment: {
      fidelity: suite.environment?.fidelity ?? "isolated",
      external_state: [...(suite.environment?.external_state ?? [])],
      validation_visibility: "caller-visible" as const,
    },
    supported: true as const,
    limitations,
  };
  const claim: EvidenceClaim = { ...unsigned, claim_hash: hashValue(unsigned) };
  const path = join(runDir, "claims", `${id}.json`);
  if (await Bun.file(path).exists()) throw new Error(`claim id already exists: ${id}`);
  await writeJson(path, claim);
  return claim;
}
