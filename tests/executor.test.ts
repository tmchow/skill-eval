import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMatrix } from "../skills/skill-eval/scripts/lib/executor.ts";
import { hashTree, readJson, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import type { HostAdapter, HostRequest, HostResult, RunState } from "../skills/skill-eval/scripts/lib/types.ts";

class FakeAdapter implements HostAdapter {
  name = "codex" as const;
  prompts: string[] = [];
  requests: HostRequest[] = [];
  mutateSkill = false;
  mutateTargetPath: string | null = null;
  wrongSkillPath: string | null = null;
  failOnCall: number | null = null;

  async execute(request: HostRequest): Promise<HostResult> {
    if (this.failOnCall === this.requests.length + 1) throw new Error("simulated interruption");
    this.prompts.push(request.prompt);
    this.requests.push(request);
    const skillMatch = request.prompt.match(/Exact skill snapshot: (.+)/);
    if (this.mutateSkill && skillMatch) await writeFile(join(skillMatch[1]!, "MUTATED"), "bad");
    if (this.mutateTargetPath) await writeFile(join(this.mutateTargetPath, "LIVE-MUTATION"), "bad");
    await writeFile(request.eventPath, this.wrongSkillPath
      ? `${JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: `cat ${this.wrongSkillPath}` } })}\n`
      : '{"type":"turn.completed"}\n');
    await writeFile(request.stderrPath, "");
    await writeFile(request.finalPath, "completed");
    await writeFile(join(request.cwd, "outputs", "result.txt"), "ok\n");
    return {
      host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: "completed",
      duration_ms: 5, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, cost_usd: null },
      event_path: request.eventPath, stderr_path: request.stderrPath, final_path: request.finalPath,
    };
  }
}

