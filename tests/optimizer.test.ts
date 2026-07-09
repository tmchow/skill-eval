import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { certifyCandidate, optimizeBehavior, runOptimizationLoop } from "../skills/skill-eval/scripts/lib/optimizer.ts";
import { hashTree, readJson, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import type { HostAdapter, HostRequest, HostResult, RunState } from "../skills/skill-eval/scripts/lib/types.ts";

class CertificationAdapter implements HostAdapter {
  name = "codex" as const;
  calls = 0;
  revisionPrompts: string[] = [];

  async execute(request: HostRequest): Promise<HostResult> {
    this.calls += 1;
    let final = "done";
    if (request.prompt.startsWith("Revise the isolated skill at ")) {
      this.revisionPrompts.push(request.prompt);
      const candidatePath = request.prompt.match(/^Revise the isolated skill at (.+)\. Apply/m)?.[1];
      if (!candidatePath) throw new Error("missing candidate path");
      await writeFile(join(candidatePath, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\nGOOD\n");
      final = JSON.stringify({ summary: "fixed" });
    } else if (request.prompt.includes("COMPARATOR CONTRACT")) {
      final = JSON.stringify({ winner: "TIE", reasoning: "objective artifacts decide", rubric: { A: { overall: 5 }, B: { overall: 5 } }, strengths: { A: [], B: [] }, weaknesses: { A: ["needs stronger instructions"], B: ["needs stronger instructions"] } });
    } else {
      const skillPath = request.prompt.match(/Exact skill snapshot: (.+)/)?.[1];
      const good = skillPath ? (await readFile(join(skillPath, "SKILL.md"), "utf8")).includes("GOOD") : false;
      await writeFile(join(request.cwd, "outputs", "result.txt"), good ? "good\n" : "bad\n");
    }
    await writeFile(request.eventPath, '{"type":"turn.completed"}\n');
    await writeFile(request.stderrPath, "");
    await writeFile(request.finalPath, final);
    return { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: final, duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, cost_usd: 0.001 }, event_path: request.eventPath, stderr_path: request.stderrPath, final_path: request.finalPath };
  }
}

test("runs a resumable five-pass behavior loop without exposing holdout evidence", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-optimize-"));
  const revisionInputs: any[] = [];
  const progress: any[] = [];
  let evaluations = 0;
  const result = await runOptimizationLoop({
    runDir, initialIncumbent: "authored", maxRevisions: 5, initialTrainingFeedback: ["fallback fails"],
    revise: async (request) => { revisionInputs.push(request); return `challenger-${request.iteration}`; },
    evaluate: async ({ candidate, iteration }) => {
      evaluations += 1;
      return { candidate, accepted: iteration === 2, converged: iteration === 2, decision_id: iteration === 2 ? "decision-2" : null, training_feedback: iteration === 1 ? ["explicit opt-in regressed"] : [], summary: iteration === 1 ? "fallback fixed; opt-in regressed" : "all critical gates pass" };
    },
    onProgress: (event) => { progress.push(event); },
  });
  expect(result.status).toBe("converged");
  expect(result.incumbent).toBe("challenger-2");
  expect(evaluations).toBe(2);
  expect(JSON.stringify(revisionInputs)).not.toContain("holdout");
  expect(progress.map((event) => event.iteration)).toEqual([1, 2]);

  const resumed = await runOptimizationLoop({
    runDir, initialIncumbent: "authored", maxRevisions: 5, initialTrainingFeedback: [],
    revise: async () => { throw new Error("must not revise a converged run"); },
    evaluate: async () => { throw new Error("must not evaluate a converged run"); },
  });
  expect(resumed.status).toBe("converged");
});

test("stops after five challengers even when revisions keep changing", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-optimize-limit-"));
  const result = await runOptimizationLoop({
    runDir, initialIncumbent: "authored", maxRevisions: 9, initialTrainingFeedback: [],
    revise: async ({ iteration }) => `challenger-${iteration}`,
    evaluate: async ({ candidate }) => ({ candidate, accepted: true, converged: false, decision_id: `decision-${candidate}`, training_feedback: ["still changing"], summary: "improved but not converged" }),
  });
  expect(result.status).toBe("max-revisions");
  expect(result.iterations).toHaveLength(5);
});

