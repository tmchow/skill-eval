import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBlindJudges } from "../skills/skill-eval/scripts/lib/judges.ts";
import { writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import type { ExecutionRecord, HostAdapter, HostRequest, HostResult, RunState } from "../skills/skill-eval/scripts/lib/types.ts";

class JudgeAdapter implements HostAdapter {
  constructor(public name: "claude" | "codex", private winner: "A" | "B" | "TIE", private tracker?: { active: number; max: number }) {}
  prompts: string[] = [];
  sawLabelMap = false;
  async execute(request: HostRequest): Promise<HostResult> {
    if (this.tracker) {
      this.tracker.active += 1;
      this.tracker.max = Math.max(this.tracker.max, this.tracker.active);
      await Bun.sleep(20);
    }
    this.prompts.push(request.prompt);
    this.sawLabelMap = await Bun.file(join(request.cwd, "label-map.json")).exists();
    const final = JSON.stringify({
      winner: this.winner,
      reasoning: `${this.name} evidence`,
      rubric: {
        A: { correctness: 4, completeness: 4, restraint: 4, usability: 4, overall: 8 },
        B: { correctness: 3, completeness: 3, restraint: 3, usability: 3, overall: 6 },
      },
      strengths: { A: ["specific"], B: ["concise"] },
      weaknesses: { A: [], B: ["incomplete"] },
    });
    await writeFile(request.eventPath, "{}");
    await writeFile(request.stderrPath, "");
    await writeFile(request.finalPath, final);
    if (this.tracker) this.tracker.active -= 1;
    return {
      host: this.name, exit_code: 0, timed_out: false, malformed_events: 0, final_text: final, duration_ms: 1,
      usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null },
      event_path: request.eventPath, stderr_path: request.stderrPath, final_path: request.finalPath,
    };
  }
}

async function judgeRun(): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-judges-"));
  const now = new Date().toISOString();
  const state: RunState = {
    schema_version: 1, run_id: "r", run_dir: runDir, created_at: now, target_path: runDir, repo_root: runDir,
    skill_name: "demo", invoking_host: "codex", requested_hosts: ["claude", "codex"], anchor: { kind: "git", ref: "HEAD" },
    versions: {}, hashes: { versions: { incumbent: "a", challenger: "b" }, fixtures: {}, suite: "s" },
    git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true },
  };
  await writeJson(join(runDir, "run.json"), state);
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 1, skill_name: "demo", hypothesis: "better", evals: [{ id: "case", name: "Case", purpose: "improvement", severity: "quality", prompt: "task", expectations: [{ id: "quality", text: "best answer", severity: "quality" }] }],
  });
  const records: ExecutionRecord[] = [];
  for (const version of ["incumbent", "challenger"]) {
    for (const repetition of [1, 2]) {
      const outputDir = join(runDir, version, `run-${repetition}`, "outputs");
      await mkdir(outputDir, { recursive: true });
      await writeFile(join(outputDir, "final.md"), `${version} output ${repetition}`);
      records.push({
        schema_version: 1, attempt_id: "behavior-attempt", partition: "training", created_at: now,
        host: "codex", eval_id: "case", version, repetition, run_dir: join(runDir, version, `run-${repetition}`), output_dir: outputDir,
        skill_path: null, skill_hash_before: null, skill_hash_after: null, source_mutated: false,
        host_result: { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: `${version} output`, duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: "", stderr_path: "", final_path: "" },
      });
    }
  }
  await writeJson(join(runDir, "executions.json"), records);
  return runDir;
}

describe("blind judges", () => {
  test("keeps version identities out of prompts and maps labels separately", async () => {
    const runDir = await judgeRun();
    const tracker = { active: 0, max: 0 };
    const claude = new JudgeAdapter("claude", "A", tracker);
    const codex = new JudgeAdapter("codex", "B", tracker);
    const results = await runBlindJudges({ runDir, left: "incumbent", right: "challenger", executionAttemptIds: ["behavior-attempt"], comparisonId: "incumbent-v-challenger", judgeHosts: ["claude", "codex"], adapters: { claude, codex }, seed: "fixed" });

    expect(results).toHaveLength(4);
    expect([...claude.prompts, ...codex.prompts].every((prompt) => prompt.includes("COMPARATOR CONTRACT"))).toBe(true);
    expect([...claude.prompts, ...codex.prompts].every((prompt) => !prompt.includes("incumbent") && !prompt.includes("challenger"))).toBe(true);
    expect(results.every((result) => ["incumbent", "challenger", "TIE"].includes(result.preferred_version))).toBe(true);
    expect(new Set(results.map((result) => result.judge_host)).size).toBe(2);
    expect(claude.sawLabelMap || codex.sawLabelMap).toBe(false);
    expect(new Set(results.map((result) => result.repetition))).toEqual(new Set([1, 2]));
    expect(results.every((result) => result.comparison_id === "incumbent-v-challenger")).toBe(true);
    expect(tracker.max).toBe(2);
    await expect(runBlindJudges({ runDir, left: "incumbent", right: "challenger", executionAttemptIds: ["behavior-attempt"], comparisonId: "incumbent-v-challenger", judgeHosts: ["codex"], adapters: { codex } })).rejects.toThrow("comparison id already exists");
  });
});
