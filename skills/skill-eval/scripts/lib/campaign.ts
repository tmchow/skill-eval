import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hashValue, readJson, reserveArtifactDir, writeJson } from "./json.ts";
import { readOperations } from "./operations.ts";
import { readSkill, resolveSkillTarget } from "./skill.ts";
import { summarizeCrossHostTriggers, summarizeTriggers } from "./triggers.ts";
import type { BenchmarkArtifact, RunState, TriggerResult } from "./types.ts";

export type CampaignRunRole = "calibration" | "optimization" | "certification" | "confirmation" | "other";

export interface CampaignRunLink {
  run_id: string;
  run_dir: string;
  role: CampaignRunRole;
  registered_at: string;
}

export interface CampaignManifest {
  schema_version: 1;
  campaign_id: string;
  campaign_dir: string;
  created_at: string;
  target_path: string;
  skill_name: string;
  measurement_goal: string;
  runs: CampaignRunLink[];
}

export interface CampaignCheckpointInput {
  stage: string;
  summary: string;
  established: string[];
  cross_model: string[];
  limitations: string[];
  next_adjustment: string | null;
  evidence_run_ids: string[];
}

export interface CampaignCheckpoint extends CampaignCheckpointInput {
  schema_version: 1;
  checkpoint_id: string;
  created_at: string;
  content_hash: string;
}

function identifier(value: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error(`${label} must contain only letters, digits, dot, underscore, or hyphen`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${label} must be an array of non-empty strings`);
  return value.map((item) => item.trim());
}

export function validateCampaignRole(value: string): CampaignRunRole {
  if (!["calibration", "optimization", "certification", "confirmation", "other"].includes(value)) throw new Error(`invalid campaign run role: ${value}`);
  return value as CampaignRunRole;
}

export async function createCampaign(options: { targetPath: string; measurementGoal: string; cwd?: string; campaignRoot?: string; campaignId?: string }): Promise<CampaignManifest> {
  const targetPath = await realpath(await resolveSkillTarget(options.targetPath, options.cwd));
  const skill = await readSkill(targetPath);
  const campaignId = identifier(options.campaignId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`, "campaign id");
  const campaignRoot = resolve(options.campaignRoot ?? join("/tmp", "skill-eval", skill.name, "campaigns"));
  const campaignDir = join(campaignRoot, campaignId);
  await reserveArtifactDir(campaignDir);
  await mkdir(join(campaignDir, "checkpoints"), { recursive: true });
  const manifest: CampaignManifest = {
    schema_version: 1,
    campaign_id: campaignId,
    campaign_dir: campaignDir,
    created_at: new Date().toISOString(),
    target_path: targetPath,
    skill_name: skill.name,
    measurement_goal: text(options.measurementGoal, "measurement goal"),
    runs: [],
  };
  await writeJson(join(campaignDir, "campaign.json"), manifest);
  return manifest;
}

export async function loadCampaign(campaignDirInput: string): Promise<CampaignManifest> {
  const campaignDir = resolve(campaignDirInput);
  const manifest = await readJson<CampaignManifest>(join(campaignDir, "campaign.json"));
  if (manifest.schema_version !== 1 || resolve(manifest.campaign_dir) !== campaignDir) throw new Error("invalid campaign manifest");
  return manifest;
}

export async function listCampaigns(options: { targetPath: string; cwd?: string; campaignRoot?: string }): Promise<Array<Pick<CampaignManifest, "campaign_id" | "campaign_dir" | "created_at" | "measurement_goal" | "runs">>> {
  const targetPath = await realpath(await resolveSkillTarget(options.targetPath, options.cwd));
  const skill = await readSkill(targetPath);
  const root = resolve(options.campaignRoot ?? join("/tmp", "skill-eval", skill.name, "campaigns"));
  const campaigns: CampaignManifest[] = [];
  const glob = new Bun.Glob("*/campaign.json");
  try {
    for await (const path of glob.scan({ cwd: root, absolute: true })) {
      const campaign = await readJson<CampaignManifest>(path);
      if (campaign.target_path === targetPath && campaign.skill_name === skill.name) campaigns.push(campaign);
    }
  } catch { /* no campaigns yet */ }
  return campaigns.sort((a, b) => b.created_at.localeCompare(a.created_at)).map((item) => ({
    campaign_id: item.campaign_id,
    campaign_dir: item.campaign_dir,
    created_at: item.created_at,
    measurement_goal: item.measurement_goal,
    runs: item.runs,
  }));
}

