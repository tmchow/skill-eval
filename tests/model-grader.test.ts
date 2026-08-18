import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runModelGraders } from "../skills/skill-eval/scripts/lib/model-grader.ts";
import { readJson, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import { readRunStatus } from "../skills/skill-eval/scripts/lib/status.ts";
import type { HostAdapter, HostRequest, HostResult } from "../skills/skill-eval/scripts/lib/types.ts";

class GraderAdapter implements HostAdapter {
  name = "codex" as const;
  prompts: string[] = [];
  response?: string;
  delayMs = 0;
  active = 0;
  maxActive = 0;
  async execute(request: HostRequest): Promise<HostResult> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    if (this.delayMs > 0) await Bun.sleep(this.delayMs);
    this.prompts.push(request.prompt);
    const final = this.response ?? JSON.stringify({
      expectations: [{ id: "used-tool", status: "PASS", evidence: "events show the required tool" }],
      claims: [{ claim: "tool was used", type: "process", verified: true, evidence: "tool event" }],
      eval_feedback: [{ expectation_id: "used-tool", issue: "none" }],
    });
    await writeFile(request.eventPath, "{}"); await writeFile(request.stderrPath, ""); await writeFile(request.finalPath, final);
    this.active -= 1;
    return { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: final, duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: request.eventPath, stderr_path: request.stderrPath, final_path: request.finalPath };
  }
}

async function fixture(): Promise<{ runDir: string; adapter: GraderAdapter }> {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-model-grade-"));
  const executionRunDir = join(runDir, "artifacts", "runs", "attempt", "codex", "case", "authored", "run-1");
  const outputDir = join(runDir, "output"); await mkdir(outputDir); await writeFile(join(outputDir, "result.txt"), "done");
  const events = join(runDir, "events.jsonl"); await writeFile(events, `{"tool":"required","skill_path":"${join(executionRunDir, "skill")}"}\n`);
  await writeJson(join(runDir, "run.json"), { schema_version: 2, run_id: "r", run_dir: runDir, created_at: new Date().toISOString(), target_path: runDir, repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "none" }, versions: {}, hashes: { versions: {}, fixtures: {}, suite: "s" }, git: { initial_clean: false, initial_status: "", branch: null, head: null, target_tracked: false } });
  await writeJson(join(runDir, "suite.json"), { schema_version: 2, claim_class: "effectiveness", environment: { fidelity: "isolated", external_state: [] }, skill_name: "demo", hypothesis: "better", evals: [{ id: "case", name: "Case", purpose: "improvement", severity: "critical", prompt: "do it", expectations: [{ id: "used-tool", text: "uses the required tool", severity: "critical", evidence_role: "outcome" }] }] });
  await writeJson(join(runDir, "executions.json"), [{ schema_version: 2, attempt_id: "attempt", partition: "training", created_at: new Date().toISOString(), host: "codex", eval_id: "case", version: "authored", repetition: 1, run_dir: executionRunDir, output_dir: outputDir, skill_path: join(executionRunDir, "skill"), skill_hash_before: null, skill_hash_after: null, source_mutated: false, host_result: { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: "done", duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: events, stderr_path: "", final_path: "" } }]);
  const adapter = new GraderAdapter();
  return { runDir, adapter };
}

test("grades qualitative expectations from anonymous transcript and artifacts", async () => {
  const { runDir, adapter } = await fixture();

  const results = await runModelGraders({ runDir, executionAttemptIds: ["attempt"], gradingId: "qualitative", graderHosts: ["codex"], adapters: { codex: adapter } });
  expect(results).toHaveLength(1);
  expect(results[0]?.expectations[0]?.status).toBe("PASS");
  expect(adapter.prompts[0]).toContain("GRADER CONTRACT");
  expect(adapter.prompts[0]).not.toContain("authored");
  expect(await readFile(join(results[0]!.run_dir, "input", "events.jsonl"), "utf8")).not.toContain("authored");
  expect(results[0]?.claims[0]?.verified).toBe(true);
  expect((await readRunStatus(runDir)).operations).toMatchObject([{
    kind: "model-grading", status: "complete", phase: "grading-executions", completed_units: 1, planned_units: 1, stop_reason: "graded",
  }]);
});

test("exposes active model grading through status", async () => {
  const { runDir, adapter } = await fixture();
  adapter.delayMs = 50;

  const grading = runModelGraders({ runDir, executionAttemptIds: ["attempt"], gradingId: "status", graderHosts: ["codex"], adapters: { codex: adapter } });
  await Bun.sleep(10);

  expect((await readRunStatus(runDir)).operations).toMatchObject([{
    kind: "model-grading", status: "active", phase: "grading-executions", planned_units: 1,
  }]);
  await grading;
});

test("fails closed on malformed grader evidence", async () => {
  const { runDir, adapter } = await fixture();
  adapter.response = JSON.stringify({ expectations: [{ id: "used-tool", status: "PASS", evidence: "ok" }, { id: "used-tool", status: "PASS", evidence: "duplicate" }], claims: [{ claim: "unsupported", type: "factual", verified: "yes", evidence: "none" }], eval_feedback: [] });

  const results = await runModelGraders({ runDir, executionAttemptIds: ["attempt"], gradingId: "malformed", graderHosts: ["codex"], adapters: { codex: adapter } });

  expect(results[0]?.valid).toBe(false);
  expect(results[0]?.claims).toEqual([]);
});

