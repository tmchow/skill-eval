import { describe, expect, test } from "bun:test";
import { validateSuite } from "../skills/skill-eval/scripts/lib/suite.ts";

const validSuite = {
  schema_version: 1,
  skill_name: "example-skill",
  hypothesis: "The revision closes the unavailable-tool fallback.",
  evals: [
    {
      id: "fallback",
      name: "Unavailable tool",
      purpose: "fallback",
      severity: "critical",
      prompt: "Complete the task without the optional tool.",
      fixture: "fixtures/fallback",
      expectations: [
        {
          id: "closed",
          text: "The agent does not claim the unavailable tool ran.",
          severity: "critical",
          check: { type: "final_not_contains", value: "tool completed" },
        },
      ],
    },
  ],
  trigger_queries: [{ id: "positive", query: "Evaluate this skill", should_trigger: true }],
} as const;

describe("eval suite validation", () => {
  test("accepts a complete suite and normalizes optional arrays", () => {
    const suite = validateSuite(structuredClone(validSuite));
    expect(suite.skill_name).toBe("example-skill");
    expect(suite.evals[0]?.expectations[0]?.check?.type).toBe("final_not_contains");
  });

  test("rejects duplicate eval identifiers", () => {
    const value = structuredClone(validSuite) as any;
    value.evals.push(structuredClone(value.evals[0]));
    expect(() => validateSuite(value)).toThrow("duplicate eval id: fallback");
  });

  test("rejects identifiers that could escape artifact directories", () => {
    const suite = structuredClone(validSuite) as any;
    suite.evals[0]!.id = "../../outside";
    expect(() => validateSuite(suite)).toThrow("eval 0.id must use letters, digits, dot, underscore, or hyphen");
    suite.evals[0]!.id = "case";
    suite.trigger_queries![0]!.id = "../trigger";
    expect(() => validateSuite(suite)).toThrow("trigger query 0.id must use letters, digits, dot, underscore, or hyphen");
  });

  test("rejects fixture paths that escape the suite directory", () => {
    const value = structuredClone(validSuite) as any;
    value.evals[0].fixture = "../private";
    expect(() => validateSuite(value)).toThrow("fixture must stay inside the suite directory");
  });

  test("requires at least one expectation for behavioral cases", () => {
    const value = structuredClone(validSuite) as any;
    value.evals[0].expectations = [];
    expect(() => validateSuite(value)).toThrow("must define at least one expectation");
  });

  test("accepts deterministic tool-call trace expectations", () => {
    const value = structuredClone(validSuite) as any;
    value.evals[0].expectations = [
      { id: "peer", text: "peer launched once", severity: "critical", check: { type: "tool_call_count", value: "cross-model-doc-review.sh", count: 1 } },
    ];
    expect(validateSuite(value).evals[0]!.expectations[0]!.check!.type).toBe("tool_call_count");
  });

  test("rejects duplicate trigger query identifiers", () => {
    const value = structuredClone(validSuite) as any;
    value.trigger_queries.push(structuredClone(value.trigger_queries[0]));
    expect(() => validateSuite(value)).toThrow("duplicate trigger query id: positive");
  });

  test("accepts a trigger-only suite for focused discovery evaluation", () => {
    const value = structuredClone(validSuite) as any;
    value.evals = [];
    value.trigger_queries = [
      { id: "positive", query: "Evaluate this skill", should_trigger: true },
      { id: "negative", query: "Review this pull request", should_trigger: false, holdout: true },
    ];
    expect(validateSuite(value).evals).toEqual([]);
  });

  test("rejects a suite with no behavior cases or trigger queries", () => {
    const value = structuredClone(validSuite) as any;
    value.evals = [];
    value.trigger_queries = [];
    expect(() => validateSuite(value)).toThrow("at least one behavior case or trigger query");
  });
});
