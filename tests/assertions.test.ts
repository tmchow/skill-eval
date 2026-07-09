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
});
