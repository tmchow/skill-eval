import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCampaignContext, createCampaign, listCampaigns, loadCampaign, loadCaseRetirements, recordCampaignCheckpoint, registerCampaignRun, retireCampaignCase } from "../skills/skill-eval/scripts/lib/campaign.ts";
import { hashTree, hashValue, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import type { RunState, TriggerResult } from "../skills/skill-eval/scripts/lib/types.ts";

async function campaignFixture() {
  const root = await mkdtemp(join(tmpdir(), "skill-eval-campaign-test-"));
  const target = join(root, "skills", "demo");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n# Demo\n");
  const campaign = await createCampaign({ targetPath: target, measurementGoal: "Improve adjacent-intent precision without losing recall.", campaignRoot: join(root, "campaigns"), campaignId: "campaign-1" });
  return { root, target, campaign };
}

test("links multiple frozen runs and builds a factual campaign context packet", async () => {
  const { root, target, campaign } = await campaignFixture();
  const runDir = join(root, "run-1");
  const authored = join(runDir, "versions", "authored");
  await mkdir(authored, { recursive: true });
  await writeFile(join(authored, "SKILL.md"), await Bun.file(join(target, "SKILL.md")).text());
  const now = new Date().toISOString();
  const state: RunState = {
    schema_version: 2, run_id: "run-1", run_dir: runDir, created_at: now, target_path: target, repo_root: root, skill_name: "demo",
    invoking_host: "codex", requested_hosts: ["claude", "codex"], anchor: { kind: "none" }, versions: { authored: { path: authored, parent: null, created_at: now } },
    hashes: { versions: { anchor: null, authored: await hashTree(authored) }, fixtures: {}, suite: "suite" },
    git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: false },
  };
  await writeJson(join(runDir, "run.json"), state);
  const runtimeProfile = { role: "behavior" as const, host: "codex" as const, model: "codex-floor", reasoning_effort: "medium", context_mode: "isolated" as const, capabilities: ["skill-source-injection"] };
  await writeJson(join(runDir, "executions.json"), [{
    schema_version: 2, attempt_id: "calibration", partition: "training", created_at: now, host: "codex", eval_id: "case", version: "authored", repetition: 1,
    run_dir: join(runDir, "execution"), output_dir: join(runDir, "execution", "outputs"), skill_path: authored, skill_hash_before: null, skill_hash_after: null,
    source_mutated: false, runtime_profile: runtimeProfile,
    host_result: { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: "", duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, cost_usd: null }, event_path: "events", stderr_path: "stderr", final_path: "final", runtime_profile: runtimeProfile },
  }]);
  await writeJson(join(runDir, "suite.json"), { schema_version: 2, claim_class: "generalization", environment: { fidelity: "isolated", external_state: [] }, skill_name: "demo", hypothesis: "better discovery", evals: [], trigger_queries: [{ id: "adjacent", query: "adjacent", should_trigger: false }] });
  const trigger = (host: "claude" | "codex", repetition: number, triggered: boolean): TriggerResult => ({
    schema_version: 2, attempt_id: "calibration", partition: "training", created_at: now, host, version: "authored", query_id: "adjacent",
    should_trigger: false, repetition, triggered, duration_ms: 1, event_path: "events", error: null,
  });
  await writeJson(join(runDir, "triggers.json"), [trigger("claude", 1, true), trigger("codex", 1, false)]);
  await registerCampaignRun(campaign.campaign_dir, { runDir, role: "calibration" });
  await recordCampaignCheckpoint(campaign.campaign_dir, {
    stage: "calibration",
    summary: "The adjacent intent is not portable across hosts.",
    established: ["Claude triggered while Codex did not."],
    cross_model: ["One trigger disagreement remains."],
    limitations: ["Behavior was not executed."],
    next_adjustment: "Clarify the description boundary.",
    evidence_run_ids: ["run-1"],
  });

  const context = await buildCampaignContext(campaign.campaign_dir);
  expect(context.campaign).toMatchObject({ skill_name: "demo", measurement_goal: "Improve adjacent-intent precision without losing recall." });
  expect(context.runs[0]).toMatchObject({ role: "calibration", run_id: "run-1", trigger_attempts: [{ cross_model: { disagreements: [{ query_id: "adjacent" }] } }] });
  expect(context.runs[0].runtime_profiles).toEqual([runtimeProfile]);
  expect(context.checkpoints[0]).toMatchObject({ summary: "The adjacent intent is not portable across hosts.", evidence_run_ids: ["run-1"] });
  expect(JSON.stringify(context)).not.toContain("final_report");
});

