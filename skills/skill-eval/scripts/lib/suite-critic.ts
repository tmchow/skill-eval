import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mapLimit } from "./async.ts";
import { createHostAdapters } from "./hosts.ts";
import { copyTree, hashValue, parseJsonObject, readJson, reserveArtifactDir, writeJson } from "./json.ts";
import { createOperation, instrumentAdapters } from "./operations.ts";
import { loadRun, loadSuite, verifyRunIntegrity } from "./workspace.ts";
import { loadCampaign, loadCaseRetirements } from "./campaign.ts";
import type { HostAdapter, HostName, Severity, SuiteCritique, SuiteCritiqueAdjudication, SuiteCritiqueAdjudicationInput } from "./types.ts";

export interface SuiteCriticOptions {
  runDir: string;
  criticHosts: HostName[];
  adapters?: Partial<Record<HostName, HostAdapter>>;
  timeoutMs?: number;
  models?: Partial<Record<HostName, string>>;
  reasoningEfforts?: Partial<Record<HostName, string>>;
}

function parse(raw: string): Pick<SuiteCritique, "verdict" | "reasoning" | "issues"> | null {
  const value = parseJsonObject(raw);
  if (!value || !["PASS", "REVISE"].includes(value.verdict) || typeof value.reasoning !== "string" || !Array.isArray(value.issues)) return null;
  const valid = value.issues.every((item: any) => ["critical", "quality", "diagnostic"].includes(item?.severity) && typeof item.issue === "string" && typeof item.fix === "string");
  const materialPassIssue = value.verdict === "PASS" && value.issues.some((item: any) => item.severity !== "diagnostic");
  if (!valid || (value.verdict === "REVISE" && value.issues.length === 0) || materialPassIssue) return null;
  return value as Pick<SuiteCritique, "verdict" | "reasoning" | "issues">;
}

interface LatestCritique {
  critique_dir: string;
  campaign_measurement_goal?: string | null;
  results: SuiteCritique[];
}

function dispositionApproves(issue: SuiteCritique["issues"][number], disposition: SuiteCritiqueAdjudicationInput["decisions"][number]["disposition"]): boolean {
  return disposition === "rejected" || (disposition === "limitation" && issue.severity !== "critical");
}

async function latestCritique(runDir: string): Promise<LatestCritique> {
  return readJson<LatestCritique>(join(resolve(runDir), "artifacts", "suite-critique-latest.json"));
}

export async function adjudicateSuiteCritique(runDir: string, input: SuiteCritiqueAdjudicationInput): Promise<SuiteCritiqueAdjudication> {
  await verifyRunIntegrity(resolve(runDir));
  if (input.schema_version !== 2 || typeof input.summary !== "string" || !input.summary.trim() || !Array.isArray(input.decisions)) {
    throw new Error("suite critique adjudication requires schema_version 2, a summary, and decisions");
  }
  const latest = await latestCritique(runDir);
  if (latest.results.length === 0 || latest.results.some((item) => !item.valid)) throw new Error("invalid critic evidence cannot be adjudicated");
  const issues = latest.results.flatMap((critique) => critique.issues.map((issue, issueIndex) => ({ critique, issue, issueIndex, key: `${critique.critic_host}:${issueIndex}` })));
  const decisions = new Map<string, SuiteCritiqueAdjudicationInput["decisions"][number]>();
  for (const decision of input.decisions) {
    const key = `${decision.critic_host}:${decision.issue_index}`;
    if (decisions.has(key)) throw new Error(`duplicate critique decision: ${key}`);
    if (!Number.isInteger(decision.issue_index) || decision.issue_index < 0 || !["accepted", "rejected", "limitation", "blocked"].includes(decision.disposition) || typeof decision.rationale !== "string" || !decision.rationale.trim()) {
      throw new Error(`invalid critique decision: ${key}`);
    }
    decisions.set(key, decision);
  }
  const expected = new Set(issues.map((item) => item.key));
  if (decisions.size !== expected.size || [...decisions.keys()].some((key) => !expected.has(key))) {
    throw new Error("adjudication must disposition every issue from the latest critique exactly once");
  }
  const approved = issues.every(({ key, issue }) => dispositionApproves(issue, decisions.get(key)!.disposition));
  const adjudication: SuiteCritiqueAdjudication = {
    ...input,
    critique_hash: hashValue(latest.results),
    approved,
    created_at: new Date().toISOString(),
  };
  const root = join(resolve(runDir), "artifacts", "suite-adjudications", randomUUID());
  await reserveArtifactDir(root);
  await writeJson(join(root, "adjudication.json"), adjudication);
  await writeJson(join(resolve(runDir), "artifacts", "suite-adjudication-latest.json"), { adjudication_dir: root, adjudication });
  return adjudication;
}

