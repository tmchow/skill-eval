import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaudeTriggerArgs, buildCodexTriggerArgs, eventShowsTrigger, runTriggerSuite, summarizeCrossHostTriggers, summarizeTriggers } from "../skills/skill-eval/scripts/lib/triggers.ts";
import { hashTree, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import type { RunState } from "../skills/skill-eval/scripts/lib/types.ts";

test("trigger suite measures precision and recall from raw prompts", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-trigger-"));
  const skillPath = join(runDir, "versions", "authored");
  await mkdir(skillPath, { recursive: true });
  await writeFile(join(skillPath, "SKILL.md"), "---\nname: demo\ndescription: Use when evaluating skills.\n---\n# Demo\n");
  const now = new Date().toISOString();
  const state: RunState = {
    schema_version: 2, run_id: "r", run_dir: runDir, created_at: now, target_path: skillPath, repo_root: runDir, skill_name: "demo",
    invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "none" }, versions: { authored: { path: skillPath, parent: null, created_at: now } },
    hashes: { versions: { anchor: null, authored: await hashTree(skillPath) }, fixtures: {}, suite: "s" }, git: { initial_clean: false, initial_status: "", branch: null, head: null, target_tracked: false },
  };
  await writeJson(join(runDir, "run.json"), state);
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 2, claim_class: "conformance", skill_name: "demo", hypothesis: "trigger", evals: [{ id: "behavior", name: "Behavior", purpose: "improvement", severity: "quality", prompt: "task", expectations: [{ id: "q", text: "q", severity: "quality", evidence_role: "outcome" }] }],
    trigger_queries: [
      { id: "positive", query: "Evaluate this skill", should_trigger: true },
      { id: "negative", query: "Evaluate this stock", should_trigger: false },
      { id: "validation", query: "Benchmark this skill later", should_trigger: true, validation: true },
    ],
  });
  const prompts: string[] = [];
  const results = await runTriggerSuite({
    runDir, version: "authored", hosts: ["codex"], repetitions: 2, attemptId: "training", partition: "training",
    probe: async (_host, request) => {
      prompts.push(request.query);
      return { triggered: request.query.includes("this skill"), duration_ms: 1, event_path: join(runDir, "probe.jsonl"), error: null };
    },
  });
  const summary = summarizeTriggers(results);

  expect(prompts).toEqual(["Evaluate this skill", "Evaluate this skill", "Evaluate this stock", "Evaluate this stock"]);
  expect(summary.precision).toBe(1);
  expect(summary.recall).toBe(1);
  expect(summary.false_trigger_rate).toBe(0);
  expect(results.every((result) => result.attempt_id === "training" && result.partition === "training")).toBe(true);

  const validation = await runTriggerSuite({
    runDir, version: "authored", hosts: ["codex"], repetitions: 1, attemptId: "validation", partition: "validation",
    probe: async (_host, request) => ({ triggered: request.query.includes("this skill"), duration_ms: 1, event_path: join(runDir, "probe.jsonl"), error: null }),
  });
  expect(validation.map((item) => item.query_id)).toEqual(["validation"]);
  const defaultRepetition = await runTriggerSuite({
    runDir, version: "authored", hosts: ["codex"], attemptId: "default-repetition", partition: "validation",
    probe: async (_host, request) => ({ triggered: request.query.includes("this skill"), duration_ms: 1, event_path: join(runDir, "probe.jsonl"), error: null }),
  });
  expect(defaultRepetition).toHaveLength(1);
  await expect(runTriggerSuite({
    runDir, version: "authored", hosts: ["codex"], repetitions: 1, attemptId: "validation", partition: "validation",
    probe: async () => ({ triggered: false, duration_ms: 1, event_path: join(runDir, "probe.jsonl"), error: null }),
  })).rejects.toThrow("attempt id already exists");
  await mkdir(join(runDir, "artifacts", "triggers", "interrupted"), { recursive: true });
  await expect(runTriggerSuite({
    runDir, version: "authored", hosts: ["codex"], repetitions: 1, attemptId: "interrupted", partition: "training",
    probe: async () => ({ triggered: false, duration_ms: 1, event_path: join(runDir, "probe.jsonl"), error: null }),
  })).rejects.toThrow("artifact directory already exists");
});

