import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { containedPath, readJson, writeJson } from "./json.ts";
import { expectationAppliesTo } from "./expectations.ts";
import { loadSuite, verifyRunIntegrity } from "./workspace.ts";
import type { DeterministicCheck, EvalCase, ExecutionRecord, GradedExpectation, GradingResult } from "./types.ts";

function matches(content: string, value: string, regex = false): boolean {
  return regex ? new RegExp(value, "m").test(content) : content.includes(value);
}

function jsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  if (!pointer.startsWith("/")) throw new Error("JSON pointer must start with /");
  return pointer.slice(1).split("/").reduce<unknown>((current, token) => {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) return current[Number(key)];
    if (current && typeof current === "object") return (current as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

function invocationText(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const value = item as Record<string, any>;
  if (value.type === "tool_use") {
    const input = value.input;
    const detail = typeof input === "string"
      ? input
      : typeof input?.command === "string"
        ? input.command
        : typeof input?.cmd === "string"
          ? input.cmd
          : JSON.stringify(input ?? {});
    return `${String(value.name ?? "tool")} ${detail}`;
  }
  if (value.type === "command_execution") return `command_execution ${String(value.command ?? "")}`;
  if (value.type === "mcp_tool_call") return `mcp_tool_call ${String(value.server ?? "")} ${String(value.tool ?? value.name ?? "")} ${JSON.stringify(value.arguments ?? value.input ?? {})}`;
  if (value.type === "function_call") return `function_call ${String(value.name ?? "")} ${JSON.stringify(value.arguments ?? {})}`;
  return null;
}

async function recordedToolCalls(eventPath: string): Promise<string[]> {
  const raw = await readFile(eventPath, "utf8");
  const calls: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, any>;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const item of event.message.content) {
        const invocation = invocationText(item);
        if (invocation) calls.push(invocation);
      }
    }
    if (event.type === "item.completed") {
      const invocation = invocationText(event.item);
      if (invocation) calls.push(invocation);
    }
    if (event.type === "tool_use") {
      const invocation = invocationText(event);
      if (invocation) calls.push(invocation);
    }
  }
  return calls;
}

function resultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(resultText).join("\n");
  if (!value || typeof value !== "object") return value == null ? "" : String(value);
  const item = value as Record<string, any>;
  if (typeof item.text === "string") return item.text;
  return JSON.stringify(value);
}

async function recordedToolResults(eventPath: string): Promise<Array<{ tool: string; result: string }>> {
  const raw = await readFile(eventPath, "utf8");
  const invocations = new Map<string, string>();
  const results: Array<{ tool: string; result: string }> = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, any>;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const item of event.message.content) {
        if (item?.type === "tool_use" && typeof item.id === "string") {
          invocations.set(item.id, invocationText(item) ?? String(item.name ?? "tool"));
        }
      }
    }
    if (event.type === "user" && Array.isArray(event.message?.content)) {
      for (const item of event.message.content) {
        if (item?.type !== "tool_result") continue;
        results.push({ tool: invocations.get(String(item.tool_use_id ?? "")) ?? "tool_result", result: resultText(item.content) });
      }
    }
    if (event.type === "item.completed") {
      const tool = invocationText(event.item);
      if (!tool) continue;
      const item = event.item as Record<string, any>;
      const output = item.aggregated_output ?? item.output ?? item.result ?? item.content ?? [item.stdout, item.stderr].filter(Boolean).join("\n");
      results.push({ tool, result: resultText(output) });
    }
  }
  return results;
}

