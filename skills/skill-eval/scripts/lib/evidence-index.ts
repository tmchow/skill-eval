import { join, resolve } from "node:path";
import { hashValue, readOptionalJson, writeJson } from "./json.ts";
import { executionFailure } from "./validity.ts";
import { loadInvalidatedChecks } from "./invalidations.ts";
import { loadRun, loadSuite, verifyRunIntegrity } from "./workspace.ts";
import type { BenchmarkArtifact, EvidenceRole, ExecutionRecord, GradingResult, HostName, InvalidatedCheck, JudgeResult, ModelGradingResult, TriggerResult } from "./types.ts";

interface ScriptCheckFact { check_id: string; passed: boolean }

export interface EvidenceFailure {
  source: "execution" | "deterministic-grade" | "model-grade" | "blind-comparison";
  attempt_id: string;
  partition: string;
  host: string;
  eval_id: string;
  version: string;
  expectation_id: string | null;
  evidence_role: EvidenceRole | null;
  status: "FAIL" | "BLOCKED";
  evidence: string;
  artifact: string;
}

export interface EvidenceIndex {
  schema_version: 2;
  generated_at: string;
  run_id: string;
  source_hash: string;
  requested_hosts: HostName[];
  completed_hosts: HostName[];
  missing_hosts: HostName[];
  completed_partitions: string[];
  failures: EvidenceFailure[];
  invalidated_checks: InvalidatedCheck[];
  benchmarks: Array<Pick<BenchmarkArtifact, "comparison_id" | "comparison" | "verdict" | "gates" | "preferences" | "cross_model" | "evidence_hash">>;
  trigger_records: number;
  script_checks: ScriptCheckFact[];
  content_hash: string;
}

export async function buildEvidenceIndex(runDirInput: string): Promise<EvidenceIndex> {
  const runDir = resolve(runDirInput);
  await verifyRunIntegrity(runDir);
  const state = await loadRun(runDir);
  const suite = await loadSuite(runDir);
  const [executions, gradings, modelGradings, judgments, triggers, scriptChecks, benchmarks] = await Promise.all([
    readOptionalJson<ExecutionRecord[]>(join(runDir, "executions.json"), []),
    readOptionalJson<GradingResult[]>(join(runDir, "gradings.json"), []),
    readOptionalJson<ModelGradingResult[]>(join(runDir, "model-gradings.json"), []),
    readOptionalJson<JudgeResult[]>(join(runDir, "judgments.json"), []),
    readOptionalJson<TriggerResult[]>(join(runDir, "triggers.json"), []),
    readOptionalJson<ScriptCheckFact[]>(join(runDir, "script-checks.json"), []),
    readOptionalJson<BenchmarkArtifact[]>(join(runDir, "benchmarks.json"), []),
  ]);
  const invalidations = await loadInvalidatedChecks(runDir);
  const sourceHash = hashValue({ state, suite, executions, gradings, modelGradings, judgments, triggers, scriptChecks, invalidations, benchmarks });
  const failures: EvidenceFailure[] = [];

  for (const execution of executions) {
    const failure = executionFailure(execution);
    if (!failure) continue;
    failures.push({ source: "execution", attempt_id: execution.attempt_id, partition: execution.partition, host: execution.host, eval_id: execution.eval_id, version: execution.version, expectation_id: null, evidence_role: null, status: "FAIL", evidence: failure, artifact: execution.run_dir });
  }
  for (const grade of gradings) {
    for (const expectation of grade.expectations.filter((item) => item.passed === false || item.blocked)) {
      failures.push({ source: "deterministic-grade", attempt_id: grade.attempt_id ?? "unknown", partition: grade.partition ?? "unknown", host: grade.host, eval_id: grade.eval_id, version: grade.version, expectation_id: expectation.id, evidence_role: expectation.evidence_role, status: expectation.blocked ? "BLOCKED" : "FAIL", evidence: expectation.evidence, artifact: join(runDir, "gradings.json") });
    }
  }
  for (const grade of modelGradings) {
    for (const expectation of grade.expectations.filter((item) => item.status !== "PASS")) {
      failures.push({ source: "model-grade", attempt_id: grade.execution_attempt_id, partition: grade.partition, host: grade.grader_host, eval_id: grade.eval_id, version: grade.version, expectation_id: expectation.id, evidence_role: expectation.evidence_role, status: expectation.status === "FAIL" ? "FAIL" : "BLOCKED", evidence: expectation.evidence, artifact: grade.run_dir });
    }
  }
  for (const judgment of judgments.filter((item) => item.valid)) {
    for (const expectation of (judgment.expectations ?? []).filter((item) => item.status !== "PASS")) {
      failures.push({ source: "blind-comparison", attempt_id: judgment.execution_attempt_id, partition: executions.find((item) => item.attempt_id === judgment.execution_attempt_id)?.partition ?? "unknown", host: judgment.judge_host, eval_id: judgment.eval_id, version: judgment.right_version, expectation_id: expectation.id, evidence_role: expectation.evidence_role, status: expectation.status === "FAIL" ? "FAIL" : "BLOCKED", evidence: expectation.evidence, artifact: judgment.run_dir });
    }
  }

  const completedHosts = [...new Set([...executions.map((item) => item.host), ...triggers.map((item) => item.host)])].sort() as HostName[];
  const normalized = {
    schema_version: 2 as const,
    run_id: state.run_id,
    source_hash: sourceHash,
    requested_hosts: [...state.requested_hosts],
    completed_hosts: completedHosts,
    missing_hosts: state.requested_hosts.filter((host) => !completedHosts.includes(host)),
    completed_partitions: [...new Set([...executions.map((item) => item.partition), ...triggers.map((item) => item.partition)])].sort(),
    failures,
    invalidated_checks: invalidations,
    benchmarks: benchmarks.map((item) => ({ comparison_id: item.comparison_id, comparison: item.comparison, verdict: item.verdict, gates: item.gates, preferences: item.preferences, cross_model: item.cross_model, evidence_hash: item.evidence_hash })),
    trigger_records: triggers.length,
    script_checks: scriptChecks.map((item) => ({ check_id: item.check_id, passed: item.passed })),
  };
  const index: EvidenceIndex = { ...normalized, generated_at: new Date().toISOString(), content_hash: hashValue(normalized) };
  await writeJson(join(runDir, "artifacts", "evidence-index.json"), index);
  return index;
}