async function directoryExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

export async function runSuiteCritics(options: SuiteCriticOptions): Promise<SuiteCritique[]> {
  if (options.criticHosts.length === 0) throw new Error("suite critique requires at least one critic host");
  const runDir = resolve(options.runDir);
  await verifyRunIntegrity(runDir);
  const suite = await loadSuite(runDir);
  if (suite.claim_class === "conformance") return [];
  const state = await loadRun(runDir);
  const campaign = state.campaign ? await loadCampaign(state.campaign.campaign_dir) : null;
  const campaignGoal = campaign?.measurement_goal ?? null;
  const priorSuites = campaign
    ? await Promise.all(campaign.runs.filter((item) => item.run_id !== state.run_id).map(async (item) => ({
      run_id: item.run_id,
      role: item.role,
      suite_hash: item.suite_hash,
      case_ids: item.case_ids,
      trigger_ids: item.trigger_ids,
      validation_visibility: item.validation_visibility,
      suite: await readJson(item.suite_path),
    })))
    : [];
  const retirements = campaign ? await loadCaseRetirements(campaign.campaign_dir) : [];
  const critiqueRoot = join(runDir, "artifacts", "suite-critiques", randomUUID());
  await reserveArtifactDir(critiqueRoot);
  const instructions = await readFile(resolve(import.meta.dir, "../../references/agents/suite-critic.md"), "utf8");
  const criticHosts = [...new Set(options.criticHosts)];
  const operation = await createOperation(runDir, { kind: "suite-critique", phase: "reviewing-eval-design", planned_units: criticHosts.length });
  const adapters = instrumentAdapters({ ...createHostAdapters(), ...options.adapters }, operation);
  const scratch = await mkdtemp(join(tmpdir(), "skill-eval-suite-critic-"));
  let results: SuiteCritique[] = [];
  try {
    results = await mapLimit(criticHosts, 2, async (criticHost) => {
      const workDir = join(scratch, criticHost); await mkdir(workDir, { recursive: true });
      const inputDir = join(workDir, "input"); await mkdir(inputDir, { recursive: true });
      await copyTree(state.versions.authored!.path, join(inputDir, "current-skill"));
      if (state.versions.anchor) await copyTree(state.versions.anchor.path, join(inputDir, "baseline-skill"));
      const fixturesDir = join(runDir, "fixtures");
      if (await directoryExists(fixturesDir)) await copyTree(fixturesDir, join(inputDir, "fixtures"));
      const schemaPath = join(workDir, "critique.schema.json");
      await writeJson(schemaPath, {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["PASS", "REVISE"] },
          reasoning: { type: "string" },
          issues: {
            type: "array",
            items: {
              type: "object",
              properties: {
                severity: { type: "string", enum: ["critical", "quality", "diagnostic"] },
                issue: { type: "string" },
                fix: { type: "string" },
              },
              required: ["severity", "issue", "fix"],
              additionalProperties: false,
            },
          },
        },
        required: ["verdict", "reasoning", "issues"],
        additionalProperties: false,
      });
      const baseline = state.anchor.kind === "none" ? "No-skill baseline." : `Previous skill snapshot from ${state.anchor.ref}.`;
      const prompt = `${instructions.trim()}\n\nClaim class: ${suite.claim_class}\nConfirmed campaign measurement goal: ${campaignGoal ?? "Not recorded; use the draft hypothesis as the scope authority."}\nDraft suite hypothesis: ${suite.hypothesis}\nBaseline: ${baseline}\nPrepared behavior hosts: ${state.requested_hosts.join(", ")}\nCurrent skill: ${join(inputDir, "current-skill")}\nBaseline skill when present: ${join(inputDir, "baseline-skill")}\nFixtures: ${join(inputDir, "fixtures")}\nFrozen suite:\n${JSON.stringify(suite, null, 2)}\nPrior campaign suites:\n${JSON.stringify(priorSuites, null, 2)}\nCase retirements:\n${JSON.stringify(retirements, null, 2)}\n\nRead the supplied skill, fixture, and campaign-history inputs before deciding. Reject changed goals, weakened prior cases, unexplained removals, mechanism substitution for terminal outcomes, or treatment-identifying metadata that should be symmetrically projected. Return only JSON: {verdict:PASS|REVISE, reasoning, issues:[{severity:critical|quality|diagnostic,issue,fix}]}.`;
      const eventPath = join(workDir, "events.jsonl"); const stderrPath = join(workDir, "stderr.txt"); const finalPath = join(workDir, "final.json");
      const hostResult = await adapters[criticHost]!.execute({ cwd: workDir, prompt, eventPath, stderrPath, finalPath, outputSchemaPath: schemaPath, timeoutMs: options.timeoutMs ?? 300_000, model: options.models?.[criticHost], reasoningEffort: options.reasoningEfforts?.[criticHost], role: "critic", capabilities: ["artifact-read", "suite-inspection"] });
      const parsed = parse(hostResult.final_text);
      let failure = "Critic output was invalid.";
      if (hostResult.exit_code !== 0) {
        const stderr = await readFile(stderrPath, "utf8").catch(() => "");
        const events = await readFile(eventPath, "utf8").catch(() => "");
        failure = `Critic host failed with exit ${hostResult.exit_code}: ${(stderr || events || "no diagnostic output").trim().slice(0, 1_000)}`;
      }
      const result: SuiteCritique = { schema_version: 2, critic_host: criticHost, verdict: parsed?.verdict ?? "REVISE", reasoning: parsed?.reasoning ?? failure, issues: parsed?.issues ?? [{ severity: "critical" as Severity, issue: failure, fix: "Correct the critic host or response contract, then run the critique again." }], valid: parsed !== null && hostResult.exit_code === 0, created_at: new Date().toISOString(), runtime_profile: hostResult.runtime_profile };
      await writeJson(join(workDir, "critique.json"), result);
      await copyTree(workDir, join(critiqueRoot, criticHost));
      return result;
    });
  } catch (error) {
    await operation.fail(error);
    throw error;
  } finally { await rm(scratch, { recursive: true, force: true }); }
  try {
    await writeJson(join(critiqueRoot, "results.json"), results);
    await writeJson(join(runDir, "artifacts", "suite-critique-latest.json"), { critique_dir: critiqueRoot, campaign_measurement_goal: campaignGoal, results });
    await operation.complete(results.every((item) => item.valid && item.verdict === "PASS") ? "approved" : "revision-required");
  } catch (error) {
    await operation.fail(error);
    throw error;
  }
  return results;
}

