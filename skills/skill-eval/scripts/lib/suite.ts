import { resolve } from "node:path";
import type { DeterministicCheck, EvalCase, EvalSuite, Expectation, Purpose, Severity, TriggerQuery } from "./types.ts";

const purposes = new Set<Purpose>(["improvement", "regression", "restraint", "fallback", "trigger"]);
const severities = new Set<Severity>(["critical", "quality", "diagnostic"]);
const checkTypes = new Set([
  "file_exists", "file_not_exists", "file_contains", "file_not_contains",
  "json_pointer_equals", "final_contains", "final_not_contains",
  "tool_called", "tool_not_called", "tool_call_count", "exit_success",
]);

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
  if (["file_contains", "file_not_contains", "final_contains", "final_not_contains", "tool_called", "tool_not_called", "tool_call_count"].includes(type)) text(check.value, `${label}.value`);
  if (type === "json_pointer_equals") text(check.pointer, `${label}.pointer`);
  if (type === "tool_call_count" && (!Number.isInteger(check.count) || (check.count as number) < 0)) throw new Error(`${label}.count must be a non-negative integer`);
  return check as DeterministicCheck;
}

function validateExpectation(value: unknown, evalId: string, index: number): Expectation {
  const expectation = object(value, `eval ${evalId} expectation ${index}`);
  const severity = text(expectation.severity, `eval ${evalId} expectation ${index}.severity`) as Severity;
  if (!severities.has(severity)) throw new Error(`eval ${evalId} expectation ${index} has invalid severity`);
  return {
    id: identifier(expectation.id, `eval ${evalId} expectation ${index}.id`),
    text: text(expectation.text, `eval ${evalId} expectation ${index}.text`),
    severity,
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
  return {
    id,
    name: text(evalCase.name, `eval ${id}.name`),
    purpose,
    severity,
    prompt: text(evalCase.prompt, `eval ${id}.prompt`),
    fixture,
    holdout: evalCase.holdout === true,
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
    holdout: query.holdout === true,
  };
}

export function validateSuite(value: unknown): EvalSuite {
  const suite = object(value, "suite");
  if (suite.schema_version !== 1) throw new Error("suite.schema_version must be 1");
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
  return {
    schema_version: 1,
    skill_name: text(suite.skill_name, "suite.skill_name"),
    hypothesis: text(suite.hypothesis, "suite.hypothesis"),
    evals,
    trigger_queries: triggerQueries,
  };
}