test("certifies a complete candidate and resumes without repeating model calls", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-certify-"));
  const now = new Date().toISOString();
  const anchor = join(runDir, "versions", "anchor"); const authored = join(runDir, "versions", "authored");
  await mkdir(anchor, { recursive: true }); await mkdir(authored, { recursive: true });
  await writeFile(join(anchor, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\nBAD\n");
  await writeFile(join(authored, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\nGOOD\n");
  const state: RunState = { schema_version: 1, run_id: "run", run_dir: runDir, created_at: now, target_path: authored, repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" }, versions: { anchor: { path: anchor, parent: null, created_at: now }, authored: { path: authored, parent: null, created_at: now } }, hashes: { versions: { anchor: await hashTree(anchor), authored: await hashTree(authored) }, fixtures: {}, suite: "suite" }, git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true } };
  await writeJson(join(runDir, "run.json"), state);
  await writeJson(join(runDir, "suite.json"), { schema_version: 1, skill_name: "demo", hypothesis: "candidate creates the required result", evals: [
    { id: "training", name: "Training", purpose: "improvement", severity: "critical", prompt: "create result", expectations: [{ id: "result", text: "result is good", severity: "critical", check: { type: "file_contains", path: "result.txt", value: "good" } }] },
    { id: "holdout", name: "Holdout", purpose: "regression", severity: "critical", prompt: "create variant result", holdout: true, expectations: [{ id: "result", text: "result is good", severity: "critical", check: { type: "file_contains", path: "result.txt", value: "good" } }] },
  ] });
  const adapter = new CertificationAdapter();
  const options = { runDir, candidate: "authored", incumbent: "anchor", label: "full", hosts: ["codex" as const], judgeHosts: ["codex" as const], repetitions: 1, adapters: { codex: adapter } };
  await mkdir(join(runDir, "artifacts", "runs", "full-training"), { recursive: true });
  await writeJson(join(runDir, "artifacts", "runs", "full-training", "attempt.json"), { schema_version: 1, attempt_id: "full-training", status: "started", planned_records: 4 });

  const result = await certifyCandidate(options);
  expect(result.accepted).toBe(true);
  expect(result.converged).toBe(true);
  expect(result.decision_id).toBe("full-decision");
  const calls = adapter.calls;
  const resumed = await certifyCandidate(options);
  expect(resumed.decision_id).toBe("full-decision");
  expect(adapter.calls).toBe(calls);
  expect((await readJson<any[]>(join(runDir, "executions.json"))).length).toBe(4);
  expect((await readJson<any[]>(join(runDir, "executions.json"))).some((item) => item.attempt_id === "full-training-retry-2")).toBe(true);
});

test("uses current-host skill-creator guidance in the automatic revision loop", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-optimize-concrete-"));
  const now = new Date().toISOString();
  const anchor = join(runDir, "versions", "anchor"); const authored = join(runDir, "versions", "authored");
  await mkdir(anchor, { recursive: true }); await mkdir(authored, { recursive: true });
  const badSkill = "---\nname: demo\ndescription: Use when testing.\n---\nBAD\n";
  await writeFile(join(anchor, "SKILL.md"), badSkill); await writeFile(join(authored, "SKILL.md"), badSkill);
  const state: RunState = { schema_version: 1, run_id: "run", run_dir: runDir, created_at: now, target_path: authored, repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" }, versions: { anchor: { path: anchor, parent: null, created_at: now }, authored: { path: authored, parent: null, created_at: now } }, hashes: { versions: { anchor: await hashTree(anchor), authored: await hashTree(authored) }, fixtures: {}, suite: "suite" }, git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true } };
  await writeJson(join(runDir, "run.json"), state);
  await writeJson(join(runDir, "suite.json"), { schema_version: 1, skill_name: "demo", hypothesis: "candidate creates the required result", evals: [
    { id: "training", name: "Training", purpose: "improvement", severity: "critical", prompt: "create result", expectations: [{ id: "result", text: "result is good", severity: "critical", check: { type: "file_contains", path: "result.txt", value: "good" } }] },
    { id: "holdout", name: "Holdout", purpose: "regression", severity: "critical", prompt: "create variant result", holdout: true, expectations: [{ id: "result", text: "result is good", severity: "critical", check: { type: "file_contains", path: "result.txt", value: "good" } }] },
  ] });
  const creator = join(runDir, "skill-creator"); await mkdir(creator); await writeFile(join(creator, "SKILL.md"), "CURRENT HOST CREATOR CONTRACT");
  const adapter = new CertificationAdapter();

  const result = await optimizeBehavior({ runDir, hosts: ["codex"], judgeHosts: ["codex"], reviserHost: "codex", repetitions: 1, maxRevisions: 1, adapters: { codex: adapter }, skillCreatorPath: creator });
  expect(result.status).toBe("converged");
  expect(result.incumbent).toBe("challenger-1");
  expect(adapter.revisionPrompts).toHaveLength(1);
  expect(adapter.revisionPrompts[0]).toContain("CURRENT HOST CREATOR CONTRACT");
  expect(adapter.revisionPrompts[0]).toContain("comparator weakness - needs stronger instructions");
});