test("runs independent model graders with bounded concurrency", async () => {
  const { runDir, adapter } = await fixture();
  adapter.delayMs = 20;

  const results = await runModelGraders({ runDir, executionAttemptIds: ["attempt"], gradingId: "concurrent", graderHosts: ["codex", "claude"], adapters: { codex: adapter, claude: adapter }, concurrency: 2 });

  expect(results).toHaveLength(2);
  expect(adapter.maxActive).toBe(2);
});

test("keeps grader artifacts distinct across evaluated versions", async () => {
  const { runDir, adapter } = await fixture();
  const [authored] = await readJson<any[]>(join(runDir, "executions.json"));
  await writeJson(join(runDir, "executions.json"), [authored, { ...authored, version: "anchor", run_dir: `${authored.run_dir}-anchor` }]);

  const results = await runModelGraders({ runDir, executionAttemptIds: ["attempt"], gradingId: "versions", graderHosts: ["codex"], adapters: { codex: adapter }, concurrency: 2 });

  expect(results).toHaveLength(2);
  expect(new Set(results.map((item) => item.run_dir)).size).toBe(2);
  expect(results.map((item) => item.run_dir).sort().join("\n")).toContain("/anchor/");
  expect(results.map((item) => item.run_dir).sort().join("\n")).toContain("/authored/");
});

test("grades a candidate-scoped mechanism expectation only on non-anchor versions", async () => {
  const { runDir, adapter } = await fixture();
  const [authored] = await readJson<any[]>(join(runDir, "executions.json"));
  await writeJson(join(runDir, "executions.json"), [authored, { ...authored, version: "anchor", run_dir: `${authored.run_dir}-anchor` }]);
  const suite = await readJson<any>(join(runDir, "suite.json"));
  suite.evals[0].expectations[0].evidence_role = "mechanism";
  suite.evals[0].expectations[0].version_scope = "candidate";
  suite.evals[0].expectations.push({ id: "relative", text: "the candidate is better than baseline", severity: "quality", evidence_role: "outcome", scope: "comparison", comparison_goal: "improve" });
  await writeJson(join(runDir, "suite.json"), suite);

  const results = await runModelGraders({ runDir, executionAttemptIds: ["attempt"], gradingId: "candidate-scope", graderHosts: ["codex"], adapters: { codex: adapter } });

  expect(results).toHaveLength(1);
  expect(results[0]?.version).toBe("authored");
  expect(adapter.prompts).toHaveLength(1);
});

test("does not expose comparison-only expectations to a single-output grader", async () => {
  const { runDir, adapter } = await fixture();
  const suite = await readJson<any>(join(runDir, "suite.json"));
  suite.evals[0].expectations.push({ id: "relative", text: "coverage is no worse than baseline", severity: "quality", evidence_role: "outcome", scope: "comparison", comparison_goal: "not-worse" });
  await writeJson(join(runDir, "suite.json"), suite);

  const results = await runModelGraders({ runDir, executionAttemptIds: ["attempt"], gradingId: "scoped", graderHosts: ["codex"], adapters: { codex: adapter } });

  expect(results[0]?.valid).toBe(true);
  expect(adapter.prompts[0]).not.toContain("coverage is no worse than baseline");
});

test("skips timed-out executions instead of grading incomplete output", async () => {
  const { runDir, adapter } = await fixture();
  const [valid] = await readJson<any[]>(join(runDir, "executions.json"));
  await writeJson(join(runDir, "executions.json"), [valid, {
    ...valid, version: "anchor", run_dir: `${valid.run_dir}-timeout`,
    host_result: { ...valid.host_result, exit_code: 137, timed_out: true, final_text: "partial" },
  }]);

  const results = await runModelGraders({ runDir, executionAttemptIds: ["attempt"], gradingId: "skip-timeout", graderHosts: ["codex"], adapters: { codex: adapter } });
  const manifest = await readJson<any>(join(runDir, "artifacts", "model-graders", "skip-timeout", "grading-attempt.json"));

  expect(results).toHaveLength(1);
  expect(adapter.prompts).toHaveLength(1);
  expect(manifest.skipped_executions).toMatchObject([{ version: "anchor", reason: "executor timed out" }]);
});

test("rejects direct grading when every qualitative expectation is comparison-only", async () => {
  const { runDir, adapter } = await fixture();
  const suite = await readJson<any>(join(runDir, "suite.json"));
  suite.evals[0].expectations = [{ id: "relative", text: "coverage is no worse than baseline", severity: "quality", evidence_role: "outcome", scope: "comparison", comparison_goal: "not-worse" }];
  await writeJson(join(runDir, "suite.json"), suite);

  await expect(runModelGraders({ runDir, executionAttemptIds: ["attempt"], gradingId: "comparison-only", graderHosts: ["codex"], adapters: { codex: adapter } })).rejects.toThrow("execution-scoped qualitative expectation");
  expect(adapter.prompts).toHaveLength(0);
});
