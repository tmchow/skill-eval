import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOperation, instrumentAdapters } from "../skills/skill-eval/scripts/lib/operations.ts";
import { readRunStatus, waitForRun } from "../skills/skill-eval/scripts/lib/status.ts";
import type { HostAdapter, HostRequest, HostResult } from "../skills/skill-eval/scripts/lib/types.ts";

class CountingAdapter implements HostAdapter {
  name = "codex" as const;
  calls = 0;

  async execute(request: HostRequest): Promise<HostResult> {
    this.calls += 1;
    await mkdir(request.cwd, { recursive: true });
    await writeFile(request.eventPath, "");
    await writeFile(request.stderrPath, "");
    await writeFile(request.finalPath, "done");
    return {
      host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: "done", duration_ms: 12,
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5, cost_usd: 0.01 },
      event_path: request.eventPath, stderr_path: request.stderrPath, final_path: request.finalPath,
    };
  }
}

test("status reports active non-behavior operations and measured usage", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-operation-"));
  const operation = await createOperation(runDir, {
    kind: "description-optimization",
    phase: "training triggers",
    planned_units: 4,
    limits: { max_model_calls: 3, max_elapsed_ms: 60_000 },
  });
  const adapter = new CountingAdapter();
  const wrapped = instrumentAdapters({ codex: adapter }, operation);
  const cwd = join(runDir, "call");
  await wrapped.codex!.execute({ cwd, prompt: "test", eventPath: join(cwd, "events"), stderrPath: join(cwd, "stderr"), finalPath: join(cwd, "final"), timeoutMs: 5_000 });

  const status = await readRunStatus(runDir);
  expect(status.status).toBe("running");
  expect(status.operations).toMatchObject([{
    kind: "description-optimization",
    status: "active",
    phase: "training triggers",
    completed_units: 1,
    planned_units: 4,
    usage: { model_calls: 1, total_tokens: 5 },
  }]);
});

test("instrumented adapters enforce an exact model-call ceiling", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-operation-budget-"));
  const operation = await createOperation(runDir, { kind: "trigger", phase: "running", limits: { max_model_calls: 1 } });
  const adapter = new CountingAdapter();
  const wrapped = instrumentAdapters({ codex: adapter }, operation);
  const request = (id: number): HostRequest => {
    const cwd = join(runDir, `call-${id}`);
    return { cwd, prompt: "test", eventPath: join(cwd, "events"), stderrPath: join(cwd, "stderr"), finalPath: join(cwd, "final"), timeoutMs: 5_000 };
  };

  await wrapped.codex!.execute(request(1));
  await expect(wrapped.codex!.execute(request(2))).rejects.toThrow("model-call limit reached");
  expect(adapter.calls).toBe(1);
});

test("wait returns when a long-running operation completes", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-operation-wait-"));
  const operation = await createOperation(runDir, { kind: "description-optimization", phase: "evaluating" });
  setTimeout(() => { void operation.complete("converged"); }, 20);

  const status = await waitForRun(runDir, { pollMs: 5, timeoutMs: 1_000 });
  expect(status.status).toBe("complete");
  expect(status.operations[0]?.stop_reason).toBe("converged");
});

test("instrumented adapters open a circuit after three host timeouts", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-operation-circuit-"));
  const operation = await createOperation(runDir, { kind: "behavior-optimization", phase: "evaluating" });
  const adapter = new CountingAdapter();
  adapter.execute = async (request) => {
    adapter.calls += 1;
    return {
      host: "codex", exit_code: 124, timed_out: true, malformed_events: 0, final_text: "", duration_ms: 1,
      usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null },
      event_path: request.eventPath, stderr_path: request.stderrPath, final_path: request.finalPath,
    };
  };
  const wrapped = instrumentAdapters({ codex: adapter }, operation);
  const request: HostRequest = { cwd: runDir, prompt: "test", eventPath: join(runDir, "events"), stderrPath: join(runDir, "stderr"), finalPath: join(runDir, "final"), timeoutMs: 5_000 };

  for (let attempt = 0; attempt < 3; attempt += 1) await wrapped.codex!.execute(request);
  await expect(wrapped.codex!.execute(request)).rejects.toThrow("host failure circuit open");
  expect(adapter.calls).toBe(3);
});