test("recognizes only the isolated Claude probe skill identity", () => {
  const event = {
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "skill-eval-probe:live-probe" } }] },
  };
  expect(eventShowsTrigger("claude", event, "live-probe", "/tmp/source/live-probe")).toBe(true);
  const sibling = {
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "installed-plugin:live-probe" } }] },
  };
  expect(eventShowsTrigger("claude", sibling, "live-probe", "/tmp/source/live-probe")).toBe(false);
});

test("recognizes Codex reading the isolated SKILL.md", () => {
  const event = {
    type: "item.completed",
    item: { type: "command_execution", command: "sed -n 1,200p /tmp/source/live-probe/SKILL.md" },
  };
  expect(eventShowsTrigger("codex", event, "live-probe", "/tmp/source/live-probe")).toBe(true);
  const installed = {
    type: "item.completed",
    item: { type: "command_execution", command: "cat /Users/test/.agents/skills/live-probe/SKILL.md" },
  };
  expect(eventShowsTrigger("codex", installed, "live-probe", "/tmp/source/live-probe")).toBe(false);
});

test("trigger probes pin strong default models and reasoning effort", () => {
  const claude = buildClaudeTriggerArgs("/tmp/plugin");
  expect(claude[claude.indexOf("--model") + 1]).toBe("claude-opus-4-8");
  expect(claude[claude.indexOf("--effort") + 1]).toBe("high");
  expect(buildClaudeTriggerArgs("/tmp/plugin", "opus-custom")).toContain("opus-custom");

  const codex = buildCodexTriggerArgs("/tmp/work");
  expect(codex[codex.indexOf("--model") + 1]).toBe("gpt-5.6-sol");
  expect(codex).toContain('model_reasoning_effort="high"');
  expect(buildCodexTriggerArgs("/tmp/work", "codex-custom")).toContain("codex-custom");
});

test("checkpoints completed trigger probes and resumes only missing work", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-trigger-resume-"));
  const skillPath = join(runDir, "versions", "authored");
  await mkdir(skillPath, { recursive: true });
  await writeFile(join(skillPath, "SKILL.md"), "---\nname: demo\ndescription: Use when evaluating skills.\n---\n# Demo\n");
  const now = new Date().toISOString();
  const state: RunState = {
    schema_version: 2, run_id: "r", run_dir: runDir, created_at: now, target_path: skillPath, repo_root: runDir, skill_name: "demo",
    invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "none" }, versions: { authored: { path: skillPath, parent: null, created_at: now } },
    hashes: { versions: { anchor: null, authored: await hashTree(skillPath) }, fixtures: {}, suite: "s" }, git: { initial_clean: false, initial_status: "", branch: null, head: null, target_tracked: false },
  };
  await writeJson(join(runDir, "run.json"), state);
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 2, claim_class: "conformance", skill_name: "demo", hypothesis: "trigger", evals: [],
    trigger_queries: [
      { id: "one", query: "one", should_trigger: true },
      { id: "two", query: "two", should_trigger: false },
    ],
  });
  let calls = 0;
  await expect(runTriggerSuite({
    runDir, version: "authored", hosts: ["codex"], repetitions: 2, attemptId: "resumable", partition: "training", concurrency: 1,
    probe: async (_host, request) => {
      calls += 1;
      if (calls === 3) throw new Error("interrupted");
      return { triggered: request.query === "one", duration_ms: 1, event_path: join(runDir, `probe-${calls}.jsonl`), error: null };
    },
  })).rejects.toThrow("interrupted");
  expect((await Bun.file(join(runDir, "triggers.json")).json()).filter((item: any) => item.attempt_id === "resumable")).toHaveLength(2);

  let resumedCalls = 0;
  const results = await runTriggerSuite({
    runDir, version: "authored", hosts: ["codex"], repetitions: 2, attemptId: "resumable", partition: "training", concurrency: 1, resume: true,
    probe: async (_host, request) => {
      resumedCalls += 1;
      return { triggered: request.query === "one", duration_ms: 1, event_path: join(runDir, `resumed-${resumedCalls}.jsonl`), error: null };
    },
  });
  expect(resumedCalls).toBe(2);
  expect(results).toHaveLength(4);
});

