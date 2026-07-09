import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMatrix } from "../skills/skill-eval/scripts/lib/executor.ts";
import { hashTree, readJson, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import type { HostAdapter, HostRequest, HostResult, RunState } from "../skills/skill-eval/scripts/lib/types.ts";

class FakeAdapter implements HostAdapter {
  name = "codex" as const;
  prompts: string[] = [];
  mutateSkill = false;

  async execute(request: HostRequest): Promise<HostResult> {
    this.prompts.push(request.prompt);
    const skillMatch = request.prompt.match(/Exact skill snapshot: (.+)/);
    if (this.mutateSkill && skillMatch) await writeFile(join(skillMatch[1]!, "MUTATED"), "bad");
    await writeFile(request.eventPath, '{"type":"turn.completed"}\n');
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
  await writeFile(join(authored, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n# Authored\n");
  await writeFile(join(anchor, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n# Anchor\n");
  await writeFile(join(runDir, "fixtures", "case", "input.txt"), "fixture\n");
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 1, skill_name: "demo", hypothesis: "better", evals: [{
      id: "case", name: "Case", purpose: "improvement", severity: "critical", prompt: "Do the thing.", fixture: "fixture",
      expectations: [{ id: "result", text: "result exists", severity: "critical", check: { type: "file_exists", path: "result.txt" } }],
    }, {
      id: "held-out", name: "Held out", purpose: "regression", severity: "critical", prompt: "Do the held-out thing.", holdout: true,
      expectations: [{ id: "result", text: "result exists", severity: "critical", check: { type: "file_exists", path: "result.txt" } }],
    }],
  });
  const now = new Date().toISOString();
  const state: RunState = {
    schema_version: 1, run_id: "run", run_dir: runDir, created_at: now, target_path: authored, repo_root: runDir,
    skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "git", ref: "HEAD" },
    versions: { anchor: { path: anchor, parent: null, created_at: now }, authored: { path: authored, parent: null, created_at: now } },
    hashes: { versions: { anchor: await hashTree(anchor), authored: await hashTree(authored) }, fixtures: { case: await hashTree(join(runDir, "fixtures", "case")) }, suite: "suite" },
    git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true },
  };
  await writeJson(join(runDir, "run.json"), state);
  return { runDir, adapter: new FakeAdapter() };
}

describe("matrix execution", () => {
  test("uses fresh fixtures and exact version paths for every arm", async () => {
    const { runDir, adapter } = await preparedRun();
    const records = await runMatrix({ runDir, versions: ["anchor", "authored"], hosts: ["codex"], repetitions: 1, timeoutMs: 1_000, adapters: { codex: adapter } });

    expect(records).toHaveLength(2);
    expect(adapter.prompts[0]).toContain("Exact skill snapshot:");
    expect(adapter.prompts[0]).not.toBe(adapter.prompts[1]);
    expect(await readFile(join(records[0]!.run_dir, "workspace", "input.txt"), "utf8")).toBe("fixture\n");
    expect(records.every((record) => !record.source_mutated)).toBe(true);
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

  test("runs training and held-out cases as separate evidence partitions", async () => {
    const { runDir, adapter } = await preparedRun();
    const training = await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "training", partition: "training", adapters: { codex: adapter } });
    const holdout = await runMatrix({ runDir, versions: ["authored"], hosts: ["codex"], attemptId: "holdout", partition: "holdout", adapters: { codex: adapter } });

    expect(training.map((item) => item.eval_id)).toEqual(["case"]);
    expect(training.every((item) => item.partition === "training")).toBe(true);
    expect(holdout.map((item) => item.eval_id)).toEqual(["held-out"]);
    expect(holdout.every((item) => item.partition === "holdout")).toBe(true);
  });
});