test("keeps agent checkpoints immutable and rejects unknown evidence runs", async () => {
  const { campaign } = await campaignFixture();
  const input = {
    stage: "plan", summary: "Measure discovery precision.", established: [], cross_model: [], limitations: [],
    next_adjustment: "Run calibration.", evidence_run_ids: [],
  };
  const first = await recordCampaignCheckpoint(campaign.campaign_dir, input);
  const second = await recordCampaignCheckpoint(campaign.campaign_dir, input);
  expect(first.checkpoint_id).not.toBe(second.checkpoint_id);
  expect((await loadCampaign(campaign.campaign_dir)).campaign_id).toBe("campaign-1");
  expect(await listCampaigns({ targetPath: campaign.target_path, campaignRoot: join(campaign.campaign_dir, "..") })).toMatchObject([{ campaign_id: "campaign-1" }]);
  await expect(recordCampaignCheckpoint(campaign.campaign_dir, { ...input, evidence_run_ids: ["missing"] })).rejects.toThrow("unknown campaign run");

  const checkpointPath = join(campaign.campaign_dir, "checkpoints", `${first.checkpoint_id}.json`);
  const tampered = JSON.parse(await readFile(checkpointPath, "utf8"));
  tampered.summary = "Rewritten after the fact.";
  await writeFile(checkpointPath, JSON.stringify(tampered));
  await expect(buildCampaignContext(campaign.campaign_dir)).rejects.toThrow("checkpoint hash mismatch");
});

test("fails closed on malformed campaign retirement evidence", async () => {
  const { campaign } = await campaignFixture();
  await mkdir(join(campaign.campaign_dir, "retirements"), { recursive: true });
  await writeFile(join(campaign.campaign_dir, "retirements", "broken.json"), "not-json\n");
  await expect(loadCaseRetirements(campaign.campaign_dir)).rejects.toThrow();
});

test("pins campaign anchors and requires evidence-backed case retirement", async () => {
  const { root, campaign, target } = await campaignFixture();
  const writeRun = async (runId: string, caseIds: string[], anchorHash: string | null) => {
    const runDir = join(root, runId);
    const authored = join(runDir, "versions", "authored");
    await mkdir(authored, { recursive: true });
    await writeFile(join(authored, "SKILL.md"), await Bun.file(join(target, "SKILL.md")).text());
    const now = new Date().toISOString();
    await writeJson(join(runDir, "run.json"), {
      schema_version: 2, run_id: runId, run_dir: runDir, created_at: now, target_path: target, repo_root: root, skill_name: "demo",
      invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "none" }, versions: { authored: { path: authored, parent: null, created_at: now } },
      hashes: { versions: { anchor: anchorHash, authored: await hashTree(authored) }, fixtures: {}, suite: `suite-${runId}` },
      git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: false },
    });
    await writeJson(join(runDir, "suite.json"), {
      schema_version: 2, claim_class: "effectiveness", environment: { fidelity: "isolated", external_state: [] }, skill_name: "demo", hypothesis: campaign.measurement_goal,
      evals: caseIds.map((id) => ({ id, name: id, purpose: "improvement", severity: "quality", prompt: "Do the task", expectations: [{ id: "quality", text: "The result is useful", severity: "quality", evidence_role: "outcome" }] })),
    });
    return runDir;
  };

  const first = await writeRun("run-1", ["quality"], null);
  await registerCampaignRun(campaign.campaign_dir, { runDir: first, role: "calibration" });
  const dropped = await writeRun("run-2", [], null);
  await expect(registerCampaignRun(campaign.campaign_dir, { runDir: dropped, role: "calibration" })).rejects.toThrow("dropped protected cases");
  await expect(retireCampaignCase(campaign.campaign_dir, { prior_run_id: "run-1", case_id: "quality", attempt_id: "attempt", expectation_id: "quality", reason: "The check measured wording rather than usefulness." })).rejects.toThrow("invalidated-check evidence");
  const invalidation = { schema_version: 2 as const, attempt_id: "attempt", eval_id: "quality", expectation_id: "quality", reason: "wrong semantic property", created_at: new Date().toISOString() };
  await writeJson(join(first, "invalidated-checks.json"), [invalidation]);
  await expect(retireCampaignCase(campaign.campaign_dir, { prior_run_id: "run-1", case_id: "quality", attempt_id: "attempt", expectation_id: "quality", reason: "The check measured wording rather than usefulness." })).rejects.toThrow("hash mismatch");
  await writeJson(join(first, "invalidated-checks.json"), [{ ...invalidation, content_hash: hashValue(invalidation) }]);
  const retirement = await retireCampaignCase(campaign.campaign_dir, { prior_run_id: "run-1", case_id: "quality", attempt_id: "attempt", expectation_id: "quality", reason: "The check measured wording rather than usefulness." });
  expect(retirement.content_hash).toMatch(/^[a-f0-9]{64}$/);
  await expect(registerCampaignRun(campaign.campaign_dir, { runDir: dropped, role: "calibration" })).resolves.toMatchObject({ runs: [{ run_id: "run-1" }, { run_id: "run-2" }] });

  const changedAnchor = await writeRun("run-3", [], "different-anchor");
  await expect(registerCampaignRun(campaign.campaign_dir, { runDir: changedAnchor, role: "calibration" })).rejects.toThrow("campaign anchor changed");
});