export async function validateCampaignTarget(campaignDir: string, targetPath: string, skillName: string): Promise<CampaignManifest> {
  const campaign = await loadCampaign(campaignDir);
  const target = await realpath(resolve(targetPath));
  if (campaign.target_path !== target || campaign.skill_name !== skillName) throw new Error("campaign target does not match prepared skill");
  return campaign;
}

export async function registerCampaignRun(campaignDir: string, options: { runDir: string; role: string }): Promise<CampaignManifest> {
  const campaign = await loadCampaign(campaignDir);
  const state = await readJson<RunState>(join(resolve(options.runDir), "run.json"));
  await validateCampaignTarget(campaign.campaign_dir, state.target_path, state.skill_name);
  const role = validateCampaignRole(options.role);
  const existing = campaign.runs.find((item) => item.run_id === state.run_id);
  if (existing) {
    if (existing.run_dir !== state.run_dir || existing.role !== role) throw new Error(`campaign run id already linked differently: ${state.run_id}`);
    return campaign;
  }
  campaign.runs.push({ run_id: state.run_id, run_dir: state.run_dir, role, registered_at: new Date().toISOString() });
  await writeJson(join(campaign.campaign_dir, "campaign.json"), campaign);
  return campaign;
}

export async function recordCampaignCheckpoint(campaignDir: string, input: CampaignCheckpointInput): Promise<CampaignCheckpoint> {
  const campaign = await loadCampaign(campaignDir);
  const normalized: CampaignCheckpointInput = {
    stage: text(input.stage, "checkpoint stage"),
    summary: text(input.summary, "checkpoint summary"),
    established: stringArray(input.established, "checkpoint established"),
    cross_model: stringArray(input.cross_model, "checkpoint cross_model"),
    limitations: stringArray(input.limitations, "checkpoint limitations"),
    next_adjustment: input.next_adjustment === null ? null : text(input.next_adjustment, "checkpoint next_adjustment"),
    evidence_run_ids: stringArray(input.evidence_run_ids, "checkpoint evidence_run_ids"),
  };
  const knownRuns = new Set(campaign.runs.map((item) => item.run_id));
  for (const runId of normalized.evidence_run_ids) if (!knownRuns.has(runId)) throw new Error(`unknown campaign run: ${runId}`);
  const checkpointId = `checkpoint-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const unsigned = { schema_version: 1 as const, checkpoint_id: checkpointId, created_at: new Date().toISOString(), ...normalized };
  const checkpoint: CampaignCheckpoint = { ...unsigned, content_hash: hashValue(unsigned) };
  await writeJson(join(campaign.campaign_dir, "checkpoints", `${checkpointId}.json`), checkpoint);
  return checkpoint;
}

async function loadCheckpoints(campaignDir: string): Promise<CampaignCheckpoint[]> {
  const root = join(campaignDir, "checkpoints");
  const checkpoints: CampaignCheckpoint[] = [];
  const glob = new Bun.Glob("*.json");
  for await (const path of glob.scan({ cwd: root, absolute: true })) {
    const checkpoint = await readJson<CampaignCheckpoint>(path);
    const { content_hash: contentHash, ...unsigned } = checkpoint;
    if (hashValue(unsigned) !== contentHash) throw new Error(`campaign checkpoint hash mismatch: ${checkpoint.checkpoint_id}`);
    checkpoints.push(checkpoint);
  }
  return checkpoints.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function optionalJson<T>(path: string): Promise<T | null> {
  try { return await readJson<T>(path); } catch { return null; }
}

function triggerAttempts(results: TriggerResult[]) {
  const groups = new Map<string, TriggerResult[]>();
  for (const result of results) {
    const key = `${result.attempt_id}\0${result.version}\0${result.partition}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return [...groups.values()].map((selected) => ({
    attempt_id: selected[0]!.attempt_id,
    version: selected[0]!.version,
    partition: selected[0]!.partition,
    records: selected.length,
    metrics: summarizeTriggers(selected),
    cross_model: summarizeCrossHostTriggers(selected),
  }));
}