export async function assertSuiteApproved(runDir: string): Promise<void> {
  const suite = await loadSuite(runDir);
  if (suite.claim_class === "conformance") return;
  let critiques: SuiteCritique[];
  try { critiques = (await latestCritique(runDir)).results; }
  catch { throw new Error("effectiveness and generalization execution requires an independent passing suite critique"); }
  if (critiques.length === 0 || critiques.some((item) => !item.valid)) throw new Error("the independent suite critique is invalid and cannot be bypassed");
  if (critiques.every((item) => item.verdict === "PASS")) return;
  let adjudication: SuiteCritiqueAdjudication;
  try { adjudication = (await readJson<{ adjudication: SuiteCritiqueAdjudication }>(join(resolve(runDir), "artifacts", "suite-adjudication-latest.json"))).adjudication; }
  catch { throw new Error("the independent suite critique requires agent adjudication before execution"); }
  if (adjudication.critique_hash !== hashValue(critiques)) throw new Error("suite critique adjudication does not match the latest critique");
  const issues = critiques.flatMap((critique) => critique.issues.map((issue, issueIndex) => ({ issue, key: `${critique.critic_host}:${issueIndex}` })));
  const expectedIssues = new Set(issues.map(({ key }) => key));
  const decisions = new Map(adjudication.decisions.map((decision) => [`${decision.critic_host}:${decision.issue_index}`, decision]));
  if (decisions.size !== expectedIssues.size || [...decisions.keys()].some((key) => !expectedIssues.has(key))) {
    throw new Error("suite critique adjudication no longer covers the latest issues");
  }
  const approved = issues.every(({ key, issue }) => dispositionApproves(issue, decisions.get(key)!.disposition));
  if (adjudication.approved !== approved) throw new Error("suite critique adjudication approval is inconsistent with its dispositions");
  if (issues.some(({ key, issue }) => issue.severity === "critical" && decisions.get(key)!.disposition === "limitation")) {
    throw new Error("a critical limitation prevents the suite from supporting the confirmed claim");
  }
  if (!approved) throw new Error("suite critique adjudication requires revision or records a blocker");
}
