import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runModelGraders } from "../skills/skill-eval/scripts/lib/model-grader.ts";
import { writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import type { HostAdapter, HostRequest, HostResult } from "../skills/skill-eval/scripts/lib/types.ts";

class GraderAdapter implements HostAdapter {
  name = "codex" as const;
  prompts: string[] = [];
  async execute(request: HostRequest): Promise<HostResult> {
    this.prompts.push(request.prompt);
    const final = JSON.stringify({
      expectations: [{ id: "used-tool", status: "PASS", evidence: "events show the required tool" }],
      claims: [{ claim: "tool was used", type: "process", verified: true, evidence: "tool event" }],
      eval_feedback: [{ expectation_id: "used-tool", issue: "none" }],
    });
    await writeFile(request.eventPath, "{}"); await writeFile(request.stderrPath, ""); await writeFile(request.finalPath, final);
    return { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: final, duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: request.eventPath, stderr_path: request.stderrPath, final_path: request.finalPath };
  }
}

test("grades qualitative expectations from anonymous transcript and artifacts", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-model-grade-"));
  const executionRunDir = join(runDir, "artifacts", "runs", "attempt", "codex", "case", "authored", "run-1");
  const outputDir = join(runDir, "output"); await mkdir(outputDir); await writeFile(join(outputDir, "result.txt"), "done");
  const events = join(runDir, "events.jsonl"); await writeFile(events, `{"tool":"required","skill_path":"${join(executionRunDir, "skill")}"}\n`);
  await writeJson(join(runDir, "run.json"), { schema_version: 1, run_id: "r", run_dir: runDir, created_at: new Date().toISOString(), target_path: runDir, repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "none" }, versions: {}, hashes: { versions: {}, fixtures: {}, suite: "s" }, git: { initial_clean: false, initial_status: "", branch: null, head: null, target_tracked: false } });
  await writeJson(join(runDir, "suite.json"), { schema_version: 1, skill_name: "demo", hypothesis: "better", evals: [{ id: "case", name: "Case", purpose: "improvement", severity: "critical", prompt: "do it", expectations: [{ id: "used-tool", text: "uses the required tool", severity: "critical" }] }] });
  await writeJson(join(runDir, "executions.json"), [{ schema_version: 1, attempt_id: "attempt", partition: "training", created_at: new Date().toISOString(), host: "codex", eval_id: "case", version: "authored", repetition: 1, run_dir: executionRunDir, output_dir: outputDir, skill_path: join(executionRunDir, "skill"), skill_hash_before: null, skill_hash_after: null, source_mutated: false, host_result: { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: "done", duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: events, stderr_path: "", final_path: "" } }]);
  const adapter = new GraderAdapter();

  const results = await runModelGraders({ runDir, executionAttemptIds: ["attempt"], gradingId: "qualitative", graderHosts: ["codex"], adapters: { codex: adapter } });
  expect(results).toHaveLength(1);
  expect(results[0]?.expectations[0]?.status).toBe("PASS");
  expect(adapter.prompts[0]).toContain("GRADER CONTRACT");
  expect(adapter.prompts[0]).not.toContain("authored");
  expect(await readFile(join(results[0]!.run_dir, "input", "events.jsonl"), "utf8")).not.toContain("authored");
  expect(results[0]?.claims[0]?.verified).toBe(true);
});