async function runContext(link: CampaignRunLink) {
  const state = await readJson<RunState>(join(link.run_dir, "run.json"));
  const triggers = await optionalJson<TriggerResult[]>(join(link.run_dir, "triggers.json")) ?? [];
  const scriptChecks = await optionalJson<Array<{ check_id: string; passed: boolean }>>(join(link.run_dir, "script-checks.json")) ?? [];
  const benchmarks = await optionalJson<BenchmarkArtifact[]>(join(link.run_dir, "benchmarks.json")) ?? [];
  const description = await optionalJson<any>(join(link.run_dir, "description-optimization.json"));
  const behavior = await optionalJson<any>(join(link.run_dir, "optimization.json"));
  return {
    run_id: state.run_id,
    run_dir: state.run_dir,
    role: link.role,
    created_at: state.created_at,
    anchor: state.anchor,
    requested_hosts: state.requested_hosts,
    versions: Object.keys(state.versions),
    trigger_attempts: triggerAttempts(triggers),
    script_checks: {
      total: scriptChecks.length,
      passed: scriptChecks.filter((item) => item.passed).length,
      failed: scriptChecks.filter((item) => !item.passed).length,
      checks: scriptChecks.map((item) => ({ check_id: item.check_id, passed: item.passed })),
    },
    benchmarks: benchmarks.map((item) => ({ comparison_id: item.comparison_id, comparison: item.comparison, verdict: item.verdict, gates: item.gates, partitions: item.partitions, preferences: item.preferences, cross_model: item.cross_model, evidence_hash: item.evidence_hash })),
    description_optimization: description ? {
      status: description.status, best_version: description.best_version, best_holdout_score: description.best_holdout_score,
      history: (description.history ?? []).map((item: any) => ({ iteration: item.iteration, version: item.version, training: item.training, holdout: item.holdout, selected: item.selected, hypothesis: item.hypothesis, takeaway: item.takeaway, cross_model: item.cross_model })),
    } : null,
    behavior_optimization: behavior ? {
      status: behavior.status, incumbent: behavior.incumbent,
      iterations: (behavior.iterations ?? []).map((item: any) => ({ iteration: item.iteration, candidate: item.candidate, accepted: item.accepted, converged: item.converged, hypothesis: item.hypothesis, takeaway: item.takeaway, cross_model: item.cross_model, decision_id: item.decision_id })),
    } : null,
    operations: (await readOperations(link.run_dir)).map((item) => ({ operation_id: item.operation_id, kind: item.kind, status: item.status, phase: item.phase, completed_units: item.completed_units, planned_units: item.planned_units, iteration: item.iteration, current_candidate: item.current_candidate, best_candidate: item.best_candidate, stop_reason: item.stop_reason, message: item.message, usage: { model_calls: item.usage.model_calls } })),
  };
}

export async function buildCampaignContext(campaignDir: string) {
  const campaign = await loadCampaign(campaignDir);
  return {
    schema_version: 1 as const,
    generated_at: new Date().toISOString(),
    campaign: {
      campaign_id: campaign.campaign_id,
      campaign_dir: campaign.campaign_dir,
      target_path: campaign.target_path,
      skill_name: campaign.skill_name,
      measurement_goal: campaign.measurement_goal,
      created_at: campaign.created_at,
    },
    runs: await Promise.all(campaign.runs.map(runContext)),
    checkpoints: await loadCheckpoints(campaign.campaign_dir),
  };
}