async function preparedRun(): Promise<{ runDir: string; adapter: FakeAdapter }> {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-executor-"));
  const authored = join(runDir, "versions", "authored");
  const anchor = join(runDir, "versions", "anchor");
  await mkdir(authored, { recursive: true });
  await mkdir(anchor, { recursive: true });
  await mkdir(join(runDir, "fixtures", "case"), { recursive: true });
  await mkdir(join(runDir, "fixtures", "case", "bin"), { recursive: true });
  await writeFile(join(authored, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n# Authored\n");
  await writeFile(join(anchor, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n# Anchor\n");
  await writeFile(join(runDir, "fixtures", "case", "input.txt"), "fixture\n");
  const initialized = Bun.spawnSync(["git", "init", join(runDir, "fixtures", "case")], { stdout: "ignore", stderr: "pipe" });
  if (initialized.exitCode !== 0) throw new Error(initialized.stderr.toString());
  await writeFile(join(runDir, "fixtures", "case", "bin", "codex"), "#!/bin/sh\nprintf fake-peer\n");
  await chmod(join(runDir, "fixtures", "case", "bin", "codex"), 0o755);
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 2, claim_class: "generalization", environment: { fidelity: "isolated", external_state: [] }, skill_name: "demo", hypothesis: "better", evals: [{
      id: "case", name: "Case", purpose: "improvement", severity: "critical", prompt: "Do the thing.", fixture: "fixture",
      expectations: [{ id: "result", text: "result exists", severity: "critical", evidence_role: "outcome", check: { type: "file_exists", path: "result.txt" } }],
    }, {
      id: "validation", name: "Validation", purpose: "regression", severity: "critical", prompt: "Do the validation thing.", validation: true,
      expectations: [{ id: "result", text: "result exists", severity: "critical", evidence_role: "outcome", check: { type: "file_exists", path: "result.txt" } }],
    }],
  });
  const now = new Date().toISOString();
  const state: RunState = {
    schema_version: 2, run_id: "run", run_dir: runDir, created_at: now, target_path: authored, repo_root: runDir,
    skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" },
    versions: { anchor: { path: anchor, parent: null, created_at: now }, authored: { path: authored, parent: null, created_at: now } },
    hashes: { versions: { anchor: await hashTree(anchor), authored: await hashTree(authored) }, fixtures: { case: await hashTree(join(runDir, "fixtures", "case")) }, suite: "suite" },
    git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true },
  };
  await writeJson(join(runDir, "run.json"), state);
  await writeJson(join(runDir, "artifacts", "suite-critique-latest.json"), {
    critique_dir: join(runDir, "artifacts", "suite-critiques", "test"),
    results: [{ schema_version: 2, critic_host: "codex", verdict: "PASS", reasoning: "fixture", issues: [], valid: true, created_at: now }],
  });
  return { runDir, adapter: new FakeAdapter() };
}

describe("matrix execution", () => {
  test("uses fresh fixtures and exact version paths for every arm", async () => {
    const { runDir, adapter } = await preparedRun();
    const records = await runMatrix({ runDir, versions: ["anchor", "authored"], hosts: ["codex"], repetitions: 1, timeoutMs: 1_000, adapters: { codex: adapter } });

    expect(records).toHaveLength(2);
    expect(adapter.prompts[0]).toContain("Exact skill snapshot:");
    expect(adapter.prompts[0]).toContain("Do not invoke a same-name installed skill");
    expect(adapter.prompts[0]).not.toBe(adapter.prompts[1]);
    expect(await readFile(join(records[0]!.run_dir, "workspace", "input.txt"), "utf8")).toBe("fixture\n");
    expect(records.every((record) => !record.source_mutated)).toBe(true);
    expect(adapter.requests.every((request) => request.contextMode === "isolated")).toBe(true);
  });

  test("passes declared environment fidelity to the host adapter", async () => {
    const { runDir, adapter } = await preparedRun();
    const suite = await readJson<any>(join(runDir, "suite.json"));
    suite.environment.fidelity = "project-context";
    await writeJson(join(runDir, "suite.json"), suite);

    await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], repetitions: 1, timeoutMs: 1_000, adapters: { codex: adapter }, attemptId: "project-context" });

    expect(adapter.requests[0]?.contextMode).toBe("project-context");
  });

  test("persists the effective behavior runtime profile with each execution", async () => {
    const { runDir, adapter } = await preparedRun();
    const [record] = await runMatrix({
      runDir,
      versions: ["authored"],
      hosts: ["codex"],
      repetitions: 1,
      adapters: { codex: adapter },
      models: { codex: "codex-floor" },
      reasoningEfforts: { codex: "medium" },
      attemptId: "runtime-profile",
    });

    expect(record?.runtime_profile).toEqual({
      role: "behavior",
      host: "codex",
      model: "codex-floor",
      reasoning_effort: "medium",
      context_mode: "isolated",
      capabilities: ["skill-source-injection", "artifact-write"],
    });
  });

  test("blocks non-conformance execution without a passing suite critique", async () => {
    const { runDir, adapter } = await preparedRun();
    await rm(join(runDir, "artifacts", "suite-critique-latest.json"));
    await expect(runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], partition: "training", adapters: { codex: adapter } })).rejects.toThrow("suite critique");
    expect(adapter.requests).toHaveLength(0);
  });

  test("passes an explicitly declared git-write capability to the host adapter", async () => {
    const { runDir, adapter } = await preparedRun();
    const suite = await readJson<any>(join(runDir, "suite.json"));
    suite.environment.capabilities = ["git-write"];
    suite.evals[1].fixture = "fixture";
    await writeJson(join(runDir, "suite.json"), suite);

    await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], repetitions: 1, timeoutMs: 1_000, adapters: { codex: adapter }, attemptId: "git-write", partition: "training" });

    expect(adapter.requests[0]?.env?.GIT_DIR).toContain(".skill-eval-git");
    expect(adapter.requests[0]?.env?.GIT_WORK_TREE).toBe(adapter.requests[0]?.cwd);
    expect(await Bun.file(join(adapter.requests[0]!.cwd, ".git")).exists()).toBe(false);
    expect((await stat(join(adapter.requests[0]!.cwd, ".skill-eval-git"))).isDirectory()).toBe(true);
  });

  test("fails evidence that reads an installed same-name skill", async () => {
    const { runDir, adapter } = await preparedRun();
    adapter.wrongSkillPath = "/Users/test/.agents/skills/demo/SKILL.md";

    const [record] = await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], repetitions: 1, timeoutMs: 1_000, adapters: { codex: adapter }, attemptId: "wrong-source" });

    expect(record?.wrong_skill_source).toBe(true);
    expect(record?.host_result.exit_code).toBe(88);
  });

  test("fails tool-only installed skill invocation, including a no-skill baseline", async () => {
    const { runDir, adapter } = await preparedRun();
    adapter.wrongSkillPath = null;
    adapter.execute = async (request: HostRequest): Promise<HostResult> => {
      adapter.requests.push(request);
      await writeFile(request.eventPath, `${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "plugin:demo" } }] } })}\n`);
      await writeFile(request.stderrPath, ""); await writeFile(request.finalPath, "completed");
      return { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: "completed", duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: request.eventPath, stderr_path: request.stderrPath, final_path: request.finalPath };
    };
    const state = await readJson<RunState>(join(runDir, "run.json"));
    state.anchor = { kind: "none" };
    delete state.versions.anchor;
    state.hashes.versions.anchor = null;
    await writeJson(join(runDir, "run.json"), state);

    const [record] = await runMatrix({ runDir, versions: ["anchor"], hosts: ["codex"], partition: "training", adapters: { codex: adapter }, attemptId: "tool-source" });
    expect(record?.skill_path).toBeNull();
    expect(record?.wrong_skill_source).toBe(true);
    expect(record?.host_result.exit_code).toBe(88);
  });

  test("prepends fixture-local fake CLIs to the task environment", async () => {
    const { runDir, adapter } = await preparedRun();
    const records = await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], repetitions: 1, timeoutMs: 1_000, adapters: { codex: adapter } });

    expect(adapter.requests[0]?.env?.PATH?.split(":")[0]).toBe(join(records[0]!.run_dir, "workspace", "bin"));
  });

  test("omits frozen evaluator-only files from executor skill copies", async () => {
    const { runDir, adapter } = await preparedRun();
    const state = await readJson<RunState>(join(runDir, "run.json"));
    await mkdir(join(state.versions.authored!.path, "references"), { recursive: true });
    await writeFile(join(state.versions.authored!.path, "references", "behavior-eval.md"), "answer key\n");
    state.executor_exclusions = ["references/behavior-eval.md"];
    state.hashes.versions.authored = await hashTree(state.versions.authored!.path);
    await writeJson(join(runDir, "run.json"), state);

    const records = await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], adapters: { codex: adapter } });

    expect(await Bun.file(join(records[0]!.skill_path!, "references", "behavior-eval.md")).exists()).toBe(false);
    expect(records[0]!.executor_exclusions).toEqual(["references/behavior-eval.md"]);
  });

  test("marks a run failed when the skill snapshot is mutated", async () => {
    const { runDir, adapter } = await preparedRun();
    adapter.mutateSkill = true;
    const records = await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], repetitions: 1, timeoutMs: 1_000, adapters: { codex: adapter } });

    expect(records[0]?.source_mutated).toBe(true);
    expect(records[0]?.host_result.exit_code).not.toBe(0);
  });

  test("keeps attempts immutable and rejects an attempt id reused on resume", async () => {
    const { runDir, adapter } = await preparedRun();
    const first = await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "attempt-one", adapters: { codex: adapter } });
    const second = await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "attempt-two", adapters: { codex: adapter } });

    expect(first[0]?.attempt_id).toBe("attempt-one");
    expect(second[0]?.attempt_id).toBe("attempt-two");
    expect(first[0]?.run_dir).not.toBe(second[0]?.run_dir);
    expect((await readJson<any[]>(join(runDir, "executions.json"))).map((item) => item.attempt_id)).toEqual(["attempt-one", "attempt-two"]);
    await expect(runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "attempt-one", adapters: { codex: adapter } })).rejects.toThrow("attempt id already exists");

    await mkdir(join(runDir, "artifacts", "runs", "interrupted"), { recursive: true });
    await expect(runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "interrupted", adapters: { codex: adapter } })).rejects.toThrow("artifact directory already exists");
  });

  test("preserves aggregate evidence from concurrent run processes", async () => {
    const { runDir, adapter } = await preparedRun();
    const execute = adapter.execute.bind(adapter);
    let arrivals = 0;
    let release = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    adapter.execute = async (request) => {
      arrivals += 1;
      if (arrivals === 2) release();
      await barrier;
      return execute(request);
    };

    await Promise.all([
      runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "parallel-one", adapters: { codex: adapter } }),
      runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "parallel-two", adapters: { codex: adapter } }),
    ]);

    const executions = await readJson<any[]>(join(runDir, "executions.json"));
    const gradings = await readJson<any[]>(join(runDir, "gradings.json"));
    expect(executions.map((item) => item.attempt_id).sort()).toEqual(["parallel-one", "parallel-two"]);
    expect(gradings.map((item) => item.attempt_id).sort()).toEqual(["parallel-one", "parallel-two"]);
  });

  test("runs training and validation cases as separate evidence partitions", async () => {
    const { runDir, adapter } = await preparedRun();
    const training = await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "training", partition: "training", adapters: { codex: adapter } });
    const validation = await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "validation", partition: "validation", adapters: { codex: adapter } });

    expect(training.map((item) => item.eval_id)).toEqual(["case"]);
    expect(training.every((item) => item.partition === "training")).toBe(true);
    expect(validation.map((item) => item.eval_id)).toEqual(["validation"]);
    expect(validation.every((item) => item.partition === "validation")).toBe(true);
  });

  test("persists and grades completed arms incrementally, then resumes only missing arms", async () => {
    const { runDir, adapter } = await preparedRun();
    adapter.failOnCall = 2;

    await expect(runMatrix({
      runDir,
      versions: ["anchor", "authored"],
      hosts: ["codex"],
      attemptId: "resumable",
      concurrency: 1,
      adapters: { codex: adapter },
    } as any)).rejects.toThrow("simulated interruption");

    expect(await readJson<any[]>(join(runDir, "executions.json"))).toHaveLength(1);
    expect(await readJson<any[]>(join(runDir, "gradings.json"))).toHaveLength(1);
    expect(await readJson<any>(join(runDir, "artifacts", "runs", "resumable", "attempt.json"))).toMatchObject({
      status: "interrupted",
      record_count: 1,
    });

    adapter.failOnCall = null;
    const resumed = await runMatrix({
      runDir,
      versions: ["anchor", "authored"],
      hosts: ["codex"],
      attemptId: "resumable",
      concurrency: 1,
      resume: true,
      adapters: { codex: adapter },
    } as any);

    expect(resumed).toHaveLength(2);
    expect(adapter.requests).toHaveLength(2);
    expect(await readJson<any[]>(join(runDir, "executions.json"))).toHaveLength(2);
    expect(await readJson<any[]>(join(runDir, "gradings.json"))).toHaveLength(2);
    expect(await readJson<any>(join(runDir, "artifacts", "runs", "resumable", "attempt.json"))).toMatchObject({
      status: "complete",
      record_count: 2,
    });
  });

  test("does not rewrite completed evidence on a no-op resume", async () => {
    const { runDir, adapter } = await preparedRun();
    await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "complete-resume", adapters: { codex: adapter } });
    const gradingPath = join(runDir, "gradings.json");
    const manifestPath = join(runDir, "artifacts", "runs", "complete-resume", "attempt.json");
    const gradingBefore = await readFile(gradingPath, "utf8");
    const manifestBefore = await readFile(manifestPath, "utf8");

    await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "complete-resume", resume: true, adapters: { codex: adapter } });

    expect(adapter.requests).toHaveLength(1);
    expect(await readFile(gradingPath, "utf8")).toBe(gradingBefore);
    expect(await readFile(manifestPath, "utf8")).toBe(manifestBefore);
  });

  test("preserves a completed manifest while backfilling missing aggregate grades", async () => {
    const { runDir, adapter } = await preparedRun();
    await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "complete-backfill", adapters: { codex: adapter } });
    const gradingPath = join(runDir, "gradings.json");
    const manifestPath = join(runDir, "artifacts", "runs", "complete-backfill", "attempt.json");
    const manifestBefore = await readFile(manifestPath, "utf8");
    await writeJson(gradingPath, []);

    await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "complete-backfill", resume: true, adapters: { codex: adapter } });

    expect(adapter.requests).toHaveLength(1);
    expect(await readJson<any[]>(gradingPath)).toHaveLength(1);
    expect(await readFile(manifestPath, "utf8")).toBe(manifestBefore);
    expect((await readJson<any>(manifestPath)).status).toBe("complete");
  });

  test("invalidates evidence when the live target changes during execution", async () => {
    const { runDir, adapter } = await preparedRun();
    const state = await readJson<RunState>(join(runDir, "run.json"));
    adapter.mutateTargetPath = state.target_path;

    await expect(runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "live-target-mutation", adapters: { codex: adapter } })).rejects.toThrow("target skill changed during execution");
    expect(await readJson<any>(join(runDir, "artifacts", "runs", "live-target-mutation", "attempt.json"))).toMatchObject({ status: "interrupted" });
  });
});