async function inspect(record: ExecutionRecord, check: DeterministicCheck): Promise<{ passed: boolean; evidence: string }> {
  if (check.type === "exit_success") {
    const passed = record.host_result.exit_code === 0 && !record.host_result.timed_out && record.host_result.malformed_events === 0 && !record.source_mutated;
    return { passed, evidence: passed ? "executor exited successfully" : `exit=${record.host_result.exit_code}, timed_out=${record.host_result.timed_out}, malformed_events=${record.host_result.malformed_events}, source_mutated=${record.source_mutated}` };
  }
  if (check.type === "final_contains" || check.type === "final_not_contains") {
    const found = matches(record.host_result.final_text, check.value, check.regex);
    const passed = check.type === "final_contains" ? found : !found;
    return { passed, evidence: `${check.type}: ${JSON.stringify(check.value)} ${found ? "was" : "was not"} present in final output` };
  }
  if (check.type === "tool_called" || check.type === "tool_not_called" || check.type === "tool_call_count") {
    if (record.host_result.malformed_events > 0) throw new Error(`tool-call trace contains ${record.host_result.malformed_events} malformed events`);
    const calls = await recordedToolCalls(record.host_result.event_path);
    const count = calls.filter((call) => matches(call, check.value, check.regex)).length;
    const passed = check.type === "tool_called" ? count > 0 : check.type === "tool_not_called" ? count === 0 : count === check.count;
    return { passed, evidence: `${count} of ${calls.length} recorded tool calls matched ${JSON.stringify(check.value)}` };
  }
  if (check.type === "tool_result_contains") {
    if (record.host_result.malformed_events > 0) throw new Error(`tool-result trace contains ${record.host_result.malformed_events} malformed events`);
    const results = await recordedToolResults(record.host_result.event_path);
    const matchingTools = results.filter((item) => matches(item.tool, check.tool, check.regex));
    const count = matchingTools.filter((item) => matches(item.result, check.value, check.regex)).length;
    return {
      passed: count > 0,
      evidence: `${count} of ${matchingTools.length} results from ${results.length} recorded tools matched tool ${JSON.stringify(check.tool)} and result ${JSON.stringify(check.value)}`,
    };
  }
  const root = check.root === "workspace" ? join(record.run_dir, "workspace") : record.output_dir;
  const rootLabel = check.root === "workspace" ? "workspace" : "output";
  const path = containedPath(root, check.path);
  let exists = true;
  try { await stat(path); } catch { exists = false; }
  if (check.type === "file_exists" || check.type === "file_not_exists") {
    const passed = check.type === "file_exists" ? exists : !exists;
    return { passed, evidence: `${rootLabel}:${check.path} ${exists ? "exists" : "does not exist"}` };
  }
  if (!exists) return { passed: false, evidence: `${rootLabel}:${check.path} does not exist` };
  const buffer = await readFile(path);
  if (buffer.includes(0)) throw new Error(`${check.path} is binary and has no configured inspector`);
  if (check.type === "file_contains" || check.type === "file_not_contains") {
    const found = matches(buffer.toString("utf8"), check.value, check.regex);
    const passed = check.type === "file_contains" ? found : !found;
    return { passed, evidence: `${rootLabel}:${check.path}: ${JSON.stringify(check.value)} ${found ? "was" : "was not"} present` };
  }
  const parsed = JSON.parse(buffer.toString("utf8"));
  const actual = jsonPointer(parsed, check.pointer);
  const passed = JSON.stringify(actual) === JSON.stringify(check.value);
  return { passed, evidence: `${rootLabel}:${check.path}${check.pointer} was ${JSON.stringify(actual)}` };
}

export async function gradeExecution(record: ExecutionRecord, evalCase: EvalCase): Promise<GradingResult> {
  const expectations: GradedExpectation[] = [];
  for (const expectation of evalCase.expectations) {
    if (!expectationAppliesTo(expectation, record.version)) continue;
    if (!expectation.check) {
      expectations.push({ ...expectation, passed: null, blocked: false, evidence: "qualitative expectation reserved for blind judges" });
      continue;
    }
    try {
      const result = await inspect(record, expectation.check);
      expectations.push({ ...expectation, passed: result.passed, blocked: false, evidence: result.evidence });
    } catch (error) {
      expectations.push({ ...expectation, passed: null, blocked: true, evidence: error instanceof Error ? error.message : String(error) });
    }
  }
  const measured = expectations.filter((item) => !item.prerequisite && item.evidence_role === "outcome");
  const prerequisites = expectations.filter((item) => item.prerequisite);
  const passed = measured.filter((item) => item.passed === true).length;
  const failed = measured.filter((item) => item.passed === false).length;
  const blocked = measured.filter((item) => item.blocked).length;
  const qualitative = measured.filter((item) => item.passed === null && !item.blocked).length;
  const graded = passed + failed;
  const runFailed = record.host_result.exit_code !== 0 || record.host_result.timed_out || record.host_result.malformed_events > 0 || record.source_mutated;
  const expectationCriticalFailures = expectations.filter((item) => item.severity === "critical" && item.passed === false).length;
  const caseCriticalFailure = evalCase.severity === "critical" && failed > 0 && expectationCriticalFailures === 0 ? 1 : 0;
  return {
    schema_version: 2,
    attempt_id: record.attempt_id,
    partition: record.partition,
    host: record.host,
    eval_id: record.eval_id,
    version: record.version,
    repetition: record.repetition,
    expectations,
    summary: {
      passed,
      failed,
      blocked,
      qualitative,
      total: measured.length,
      pass_rate: runFailed ? 0 : graded > 0 ? passed / graded : null,
      critical_failed: expectationCriticalFailures + caseCriticalFailure + (runFailed ? 1 : 0),
      critical_blocked: expectations.filter((item) => item.severity === "critical" && item.blocked).length,
      prerequisites_passed: prerequisites.filter((item) => item.passed === true).length,
      prerequisites_failed: prerequisites.filter((item) => item.passed === false).length,
      prerequisites_blocked: prerequisites.filter((item) => item.blocked).length,
      run_failed: runFailed,
    },
  };
}

export async function gradeMatrix(runDir: string): Promise<GradingResult[]> {
  await verifyRunIntegrity(runDir);
  const records = await readJson<ExecutionRecord[]>(join(runDir, "executions.json"));
  const suite = await loadSuite(runDir);
  const grades: GradingResult[] = [];
  for (const record of records) {
    const evalCase = suite.evals.find((item) => item.id === record.eval_id);
    if (!evalCase) throw new Error(`execution references missing eval: ${record.eval_id}`);
    const grade = await gradeExecution(record, evalCase);
    await writeJson(join(record.run_dir, "grading.json"), grade);
    grades.push(grade);
  }
  await writeJson(join(runDir, "gradings.json"), grades);
  return grades;
}