test("keeps completed trigger attempts immutable and pins runtime identity", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-trigger-complete-"));
  const skillPath = join(runDir, "skill");
  await mkdir(skillPath);
  await writeFile(join(skillPath, "SKILL.md"), "---\nname: demo\ndescription: Use when evaluating skills.\n---\n# Demo\n");
  const now = new Date().toISOString();
  await writeJson(join(runDir, "run.json"), {
    schema_version: 2, run_id: "r", run_dir: runDir, created_at: now, target_path: skillPath, repo_root: runDir, skill_name: "demo",
    invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "none" }, versions: { authored: { path: skillPath, parent: null, created_at: now } },
    hashes: { versions: { anchor: null, authored: await hashTree(skillPath) }, fixtures: {}, suite: "s" }, git: { initial_clean: false, initial_status: "", branch: null, head: null, target_tracked: false },
  });
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 2, claim_class: "conformance", skill_name: "demo", hypothesis: "trigger", evals: [],
    trigger_queries: [{ id: "positive", query: "Evaluate this skill", should_trigger: true }],
  });
  let calls = 0;
  const probe = async () => { calls += 1; return { triggered: true, duration_ms: 1, event_path: join(runDir, "probe.jsonl"), error: null }; };
  await runTriggerSuite({ runDir, version: "authored", hosts: ["codex"], repetitions: 1, attemptId: "complete", partition: "training", models: { codex: "gpt-5.6-sol" }, reasoningEfforts: { codex: "high" }, probe });
  const manifestPath = join(runDir, "artifacts", "triggers", "complete", "attempt.json");
  const before = await Bun.file(manifestPath).text();

  await runTriggerSuite({ runDir, version: "authored", hosts: ["codex"], repetitions: 1, attemptId: "complete", partition: "training", models: { codex: "gpt-5.6-sol" }, reasoningEfforts: { codex: "high" }, resume: true, probe });
  expect(calls).toBe(1);
  expect(await Bun.file(manifestPath).text()).toBe(before);

  await expect(runTriggerSuite({ runDir, version: "authored", hosts: ["codex"], repetitions: 1, attemptId: "complete", partition: "training", models: { codex: "different" }, reasoningEfforts: { codex: "high" }, resume: true, probe })).rejects.toThrow("runtime_profiles changed");
});

test("surfaces cross-host disagreement separately from aggregate trigger accuracy", () => {
  const result = (host: "claude" | "codex", repetition: number, triggered: boolean) => ({
    schema_version: 2 as const, attempt_id: "a", partition: "validation" as const, created_at: new Date().toISOString(), host,
    version: "authored", query_id: "adjacent", should_trigger: false, repetition, triggered, duration_ms: 1, event_path: "events", error: null,
  });
  const summary = summarizeCrossHostTriggers([
    result("claude", 1, true), result("claude", 2, true), result("claude", 3, true),
    result("codex", 1, true), result("codex", 2, false), result("codex", 3, false),
  ]);

  expect(summary.hosts).toMatchObject({ claude: { accuracy: 0 }, codex: { accuracy: 1 } });
  expect(summary.disagreements).toMatchObject([{
    query_id: "adjacent",
    hosts: { claude: { trigger_rate: 1, passed: false }, codex: { trigger_rate: 1 / 3, passed: true } },
  }]);
});
