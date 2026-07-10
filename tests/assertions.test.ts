import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gradeExecution } from "../skills/skill-eval/scripts/lib/assertions.ts";
import type { EvalCase, ExecutionRecord } from "../skills/skill-eval/scripts/lib/types.ts";

async function execution(): Promise<ExecutionRecord> {
  const root = await mkdtemp(join(tmpdir(), "skill-eval-grade-"));
  const outputs = join(root, "outputs");
  await mkdir(outputs);
  await writeFile(join(outputs, "result.txt"), "status: ready\n");
  await writeFile(join(outputs, "data.json"), '{"items":[{"name":"alpha"}]}');
  await writeFile(join(root, "events.jsonl"), [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "bash /plugin/cross-model-doc-review.sh codex adversarial" } }] } }),
    JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "printf done" } }),
  ].join("\n"));
  return {
    schema_version: 1, attempt_id: "attempt", partition: "training", created_at: new Date().toISOString(), host: "codex", eval_id: "case", version: "authored", repetition: 1,
    run_dir: root, output_dir: outputs, skill_path: null, skill_hash_before: null, skill_hash_after: null, source_mutated: false,
    host_result: {
      host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: "Completed safely", duration_ms: 1,
      usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null },
      event_path: join(root, "events.jsonl"), stderr_path: join(root, "stderr"), final_path: join(root, "final.md"),
    },
  };
}

const evalCase: EvalCase = {
  id: "case", name: "Case", purpose: "improvement", severity: "critical", prompt: "task", expectations: [
    { id: "exists", text: "result exists", severity: "critical", check: { type: "file_exists", path: "result.txt" } },
    { id: "contains", text: "result is ready", severity: "critical", check: { type: "file_contains", path: "result.txt", value: "status: ready" } },
    { id: "json", text: "first item is alpha", severity: "quality", check: { type: "json_pointer_equals", path: "data.json", pointer: "/items/0/name", value: "alpha" } },
    { id: "final", text: "final says completed", severity: "quality", check: { type: "final_contains", value: "Completed" } },
    { id: "qualitative", text: "output is useful", severity: "quality" },
  ],
};

describe("deterministic grading", () => {
  test("grades inspectable artifacts and leaves qualitative expectations to judges", async () => {
    const result = await gradeExecution(await execution(), evalCase);
    expect(result.summary.passed).toBe(4);
    expect(result.summary.qualitative).toBe(1);
    expect(result.summary.pass_rate).toBe(1);
  });

  test("fails closed when evidence is missing", async () => {
    const record = await execution();
    const result = await gradeExecution(record, {
      ...evalCase,
      expectations: [{ id: "missing", text: "missing file", severity: "critical", check: { type: "file_contains", path: "missing.txt", value: "x" } }],
    });
    expect(result.summary.failed).toBe(1);
    expect(result.summary.critical_failed).toBe(1);
  });

  test("blocks paths that escape the output directory", async () => {
    const record = await execution();
    const result = await gradeExecution(record, {
      ...evalCase,
      expectations: [{ id: "escape", text: "read outside", severity: "critical", check: { type: "file_exists", path: "../secret" } }],
    });
    expect(result.expectations[0]?.blocked).toBe(true);
    expect(result.expectations[0]?.passed).toBeNull();
    expect(result.summary.critical_blocked).toBe(1);
  });

  test("grades tool invocations from host event traces without matching prompt text", async () => {
    const record = await execution();
    const result = await gradeExecution(record, {
      ...evalCase,
      expectations: [
        { id: "called", text: "cross-model reviewer launched", severity: "critical", check: { type: "tool_called", value: "cross-model-doc-review.sh" } },
        { id: "not-called", text: "security peer was not launched", severity: "critical", check: { type: "tool_not_called", value: "security-lens" } },
        { id: "once", text: "adversarial peer launched once", severity: "critical", check: { type: "tool_call_count", value: "adversarial", count: 1 } },
      ],
    });

    expect(result.summary.passed).toBe(3);
    expect(result.summary.critical_failed).toBe(0);
    expect(result.expectations[0]?.evidence).toContain("tool calls");
  });

  test("fails the run when host event evidence is malformed even if artifacts exist", async () => {
    const record = await execution();
    record.host_result.malformed_events = 1;
    const result = await gradeExecution(record, {
      ...evalCase,
      expectations: [
        { id: "exists", text: "result exists", severity: "critical", check: { type: "file_exists", path: "result.txt" } },
        { id: "exit", text: "executor evidence is valid", severity: "critical", check: { type: "exit_success" } },
      ],
    });

    expect(result.summary.run_failed).toBe(true);
    expect(result.summary.critical_failed).toBeGreaterThan(0);
    expect(result.expectations.find((item) => item.id === "exit")?.passed).toBe(false);
  });
});
