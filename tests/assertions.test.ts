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
  await mkdir(join(root, "workspace"));
  await writeFile(join(outputs, "result.txt"), "status: ready\n");
  await writeFile(join(outputs, "data.json"), '{"items":[{"name":"alpha"}]}');
  await writeFile(join(root, "workspace", "workspace-state.json"), '{"threads":{"T2":{"verdict":"needs-human","resolved":false}}}');
  await writeFile(join(root, "events.jsonl"), [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "/plugin/cross-model-doc-review.sh" } }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "peer-1", name: "Bash", input: { command: "bash \"/plugin/cross-model-doc-review.sh\" \"codex\" \"adversarial\"" } }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "peer-1", content: "[cross-model-doc] wrote 3 finding(s) to /tmp/findings.json" }] } }),
    JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "printf done", aggregated_output: "done" } }),
  ].join("\n"));
  return {
    schema_version: 2, attempt_id: "attempt", partition: "training", created_at: new Date().toISOString(), host: "codex", eval_id: "case", version: "authored", repetition: 1,
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
    { id: "exists", text: "result exists", severity: "critical", evidence_role: "outcome", check: { type: "file_exists", path: "result.txt" } },
    { id: "contains", text: "result is ready", severity: "critical", evidence_role: "outcome", check: { type: "file_contains", path: "result.txt", value: "status: ready" } },
    { id: "json", text: "first item is alpha", severity: "quality", evidence_role: "outcome", check: { type: "json_pointer_equals", path: "data.json", pointer: "/items/0/name", value: "alpha" } },
    { id: "final", text: "final says completed", severity: "quality", evidence_role: "outcome", check: { type: "final_contains", value: "Completed" } },
    { id: "qualitative", text: "output is useful", severity: "quality", evidence_role: "outcome" },
  ],
};

