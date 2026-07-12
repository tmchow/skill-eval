import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBlindJudges } from "../skills/skill-eval/scripts/lib/judges.ts";
import { readJson, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import type { ExecutionRecord, HostAdapter, HostRequest, HostResult, RunState } from "../skills/skill-eval/scripts/lib/types.ts";

class JudgeAdapter implements HostAdapter {
  constructor(public name: "claude" | "codex", private winner: "A" | "B" | "TIE", private tracker?: { active: number; max: number }) {}
  prompts: string[] = [];
  expectations: Array<{ id: string; winner: "A" | "B" | "TIE" | "BLOCKED"; evidence: string }> = [];
  sawLabelMap = false;
  sawEvidence = false;
  evidenceLeakedVersion = false;
  artifactTexts: string[] = [];
  artifactPaths: string[] = [];
  projectedToolEvidenceExists = false;
  objectiveEvidence = "";
  toolEvidence = "";
  async execute(request: HostRequest): Promise<HostResult> {
    if (this.tracker) {
      this.tracker.active += 1;
      this.tracker.max = Math.max(this.tracker.max, this.tracker.active);
      await Bun.sleep(20);
    }
    this.prompts.push(request.prompt);
    this.sawLabelMap = await Bun.file(join(request.cwd, "label-map.json")).exists();
    const evidenceFiles = [join(request.cwd, "input", "A", "evidence", "tool-events.jsonl"), join(request.cwd, "input", "B", "evidence", "tool-events.jsonl")];
    this.sawEvidence = evidenceFiles.every((path) => Bun.file(path).exists());
    const evidence = (await Promise.all(evidenceFiles.map(async (path) => await Bun.file(path).exists() ? Bun.file(path).text() : ""))).join("\n");
    this.toolEvidence = evidence;
    this.evidenceLeakedVersion = evidence.includes("incumbent") || evidence.includes("challenger");
    this.artifactTexts = await Promise.all(["A", "B"].map((label) => Bun.file(join(request.cwd, "input", label, "artifacts", "final.md")).text()));
    this.artifactPaths = [];
    for (const label of ["A", "B"]) {
      for await (const path of new Bun.Glob("**/*").scan({ cwd: join(request.cwd, "input", label, "artifacts"), onlyFiles: false })) this.artifactPaths.push(path);
    }
    this.projectedToolEvidenceExists = (await Promise.all(evidenceFiles.map((path) => Bun.file(path).exists()))).some(Boolean);
    this.objectiveEvidence = (await Promise.all(["A", "B"].map((label) => Bun.file(join(request.cwd, "input", label, "evidence", "objective-grading.json")).text()))).join("\n");
    const final = JSON.stringify({
      winner: this.winner,
      reasoning: `${this.name} evidence`,
      rubric: [{ criterion: "correctness", A: 4, B: 3 }],
      overall: { A: 8, B: 6 },
      strengths: { A: ["specific"], B: ["concise"] },
      weaknesses: { A: [], B: ["incomplete"] },
      expectations: this.expectations,
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
    schema_version: 2, run_id: "r", run_dir: runDir, created_at: now, target_path: runDir, repo_root: runDir,
    skill_name: "demo", invoking_host: "codex", requested_hosts: ["claude", "codex"], anchor: { kind: "git", ref: "HEAD" },
    versions: {}, hashes: { versions: { incumbent: "a", challenger: "b" }, fixtures: {}, suite: "s" },
    git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true },
  };
  await writeJson(join(runDir, "run.json"), state);
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 2, claim_class: "effectiveness", environment: { fidelity: "isolated", external_state: [] }, skill_name: "demo", hypothesis: "better", evals: [{ id: "case", name: "Case", purpose: "improvement", severity: "quality", prompt: "task", expectations: [{ id: "quality", text: "best answer", severity: "quality", evidence_role: "outcome" }] }],
  });
  const records: ExecutionRecord[] = [];
  for (const version of ["incumbent", "challenger"]) {
    for (const repetition of [1, 2]) {
      const outputDir = join(runDir, version, `run-${repetition}`, "outputs");
      await mkdir(outputDir, { recursive: true });
      await writeFile(join(outputDir, "final.md"), `${version} output ${repetition}`);
      const executionRunDir = join(runDir, version, `run-${repetition}`);
      const eventPath = join(executionRunDir, "events.jsonl");
      await writeFile(eventPath, JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: `cat ${executionRunDir}/skill/SKILL.md`, aggregated_output: "peer completed" } }));
      records.push({
        schema_version: 2, attempt_id: "behavior-attempt", partition: "training", created_at: now,
        host: "codex", eval_id: "case", version, repetition, run_dir: executionRunDir, output_dir: outputDir,
        skill_path: null, skill_hash_before: null, skill_hash_after: null, source_mutated: false,
        host_result: { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: `${version} output`, duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: eventPath, stderr_path: "", final_path: "" },
      });
    }
  }
  await writeJson(join(runDir, "executions.json"), records);
  await writeJson(join(runDir, "gradings.json"), records.map((item) => ({
    schema_version: 2, attempt_id: item.attempt_id, partition: item.partition, host: item.host, eval_id: item.eval_id, version: item.version, repetition: item.repetition,
    expectations: [], summary: { passed: 0, failed: 0, blocked: 0, qualitative: 1, total: 1, pass_rate: null, critical_failed: 0, critical_blocked: 0, run_failed: false },
  })));
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
    expect(claude.sawEvidence && codex.sawEvidence).toBe(true);
    expect(claude.evidenceLeakedVersion || codex.evidenceLeakedVersion).toBe(false);
    expect(new Set(results.map((result) => result.repetition))).toEqual(new Set([1, 2]));
    expect(results.every((result) => result.comparison_id === "incumbent-v-challenger")).toBe(true);
    expect(tracker.max).toBe(2);
    await expect(runBlindJudges({ runDir, left: "incumbent", right: "challenger", executionAttemptIds: ["behavior-attempt"], comparisonId: "incumbent-v-challenger", judgeHosts: ["codex"], adapters: { codex } })).rejects.toThrow("comparison id already exists");
  });

  test("skips a pair when either execution timed out", async () => {
    const runDir = await judgeRun();
    const records = await readJson<ExecutionRecord[]>(join(runDir, "executions.json"));
    const timedOut = records.find((item) => item.version === "challenger" && item.repetition === 2)!;
    timedOut.host_result = { ...timedOut.host_result, exit_code: 137, timed_out: true, final_text: "partial" };
    await writeJson(join(runDir, "executions.json"), records);
    const codex = new JudgeAdapter("codex", "A");

    const results = await runBlindJudges({ runDir, left: "incumbent", right: "challenger", executionAttemptIds: ["behavior-attempt"], comparisonId: "skip-timeout", judgeHosts: ["codex"], adapters: { codex } });
    const root = join(runDir, "artifacts", "judges");
    const attempt = await new Bun.Glob("*/comparison-attempt.json").scan({ cwd: root, absolute: true }).next();
    const manifest = await readJson<any>(attempt.value!);

    expect(results.map((item) => item.repetition)).toEqual([1]);
    expect(manifest.skipped_pairs).toMatchObject([{ repetition: 2, reason: "executor timed out" }]);
  });

  test("does not let direct judging bypass a candidate critical gate", async () => {
    const runDir = await judgeRun();
    const records = await readJson<ExecutionRecord[]>(join(runDir, "executions.json"));
    await writeJson(join(runDir, "gradings.json"), records.map((item) => ({
      schema_version: 2, attempt_id: item.attempt_id, partition: item.partition, host: item.host, eval_id: item.eval_id, version: item.version, repetition: item.repetition,
      expectations: [], summary: { passed: 0, failed: 0, blocked: 0, qualitative: 1, total: 1, pass_rate: null, critical_failed: item.version === "challenger" ? 1 : 0, critical_blocked: 0, run_failed: false },
    })));
    const codex = new JudgeAdapter("codex", "A");

    await expect(runBlindJudges({ runDir, left: "incumbent", right: "challenger", executionAttemptIds: ["behavior-attempt"], comparisonId: "critical-bypass", judgeHosts: ["codex"], adapters: { codex } })).rejects.toThrow("no paired executions");
    expect(codex.prompts).toHaveLength(0);
  });

  test("maps improve and non-regression criteria separately from overall preference", async () => {
    const runDir = await judgeRun();
    const suite = await readJson<any>(join(runDir, "suite.json"));
    suite.evals[0].expectations.push(
      { id: "better", text: "the candidate is materially better", severity: "quality", evidence_role: "outcome", scope: "comparison", comparison_goal: "improve" },
      { id: "stable", text: "the candidate is no worse", severity: "critical", evidence_role: "outcome", scope: "comparison", comparison_goal: "not-worse" },
    );
    await writeJson(join(runDir, "suite.json"), suite);
    const codex = new JudgeAdapter("codex", "TIE");
    codex.expectations = [
      { id: "better", winner: "TIE", evidence: "no material advantage" },
      { id: "stable", winner: "TIE", evidence: "equivalent quality" },
    ];

    const results = await runBlindJudges({ runDir, left: "incumbent", right: "challenger", executionAttemptIds: ["behavior-attempt"], comparisonId: "criterion-goals", judgeHosts: ["codex"], adapters: { codex } });

    expect(results[0]?.expectations).toMatchObject([
      { id: "better", goal: "improve", status: "FAIL" },
      { id: "stable", goal: "not-worse", status: "PASS" },
    ]);
  });

  test("projects treatment-identifying metadata out of blind judge packages", async () => {
    const runDir = await judgeRun();
    const suite = await readJson<any>(join(runDir, "suite.json"));
    suite.environment.comparison_projection = {
      text_redactions: [
        { pattern: "-(?:claude|codex)\\b", replacement: "" },
        { pattern: "\\s*\\(\\+1 anchor\\)", replacement: "" },
      ],
      omit_tool_events: true,
    };
    await writeJson(join(runDir, "suite.json"), suite);
    const records = await readJson<ExecutionRecord[]>(join(runDir, "executions.json"));
    for (const record of records) {
      const reviewer = record.version === "challenger" ? "security-lens-codex (+1 anchor)" : "security-lens";
      await writeFile(join(record.output_dir, "final.md"), `| Risk | Reviewer |\n| --- | --- |\n| Missing PKCE | ${reviewer} |\n`);
      await mkdir(join(record.output_dir, `${reviewer}-evidence`), { recursive: true });
      await writeFile(join(record.output_dir, `${reviewer}-evidence`, `${reviewer}.txt`), "evidence\n");
    }
    const gradings = await readJson<any[]>(join(runDir, "gradings.json"));
    for (const grade of gradings) {
      grade.expectations = [{ id: grade.version === "challenger" ? "peer-invoked" : "common", text: "mechanism", severity: "diagnostic", version_scope: grade.version === "challenger" ? "candidate" : "all", passed: true, blocked: false, evidence: "security-lens-codex (+1 anchor) tool trace" }];
    }
    await writeJson(join(runDir, "gradings.json"), gradings);
    const codex = new JudgeAdapter("codex", "TIE");

    await runBlindJudges({ runDir, left: "incumbent", right: "challenger", executionAttemptIds: ["behavior-attempt"], comparisonId: "projected", judgeHosts: ["codex"], adapters: { codex } });

    expect(codex.artifactTexts).toHaveLength(2);
    expect(codex.artifactTexts.every((text) => text.includes("security-lens") && !text.includes("-codex") && !text.includes("+1 anchor"))).toBe(true);
    expect(codex.projectedToolEvidenceExists).toBe(false);
    expect(codex.objectiveEvidence).not.toContain("peer-invoked");
    expect(codex.objectiveEvidence).toContain("common");
    expect(codex.objectiveEvidence).not.toContain("-codex");
    expect(codex.objectiveEvidence).not.toContain("+1 anchor");
    expect(codex.artifactPaths.some((path) => path.includes("security-lens-evidence/security-lens.txt"))).toBe(true);
    expect(codex.artifactPaths.every((path) => !path.includes("-codex") && !path.includes("+1 anchor"))).toBe(true);
  });

  test("projects retained tool evidence without changing raw execution events", async () => {
    const runDir = await judgeRun();
    const suite = await readJson<any>(join(runDir, "suite.json"));
    suite.environment.comparison_projection = {
      text_redactions: [
        { pattern: "-(?:claude|codex)\\b", replacement: "" },
        { pattern: "\\s*\\(\\+1 anchor\\)", replacement: "" },
      ],
      omit_tool_events: false,
    };
    await writeJson(join(runDir, "suite.json"), suite);
    const records = await readJson<ExecutionRecord[]>(join(runDir, "executions.json"));
    const rawMarker = "security-lens-codex (+1 anchor)";
    for (const record of records) {
      await writeFile(record.host_result.event_path, JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: `review --reviewer ${rawMarker}`, aggregated_output: rawMarker } }));
    }
    const codex = new JudgeAdapter("codex", "TIE");

    await runBlindJudges({ runDir, left: "incumbent", right: "challenger", executionAttemptIds: ["behavior-attempt"], comparisonId: "projected-tools", judgeHosts: ["codex"], adapters: { codex } });

    expect(codex.projectedToolEvidenceExists).toBe(true);
    expect(codex.toolEvidence).toContain("security-lens");
    expect(codex.toolEvidence).not.toContain("-codex");
    expect(codex.toolEvidence).not.toContain("+1 anchor");
    expect(await Bun.file(records[0]!.host_result.event_path).text()).toContain(rawMarker);
  });

  test("always withholds arm-scoped objective checks from blind packages", async () => {
    const runDir = await judgeRun();
    const gradings = await readJson<any[]>(join(runDir, "gradings.json"));
    for (const grade of gradings) {
      grade.expectations = [
        { id: "common", text: "common", severity: "diagnostic", evidence_role: "outcome", version_scope: "all", passed: true, blocked: false, evidence: "common evidence" },
        ...(grade.version === "challenger" ? [{ id: "candidate-mechanism", text: "candidate only", severity: "critical", evidence_role: "mechanism", version_scope: "candidate", passed: true, blocked: false, evidence: "candidate evidence" }] : []),
      ];
    }
    await writeJson(join(runDir, "gradings.json"), gradings);
    const codex = new JudgeAdapter("codex", "TIE");

    await runBlindJudges({ runDir, left: "incumbent", right: "challenger", executionAttemptIds: ["behavior-attempt"], comparisonId: "unprojected-arm-scope", judgeHosts: ["codex"], adapters: { codex } });

    expect(codex.objectiveEvidence).toContain("common");
    expect(codex.objectiveEvidence).not.toContain("candidate-mechanism");
    expect(codex.objectiveEvidence).not.toContain("candidate evidence");
  });
});
