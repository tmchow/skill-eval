import { resolve } from "node:path";
import type { ClaimClass, ComparisonGoal, DeterministicCheck, EvalCase, EvalSuite, EvidenceRole, Expectation, ExpectationScope, Purpose, Severity, TriggerQuery, VersionScope } from "./types.ts";

const purposes = new Set<Purpose>(["improvement", "regression", "restraint", "fallback", "trigger"]);
const severities = new Set<Severity>(["critical", "quality", "diagnostic"]);
const checkTypes = new Set([
  "file_exists", "file_not_exists", "file_contains", "file_not_contains",
  "json_pointer_equals", "final_contains", "final_not_contains",
  "tool_called", "tool_not_called", "tool_call_count", "tool_result_contains", "exit_success",
]);
const claimClasses = new Set<ClaimClass>(["conformance", "effectiveness", "generalization"]);
const expectationScopes = new Set<ExpectationScope>(["execution", "comparison"]);
const comparisonGoals = new Set<ComparisonGoal>(["improve", "not-worse"]);
const versionScopes = new Set<VersionScope>(["all", "anchor", "candidate"]);
const evidenceRoles = new Set<EvidenceRole>(["outcome", "mechanism"]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function identifier(value: unknown, label: string): string {
  const id = text(value, label);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error(`${label} must use letters, digits, dot, underscore, or hyphen`);
  return id;
}

function validateCheck(value: unknown, label: string): DeterministicCheck | undefined {
  if (value === undefined) return undefined;
  const check = object(value, label);
  const type = text(check.type, `${label}.type`);
  if (!checkTypes.has(type)) throw new Error(`${label}.type is unsupported: ${type}`);
  if (type.includes("file") || type === "json_pointer_equals") text(check.path, `${label}.path`);
  if (check.root !== undefined && !["output", "workspace"].includes(check.root as string)) throw new Error(`${label}.root must be output or workspace`);
  if (["file_contains", "file_not_contains", "final_contains", "final_not_contains", "tool_called", "tool_not_called", "tool_call_count", "tool_result_contains"].includes(type)) text(check.value, `${label}.value`);
  if (type === "tool_result_contains") text(check.tool, `${label}.tool`);
  if (type === "json_pointer_equals") text(check.pointer, `${label}.pointer`);
  if (type === "tool_call_count" && (!Number.isInteger(check.count) || (check.count as number) < 0)) throw new Error(`${label}.count must be a non-negative integer`);
  return check as DeterministicCheck;
}

function validateExpectation(value: unknown, evalId: string, index: number): Expectation {
  const expectation = object(value, `eval ${evalId} expectation ${index}`);
  const severity = text(expectation.severity, `eval ${evalId} expectation ${index}.severity`) as Severity;
  const evidenceRole = text(expectation.evidence_role, `eval ${evalId} expectation ${index}.evidence_role`) as EvidenceRole;
  if (!severities.has(severity)) throw new Error(`eval ${evalId} expectation ${index} has invalid severity`);
  if (!evidenceRoles.has(evidenceRole)) throw new Error(`eval ${evalId} expectation ${index}.evidence_role must be outcome or mechanism`);
  const scope = expectation.scope === undefined ? undefined : text(expectation.scope, `eval ${evalId} expectation ${index}.scope`) as ExpectationScope;
  const comparisonGoal = expectation.comparison_goal === undefined ? undefined : text(expectation.comparison_goal, `eval ${evalId} expectation ${index}.comparison_goal`) as ComparisonGoal;
  const versionScope = expectation.version_scope === undefined ? undefined : text(expectation.version_scope, `eval ${evalId} expectation ${index}.version_scope`) as VersionScope;
  const prerequisite = expectation.prerequisite === true;
  const outcomeBasis = expectation.outcome_basis === undefined ? undefined : text(expectation.outcome_basis, `eval ${evalId} expectation ${index}.outcome_basis`);
  if (scope !== undefined && !expectationScopes.has(scope)) throw new Error(`eval ${evalId} expectation ${index}.scope must be execution or comparison`);
  if (scope === "comparison" && expectation.check !== undefined) throw new Error(`eval ${evalId} expectation ${index} cannot use a deterministic check with comparison scope`);
  if (scope === "comparison" && evidenceRole !== "outcome") throw new Error(`eval ${evalId} expectation ${index}.comparison scope requires evidence_role outcome`);
  if (scope === "comparison" && (comparisonGoal === undefined || !comparisonGoals.has(comparisonGoal))) throw new Error(`eval ${evalId} expectation ${index}.comparison_goal must be improve or not-worse`);
  if (scope !== "comparison" && comparisonGoal !== undefined) throw new Error(`eval ${evalId} expectation ${index}.comparison_goal requires comparison scope`);
  if (versionScope !== undefined && !versionScopes.has(versionScope)) throw new Error(`eval ${evalId} expectation ${index}.version_scope must be all, anchor, or candidate`);
  if (scope === "comparison" && versionScope !== undefined && versionScope !== "all") throw new Error(`eval ${evalId} expectation ${index}.version_scope requires execution scope`);
  if (evidenceRole === "outcome" && versionScope !== undefined && versionScope !== "all") throw new Error(`eval ${evalId} expectation ${index}.outcome evidence must apply to all versions`);
  if (prerequisite && (scope === "comparison" || expectation.check === undefined || severity !== "critical")) {
    throw new Error(`eval ${evalId} expectation ${index}.prerequisite requires a critical execution-scoped deterministic check`);
  }
  if (prerequisite && evidenceRole !== "mechanism") throw new Error(`eval ${evalId} expectation ${index}.prerequisite requires evidence_role mechanism`);
  if (outcomeBasis !== undefined && outcomeBasis !== "terminal-action") throw new Error(`eval ${evalId} expectation ${index}.outcome_basis must be terminal-action`);
  const rawCheckType = String((expectation.check as Record<string, unknown> | undefined)?.type ?? "");
  if (outcomeBasis !== undefined && (evidenceRole !== "outcome" || !rawCheckType.startsWith("tool_"))) {
    throw new Error(`eval ${evalId} expectation ${index}.outcome_basis is only valid for outcome tool checks`);
  }
  return {
    id: identifier(expectation.id, `eval ${evalId} expectation ${index}.id`),
    text: text(expectation.text, `eval ${evalId} expectation ${index}.text`),
    severity,
    evidence_role: evidenceRole,
    scope,
    comparison_goal: comparisonGoal,
    version_scope: versionScope,
    prerequisite,
    outcome_basis: outcomeBasis as "terminal-action" | undefined,
    check: validateCheck(expectation.check, `eval ${evalId} expectation ${index}.check`),
  };
}

function validateEval(value: unknown, index: number): EvalCase {
  const evalCase = object(value, `eval ${index}`);
  const id = identifier(evalCase.id, `eval ${index}.id`);
  const purpose = text(evalCase.purpose, `eval ${id}.purpose`) as Purpose;
  const severity = text(evalCase.severity, `eval ${id}.severity`) as Severity;
  if (!purposes.has(purpose)) throw new Error(`eval ${id} has invalid purpose`);
  if (!severities.has(severity)) throw new Error(`eval ${id} has invalid severity`);
  if (!Array.isArray(evalCase.expectations) || evalCase.expectations.length === 0) {
    throw new Error(`eval ${id} must define at least one expectation`);
  }
  const fixture = evalCase.fixture === undefined ? undefined : text(evalCase.fixture, `eval ${id}.fixture`);
  if (fixture && (resolve("/suite", fixture) === "/suite" || !resolve("/suite", fixture).startsWith("/suite/"))) {
    throw new Error("fixture must stay inside the suite directory");
  }
  const expectations = evalCase.expectations.map((item, expectationIndex) => validateExpectation(item, id, expectationIndex));
  const expectationIds = new Set<string>();
  for (const expectation of expectations) {
    if (expectationIds.has(expectation.id)) throw new Error(`duplicate expectation id in eval ${id}: ${expectation.id}`);
    expectationIds.add(expectation.id);
  }
  const prompt = text(evalCase.prompt, `eval ${id}.prompt`);
  return {
    id,
    name: text(evalCase.name, `eval ${id}.name`),
    purpose,
    severity,
    prompt,
    fixture,
    validation: evalCase.validation === true,
    expectations,
  };
}

function validateTrigger(value: unknown, index: number): TriggerQuery {
  const query = object(value, `trigger query ${index}`);
  if (typeof query.should_trigger !== "boolean") throw new Error(`trigger query ${index}.should_trigger must be boolean`);
  return {
    id: identifier(query.id, `trigger query ${index}.id`),
    query: text(query.query, `trigger query ${index}.query`),
    should_trigger: query.should_trigger,
    validation: query.validation === true,
  };
}

export function validateSuite(value: unknown): EvalSuite {
  const suite = object(value, "suite");
  if (suite.schema_version !== 2) throw new Error("suite.schema_version must be 2");
  const claimClass = text(suite.claim_class, "suite.claim_class") as ClaimClass;
  if (!claimClasses.has(claimClass)) throw new Error("suite.claim_class must be conformance, effectiveness, or generalization");
  if (!Array.isArray(suite.evals)) throw new Error("suite.evals must be an array");
  const evals = suite.evals.map(validateEval);
  const ids = new Set<string>();
  for (const evalCase of evals) {
    if (ids.has(evalCase.id)) throw new Error(`duplicate eval id: ${evalCase.id}`);
    ids.add(evalCase.id);
  }
  const triggerQueries = suite.trigger_queries === undefined
    ? undefined
    : Array.isArray(suite.trigger_queries)
      ? suite.trigger_queries.map(validateTrigger)
      : (() => { throw new Error("suite.trigger_queries must be an array"); })();
  if (evals.length === 0 && (triggerQueries?.length ?? 0) === 0) {
    throw new Error("suite must contain at least one behavior case or trigger query");
  }
  const triggerIds = new Set<string>();
  for (const query of triggerQueries ?? []) {
    if (triggerIds.has(query.id)) throw new Error(`duplicate trigger query id: ${query.id}`);
    triggerIds.add(query.id);
  }
  let environment: EvalSuite["environment"];
  if (suite.environment !== undefined) {
    const raw = object(suite.environment, "suite.environment");
    const fidelity = text(raw.fidelity, "suite.environment.fidelity") as NonNullable<EvalSuite["environment"]>["fidelity"];
    if (!["isolated", "project-context", "live"].includes(fidelity)) throw new Error("suite.environment.fidelity must be isolated, project-context, or live");
    if (!Array.isArray(raw.external_state) || raw.external_state.some((item) => typeof item !== "string" || !item.trim())) throw new Error("suite.environment.external_state must be an array of non-empty strings");
    const capabilities = raw.capabilities === undefined ? undefined : raw.capabilities;
    if (capabilities !== undefined && (!Array.isArray(capabilities) || capabilities.some((item) => item !== "git-write"))) {
      throw new Error("suite.environment.capabilities may contain only git-write");
    }
    if ((capabilities as unknown[] | undefined)?.includes("git-write") && (fidelity !== "isolated" || evals.some((item) => !item.fixture))) {
      throw new Error("git-write capability requires isolated fidelity and a fixture for every behavior case");
    }
    let comparisonProjection: NonNullable<EvalSuite["environment"]>["comparison_projection"];
    if (raw.comparison_projection !== undefined) {
      const projection = object(raw.comparison_projection, "suite.environment.comparison_projection");
      if (!Array.isArray(projection.text_redactions) || projection.text_redactions.length === 0 || projection.text_redactions.length > 16) {
        throw new Error("suite.environment.comparison_projection.text_redactions must contain 1 to 16 redactions");
      }
      const textRedactions = projection.text_redactions.map((item, index) => {
        const redaction = object(item, `suite.environment.comparison_projection.text_redactions ${index}`);
        const pattern = text(redaction.pattern, `suite.environment.comparison_projection.text_redactions ${index}.pattern`);
        if (pattern.length > 500) throw new Error("comparison projection pattern is too long");
        try { new RegExp(pattern, "g"); } catch { throw new Error(`comparison projection pattern is invalid: ${pattern}`); }
        if (typeof redaction.replacement !== "string") throw new Error(`suite.environment.comparison_projection.text_redactions ${index}.replacement must be a string`);
        return { pattern, replacement: redaction.replacement };
      });
      if (projection.omit_tool_events !== undefined && typeof projection.omit_tool_events !== "boolean") throw new Error("suite.environment.comparison_projection.omit_tool_events must be boolean");
      comparisonProjection = { text_redactions: textRedactions, omit_tool_events: projection.omit_tool_events === true };
    }
    if (raw.comparison_projection_required !== undefined && typeof raw.comparison_projection_required !== "boolean") {
      throw new Error("suite.environment.comparison_projection_required must be boolean");
    }
    if (raw.comparison_projection_required === true && !comparisonProjection) {
      throw new Error("suite.environment.comparison_projection_required requires comparison_projection");
    }
    environment = {
      fidelity,
      external_state: raw.external_state as string[],
      capabilities: capabilities as Array<"git-write"> | undefined,
      comparison_projection: comparisonProjection,
      comparison_projection_required: raw.comparison_projection_required === true,
    };
  }
  if (claimClass !== "conformance" && environment === undefined) throw new Error(`${claimClass} suites must declare suite.environment fidelity and external_state`);
  if (claimClass !== "conformance" && evals.length > 0 && !evals.some((item) => item.expectations.some((expectation) => expectation.evidence_role === "outcome"))) {
    throw new Error(`${claimClass} behavior suites require outcome evidence`);
  }
  if (claimClass !== "conformance") {
    for (const evalCase of evals) {
      for (const expectation of evalCase.expectations) {
        if (expectation.evidence_role === "outcome" && expectation.check?.type.startsWith("tool_") && expectation.outcome_basis !== "terminal-action") {
          throw new Error(`eval ${evalCase.id} outcome tool check ${expectation.id} must declare outcome_basis terminal-action or be labeled mechanism`);
        }
      }
    }
  }
  if (claimClass === "generalization" && evals.length > 0) {
    for (const partition of ["training", "validation"] as const) {
      const hasOutcome = evals.some((item) => (item.validation ? "validation" : "training") === partition
        && item.expectations.some((expectation) => expectation.evidence_role === "outcome"));
      if (!hasOutcome) throw new Error(`generalization behavior suites require ${partition} outcome evidence`);
    }
  }
  const skillName = text(suite.skill_name, "suite.skill_name");
  const escapedName = skillName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const qualified = `(?:[a-zA-Z0-9._-]+:)?${escapedName}`;
  const installedInvocation = new RegExp([
    `Skill\\s*\\(\\s*["']${qualified}["']`,
    `(?:^|\\s)/${qualified}(?=\\s|$|[.,;:!?])`,
    `(?:^|\\s)\\$${escapedName}(?=\\s|$|[.,;:!?])`,
    `Skill\\s+tool[^\\n]{0,80}\\b(?:skill|name)\\s*[=:]\\s*["']?${qualified}\\b`,
  ].join("|"), "im");
  for (const evalCase of evals) {
    if (installedInvocation.test(evalCase.prompt)) throw new Error(`eval ${evalCase.id}.prompt must not invoke the installed same-name skill; the executor supplies the frozen snapshot`);
  }
  return {
    schema_version: 2,
    claim_class: claimClass,
    skill_name: skillName,
    hypothesis: text(suite.hypothesis, "suite.hypothesis"),
    environment,
    evals,
    trigger_queries: triggerQueries,
  };
}