describe("deterministic grading", () => {
  test("grades inspectable artifacts and leaves qualitative expectations to judges", async () => {
    const result = await gradeExecution(await execution(), evalCase);
    expect(result.summary.passed).toBe(4);
    expect(result.summary.qualitative).toBe(1);
    expect(result.summary.pass_rate).toBe(1);
  });

  test("grades workspace-relative files and structured side effects", async () => {
    const record = await execution();
    const result = await gradeExecution(record, {
      ...evalCase,
      expectations: [
        { id: "workspace", text: "state exists", severity: "critical", evidence_role: "outcome", check: { type: "file_exists", root: "workspace", path: "workspace-state.json" } },
        { id: "verdict", text: "T2 needs a human", severity: "critical", evidence_role: "outcome", check: { type: "json_pointer_equals", root: "workspace", path: "workspace-state.json", pointer: "/threads/T2/verdict", value: "needs-human" } },
        { id: "open", text: "T2 remains open", severity: "critical", evidence_role: "outcome", check: { type: "json_pointer_equals", root: "workspace", path: "workspace-state.json", pointer: "/threads/T2/resolved", value: false } },
      ],
    });
    expect(result.summary.passed).toBe(3);
    expect(result.expectations[0]?.evidence).toContain("workspace:");
  });

  test("fails closed when evidence is missing", async () => {
    const record = await execution();
    const result = await gradeExecution(record, {
      ...evalCase,
      expectations: [{ id: "missing", text: "missing file", severity: "critical", evidence_role: "outcome", check: { type: "file_contains", path: "missing.txt", value: "x" } }],
    });
    expect(result.summary.failed).toBe(1);
    expect(result.summary.critical_failed).toBe(1);
  });

  test("blocks paths that escape the output directory", async () => {
    const record = await execution();
    const result = await gradeExecution(record, {
      ...evalCase,
      expectations: [{ id: "escape", text: "read outside", severity: "critical", evidence_role: "outcome", check: { type: "file_exists", path: "../secret" } }],
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
        { id: "called", text: "cross-model reviewer launched", severity: "critical", evidence_role: "outcome", check: { type: "tool_called", value: "cross-model-doc-review.sh" } },
        { id: "not-called", text: "security peer was not launched", severity: "critical", evidence_role: "outcome", check: { type: "tool_not_called", value: "security-lens" } },
        { id: "once", text: "adversarial peer launched once", severity: "critical", evidence_role: "outcome", check: { type: "tool_call_count", value: "adversarial", count: 1 } },
      ],
    });

    expect(result.summary.passed).toBe(3);
    expect(result.summary.critical_failed).toBe(0);
    expect(result.expectations[0]?.evidence).toContain("tool calls");
  });

  test("command-specific regexes distinguish execution from reading the same script", async () => {
    const record = await execution();
    const invocation = 'cross-model-doc-review\\.sh"? "?(codex|claude)';
    const result = await gradeExecution(record, {
      ...evalCase,
      expectations: [
        { id: "called", text: "peer script executed once", severity: "critical", evidence_role: "outcome", check: { type: "tool_call_count", value: invocation, count: 1, regex: true } },
        { id: "completed", text: "peer returned a valid result", severity: "critical", evidence_role: "outcome", check: { type: "tool_result_contains", tool: invocation, value: "wrote [0-9]+ finding", regex: true } },
      ],
    });

    expect(result.summary).toMatchObject({ passed: 2, failed: 0, critical_failed: 0 });
  });

  test("grades a tool result separately from the invocation text", async () => {
    const record = await execution();
    const result = await gradeExecution(record, {
      ...evalCase,
      expectations: [
        {
          id: "peer-result",
          text: "cross-model peer produced usable findings",
          severity: "critical", evidence_role: "outcome",
          check: { type: "tool_result_contains", tool: "cross-model-doc-review.sh", value: "wrote 3 finding(s)" },
        },
        {
          id: "not-in-result",
          text: "invocation text alone is not result evidence",
          severity: "quality", evidence_role: "outcome",
          check: { type: "tool_result_contains", tool: "cross-model-doc-review.sh", value: "codex adversarial" },
        },
      ],
    });

    expect(result.expectations[0]?.passed).toBe(true);
    expect(result.expectations[1]?.passed).toBe(false);
  });

  test("applies candidate prerequisites without biasing measured pass rates", async () => {
    const record = await execution();
    const scopedCase: EvalCase = {
      ...evalCase,
      expectations: [
        { id: "normal", text: "result exists", severity: "quality", evidence_role: "outcome", check: { type: "file_exists", path: "result.txt" } },
        {
          id: "peer-ready",
          text: "candidate peer produced output",
          severity: "critical", evidence_role: "mechanism",
          version_scope: "candidate",
          prerequisite: true,
          check: { type: "tool_result_contains", tool: "cross-model-doc-review.sh", value: "wrote 3 finding(s)" },
        },
      ],
    };

    const authored = await gradeExecution(record, scopedCase);
    expect(authored.summary).toMatchObject({ passed: 1, total: 1, pass_rate: 1, prerequisites_passed: 1, prerequisites_failed: 0 });
    expect(authored.expectations.map((item) => item.id)).toEqual(["normal", "peer-ready"]);

    record.version = "anchor";
    const anchor = await gradeExecution(record, scopedCase);
    expect(anchor.expectations.map((item) => item.id)).toEqual(["normal"]);
    expect(anchor.summary).toMatchObject({ passed: 1, total: 1, pass_rate: 1, prerequisites_passed: 0 });
  });

  test("keeps non-prerequisite mechanisms out of grading pass rates", async () => {
    const result = await gradeExecution(await execution(), {
      ...evalCase,
      expectations: [
        { id: "outcome", text: "result exists", severity: "quality", evidence_role: "outcome", check: { type: "file_exists", path: "result.txt" } },
        { id: "mechanism", text: "peer ran", severity: "quality", evidence_role: "mechanism", check: { type: "tool_called", value: "cross-model-doc-review.sh" } },
      ],
    });
    expect(result.expectations).toHaveLength(2);
    expect(result.summary).toMatchObject({ passed: 1, total: 1, pass_rate: 1 });
  });

  test("fails the run when host event evidence is malformed even if artifacts exist", async () => {
    const record = await execution();
    record.host_result.malformed_events = 1;
    const result = await gradeExecution(record, {
      ...evalCase,
      expectations: [
        { id: "exists", text: "result exists", severity: "critical", evidence_role: "outcome", check: { type: "file_exists", path: "result.txt" } },
        { id: "exit", text: "executor evidence is valid", severity: "critical", evidence_role: "outcome", check: { type: "exit_success" } },
      ],
    });

    expect(result.summary.run_failed).toBe(true);
    expect(result.summary.critical_failed).toBeGreaterThan(0);
    expect(result.expectations.find((item) => item.id === "exit")?.passed).toBe(false);
  });

  test("fails the run when execution used a same-name installed skill", async () => {
    const record = await execution();
    record.wrong_skill_source = true;
    const result = await gradeExecution(record, {
      ...evalCase,
      expectations: [{ id: "exit", text: "executor used the frozen source", severity: "critical", evidence_role: "outcome", check: { type: "exit_success" } }],
    });

    expect(result.summary.run_failed).toBe(true);
    expect(result.expectations[0]?.passed).toBe(false);
    expect(result.expectations[0]?.evidence).toContain("wrong_skill_source=true");
  });
});
