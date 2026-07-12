import { describe, expect, test } from "bun:test";
import { validateSuite } from "../skills/skill-eval/scripts/lib/suite.ts";

const validSuite = {
  schema_version: 2,
  claim_class: "effectiveness",
  environment: { fidelity: "isolated", external_state: [] },
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
          severity: "critical", evidence_role: "outcome",
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
    expect(suite.claim_class).toBe("effectiveness");
    expect(suite.skill_name).toBe("example-skill");
    expect(suite.evals[0]?.expectations[0]?.check?.type).toBe("final_not_contains");
  });

  test("requires an explicit claim class", () => {
    const value = structuredClone(validSuite) as any;
    delete value.claim_class;
    expect(() => validateSuite(value)).toThrow("suite.claim_class");
    value.claim_class = "quality-ish";
    expect(() => validateSuite(value)).toThrow("suite.claim_class");
  });

  test("requires effectiveness suites to declare environment fidelity", () => {
    const value = structuredClone(validSuite) as any;
    delete value.environment;
    expect(() => validateSuite(value)).toThrow("suite.environment");
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

  test("requires an explicit terminal-action basis for effectiveness tool outcomes", () => {
    const value = structuredClone(validSuite) as any;
    value.evals[0].expectations = [
      { id: "peer", text: "peer launched once", severity: "critical", evidence_role: "outcome", check: { type: "tool_call_count", value: "cross-model-doc-review.sh", count: 1 } },
    ];
    expect(() => validateSuite(value)).toThrow("must declare outcome_basis terminal-action or be labeled mechanism");
    value.evals[0].expectations[0].outcome_basis = "terminal-action";
    expect(validateSuite(value).evals[0]!.expectations[0]!.check!.type).toBe("tool_call_count");
  });

  test("accepts candidate-only deterministic prerequisites", () => {
    const value = structuredClone(validSuite) as any;
    value.evals[0].expectations = [
      {
        id: "peer-output",
        text: "the candidate peer returned usable output",
        severity: "critical", evidence_role: "mechanism",
        version_scope: "candidate",
        prerequisite: true,
        check: { type: "tool_result_contains", tool: "cross-model-doc-review.sh", value: "wrote ", regex: false },
      },
      {
        id: "review-quality",
        text: "the final review is useful",
        severity: "quality",
        evidence_role: "outcome",
      },
    ];
    expect(validateSuite(value).evals[0]!.expectations[0]).toMatchObject({ version_scope: "candidate", prerequisite: true });

    value.evals[0].expectations[0].severity = "quality";
    expect(() => validateSuite(value)).toThrow("prerequisite requires a critical execution-scoped deterministic check");
    value.evals[0].expectations[0].severity = "critical";
    delete value.evals[0].expectations[0].check;
    expect(() => validateSuite(value)).toThrow("prerequisite requires a critical execution-scoped deterministic check");
  });

  test("does not allow version scoping on paired comparison criteria", () => {
    const value = structuredClone(validSuite) as any;
    value.evals[0].expectations = [
      { id: "coverage", text: "candidate improves coverage", severity: "quality", evidence_role: "outcome", scope: "comparison", comparison_goal: "improve", version_scope: "candidate" },
    ];
    expect(() => validateSuite(value)).toThrow("version_scope requires execution scope");
  });

  test("does not allow mechanism evidence to become a blind comparison criterion", () => {
    const value = structuredClone(validSuite) as any;
    value.evals[0].expectations = [
      { id: "peer", text: "the peer ran more effectively", severity: "quality", evidence_role: "mechanism", scope: "comparison", comparison_goal: "improve" },
    ];
    expect(() => validateSuite(value)).toThrow("comparison scope requires evidence_role outcome");
  });

  test("does not allow arm-scoped outcome evidence", () => {
    const value = structuredClone(validSuite) as any;
    value.evals[0].expectations = [
      { id: "candidate-result", text: "candidate emits a result", severity: "quality", evidence_role: "outcome", version_scope: "candidate", check: { type: "file_exists", path: "result.txt" } },
    ];
    expect(() => validateSuite(value)).toThrow("outcome evidence must apply to all versions");
  });

  test("accepts workspace-rooted artifact checks", () => {
    const value = structuredClone(validSuite) as any;
    value.evals[0].expectations = [
      { id: "state", text: "thread remains open", severity: "critical", evidence_role: "outcome", check: { type: "json_pointer_equals", root: "workspace", path: "state.json", pointer: "/resolved", value: false } },
    ];
    expect(validateSuite(value).evals[0]!.expectations[0]!.check).toMatchObject({ root: "workspace" });
    value.evals[0].expectations[0].check.root = "repo-ish";
    expect(() => validateSuite(value)).toThrow("root must be output or workspace");
  });

  test("separates execution and comparison qualitative expectations", () => {
    const value = structuredClone(validSuite) as any;
    value.evals[0].expectations = [
      { id: "grounded", text: "findings are grounded", severity: "critical", evidence_role: "outcome", scope: "execution" },
      { id: "coverage", text: "coverage is no worse than baseline", severity: "quality", evidence_role: "outcome", scope: "comparison", comparison_goal: "not-worse" },
    ];
    expect(validateSuite(value).evals[0]!.expectations.map((item) => item.scope)).toEqual(["execution", "comparison"]);
    value.evals[0].expectations[1].check = { type: "exit_success" };
    expect(() => validateSuite(value)).toThrow("deterministic check with comparison scope");
    delete value.evals[0].expectations[1].check;
    delete value.evals[0].expectations[1].comparison_goal;
    expect(() => validateSuite(value)).toThrow("comparison_goal must be improve or not-worse");
  });

  test("rejects prompts that invoke an installed same-name skill", () => {
    const value = structuredClone(validSuite) as any;
    value.evals[0].prompt = 'Invoke it exactly as Skill("example-skill", "task")';
    expect(() => validateSuite(value)).toThrow("installed same-name skill");
    for (const prompt of ["Run /plugin:example-skill, then continue", "Use $example-skill.", "Use the Skill tool with skill=plugin:example-skill, then continue"]) {
      value.evals[0].prompt = prompt;
      expect(() => validateSuite(value)).toThrow("installed same-name skill");
    }
  });

  test("limits git-write capability to isolated fixture-backed suites", () => {
    const value = structuredClone(validSuite) as any;
    value.environment.capabilities = ["git-write"];
    expect(validateSuite(value).environment?.capabilities).toEqual(["git-write"]);
    value.environment.fidelity = "live";
    expect(() => validateSuite(value)).toThrow("git-write capability requires isolated fidelity");
    value.environment.fidelity = "isolated";
    delete value.evals[0].fixture;
    expect(() => validateSuite(value)).toThrow("fixture for every behavior case");
  });

  test("validates symmetric blind comparison projections", () => {
    const value = structuredClone(validSuite) as any;
    value.environment.comparison_projection = {
      text_redactions: [{ pattern: "-(?:claude|codex)\\b", replacement: "" }],
      omit_tool_events: true,
    };
    expect(validateSuite(value).environment?.comparison_projection).toEqual(value.environment.comparison_projection);
    value.environment.comparison_projection.text_redactions[0].pattern = "[";
    expect(() => validateSuite(value)).toThrow("comparison projection pattern is invalid");
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
      { id: "negative", query: "Review this pull request", should_trigger: false, validation: true },
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
