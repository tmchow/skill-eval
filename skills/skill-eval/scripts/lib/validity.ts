import type { EvalSuite, ExecutionRecord, RunState } from "./types.ts";

export function executionFailure(record: ExecutionRecord): string | null {
  if (record.host_result.timed_out) return "executor timed out";
  if (record.host_result.exit_code !== 0) return `executor exited ${record.host_result.exit_code}`;
  if (record.host_result.malformed_events > 0) return `executor emitted ${record.host_result.malformed_events} malformed events`;
  if (record.source_mutated) return "executor mutated the frozen skill source";
  if (record.wrong_skill_source) return "executor used a same-name skill outside the frozen snapshot";
  return null;
}

export function executionCanBeGraded(record: ExecutionRecord): boolean {
  return executionFailure(record) === null;
}

export function assertComparisonValidity(suite: EvalSuite, state: RunState, left: string, right: string): void {
  if (suite.claim_class === "conformance") {
    throw new Error("conformance evidence validates a contract but cannot produce an improvement comparison");
  }
  if (left !== "anchor") {
    throw new Error(`${suite.claim_class} comparisons require the anchor baseline as the left arm`);
  }
  if (right === "anchor") throw new Error("the candidate must differ from the anchor baseline");
  if (!state.versions.anchor && state.anchor.kind !== "none") throw new Error("anchor baseline snapshot is unavailable");
}

export function assertConfirmationValidity(suite: EvalSuite): void {
  if (suite.claim_class !== "generalization") {
    throw new Error("confirmation requires a generalization claim with validation evidence");
  }
  const trainingOutcome = suite.evals.some((item) => !item.validation && item.expectations.some((expectation) => expectation.evidence_role === "outcome"));
  const validationOutcome = suite.evals.some((item) => item.validation && item.expectations.some((expectation) => expectation.evidence_role === "outcome"));
  if (!trainingOutcome || !validationOutcome) throw new Error("confirmation requires outcome evidence in training and validation");
}
