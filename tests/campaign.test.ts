import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCampaignContext, createCampaign, listCampaigns, loadCampaign, recordCampaignCheckpoint, registerCampaignRun } from "../skills/skill-eval/scripts/lib/campaign.ts";
import { hashTree, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
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
    schema_version: 1, run_id: "run-1", run_dir: runDir, created_at: now, target_path: target, repo_root: root, skill_name: "demo",
    invoking_host: "codex", requested_hosts: ["claude", "codex"], anchor: { kind: "none" }, versions: { authored: { path: authored, parent: null, created_at: now } },
    hashes: { versions: { anchor: null, authored: await hashTree(authored) }, fixtures: {}, suite: "suite" },
    git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: false },
  };
  await writeJson(join(runDir, "run.json"), state);
  await writeJson(join(runDir, "suite.json"), { schema_version: 1, skill_name: "demo", hypothesis: "better discovery", evals: [], trigger_queries: [{ id: "adjacent", query: "adjacent", should_trigger: false }] });
  const trigger = (host: "claude" | "codex", repetition: number, triggered: boolean): TriggerResult => ({
    schema_version: 1, attempt_id: "calibration", partition: "training", created_at: now, host, version: "authored", query_id: "adjacent",
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
