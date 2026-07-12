import type { EvalCase, Expectation } from "./types.ts";

export function expectationAppliesTo(expectation: Expectation, version: string): boolean {
  const scope = expectation.version_scope ?? "all";
  if (scope === "all") return true;
  if (scope === "anchor") return version === "anchor";
  return version !== "anchor";
}

export function hasExecutionQualitative(evalCase: EvalCase, version: string): boolean {
  return evalCase.expectations.some((expectation) => !expectation.check && expectation.scope !== "comparison" && expectationAppliesTo(expectation, version));
}

export function hasBlindJudgeCriteria(evalCase: EvalCase, left: string, right: string): boolean {
  return evalCase.expectations.some((expectation) => expectation.evidence_role === "outcome" && (expectation.scope === "comparison"
    || (!expectation.check && expectationAppliesTo(expectation, left) && expectationAppliesTo(expectation, right))));
}
