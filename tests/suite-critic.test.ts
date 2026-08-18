import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adjudicateSuiteCritique, assertSuiteApproved, runSuiteCritics } from "../skills/skill-eval/scripts/lib/suite-critic.ts";
import { writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import { readRunStatus } from "../skills/skill-eval/scripts/lib/status.ts";
import type { HostAdapter, HostRequest, HostResult } from "../skills/skill-eval/scripts/lib/types.ts";

class CriticAdapter implements HostAdapter {
  name = "codex" as const;
  request: HostRequest | null = null;
  fixtureText: string | null = null;
  schema: any = null;
  constructor(private verdict: "PASS" | "REVISE", private wrapped = false, private delayMs = 0) {}
  async execute(request: HostRequest): Promise<HostResult> {
    if (this.delayMs > 0) await Bun.sleep(this.delayMs);
    this.request = request;
    this.fixtureText = await readFile(join(request.cwd, "input", "fixtures", "case", "input.md"), "utf8");
    this.schema = JSON.parse(await readFile(request.outputSchemaPath!, "utf8"));
    const issues = this.verdict === "REVISE" ? [{ severity: "critical", issue: "The critic requests internal provenance beyond the terminal hypothesis.", fix: "Either narrow the hypothesis or reject the scope expansion with evidence." }] : [];
    const json = JSON.stringify({ verdict: this.verdict, reasoning: "The suite tests the terminal benefit against a discriminating baseline.", issues });
    const final = this.wrapped ? `I inspected the supplied evidence.\n\n\`\`\`json\n${json}\n\`\`\`` : json;
    await writeFile(request.eventPath, "{}"); await writeFile(request.stderrPath, ""); await writeFile(request.finalPath, final);
    return { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: final, duration_ms: 1, usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, event_path: request.eventPath, stderr_path: request.stderrPath, final_path: request.finalPath };
  }
}

class DiagnosticPassAdapter extends CriticAdapter {
  constructor() { super("PASS"); }
  override async execute(request: HostRequest): Promise<HostResult> {
    const result = await super.execute(request);
    const final = JSON.stringify({
      verdict: "PASS",
      reasoning: "The suite can support the hypothesis.",
      issues: [{ severity: "diagnostic", issue: "A missing optional artifact could cause a conservative false negative.", fix: "Preserve it when practical." }],
    });
    await writeFile(request.finalPath, final);
    return { ...result, final_text: final };
  }
}

async function fixture(measurementGoal?: string): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-critic-"));
  const authored = join(runDir, "versions", "authored"); await mkdir(authored, { recursive: true });
  await writeFile(join(authored, "SKILL.md"), "---\nname: demo\ndescription: demo\n---\n");
  await mkdir(join(runDir, "fixtures", "case"), { recursive: true });
  await writeFile(join(runDir, "fixtures", "case", "input.md"), "fixture evidence\n");
  await writeJson(join(runDir, "run.json"), { schema_version: 2, run_id: "r", run_dir: runDir, created_at: new Date().toISOString(), target_path: authored, repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["codex"], ...(measurementGoal ? { campaign: { campaign_dir: join(runDir, "campaign"), role: "calibration", measurement_goal: measurementGoal } } : {}), anchor: { kind: "none" }, versions: { authored: { path: authored, parent: null, created_at: new Date().toISOString() } }, hashes: { versions: { anchor: null, authored: "x" }, fixtures: {}, suite: "x" }, git: { initial_clean: true, initial_status: "", branch: null, head: null, target_tracked: false } });
  if (measurementGoal) {
    await writeJson(join(runDir, "campaign", "campaign.json"), {
      schema_version: 2,
      campaign_id: "campaign",
      campaign_dir: join(runDir, "campaign"),
      created_at: new Date().toISOString(),
      target_path: authored,
      skill_name: "demo",
      measurement_goal: measurementGoal,
      anchor: null,
      runs: [],
    });
  }
  await writeJson(join(runDir, "suite.json"), { schema_version: 2, claim_class: "effectiveness", environment: { fidelity: "isolated", external_state: [] }, skill_name: "demo", hypothesis: "better", evals: [{ id: "case", name: "Case", purpose: "improvement", severity: "quality", prompt: "Write a plan", expectations: [{ id: "quality", text: "The plan supports the decision", severity: "quality", evidence_role: "outcome" }] }] });
  return runDir;
}

test("effectiveness requires an independent passing suite critique", async () => {
  const runDir = await fixture();
  await expect(assertSuiteApproved(runDir)).rejects.toThrow("suite critique");
  await runSuiteCritics({ runDir, criticHosts: ["codex"], adapters: { codex: new CriticAdapter("REVISE") } });
  await expect(assertSuiteApproved(runDir)).rejects.toThrow("requires agent adjudication");
});

test("agent adjudication can reject an out-of-scope critic demand", async () => {
  const runDir = await fixture();
  await runSuiteCritics({ runDir, criticHosts: ["codex"], adapters: { codex: new CriticAdapter("REVISE") } });

  const adjudication = await adjudicateSuiteCritique(runDir, {
    schema_version: 2,
    summary: "The suite tests delivered output quality; exact internal provenance is not part of the hypothesis.",
    decisions: [{ critic_host: "codex", issue_index: 0, disposition: "rejected", rationale: "Repeated paired output comparison tests the confirmed terminal claim without asserting per-finding provenance." }],
  });

  expect(adjudication.approved).toBe(true);
  await expect(assertSuiteApproved(runDir)).resolves.toBeUndefined();
});

test("accepted and blocked critique findings still prevent execution", async () => {
  for (const disposition of ["accepted", "blocked"] as const) {
    const runDir = await fixture();
    await runSuiteCritics({ runDir, criticHosts: ["codex"], adapters: { codex: new CriticAdapter("REVISE") } });
    const adjudication = await adjudicateSuiteCritique(runDir, {
      schema_version: 2,
      summary: "The critic found a material threat to validity.",
      decisions: [{ critic_host: "codex", issue_index: 0, disposition, rationale: "The current suite cannot answer the hypothesis until this is resolved." }],
    });
    expect(adjudication.approved).toBe(false);
    await expect(assertSuiteApproved(runDir)).rejects.toThrow("requires revision or records a blocker");
  }
});

test("a critical critique finding cannot be waived as a limitation", async () => {
  const runDir = await fixture();
  await runSuiteCritics({ runDir, criticHosts: ["codex"], adapters: { codex: new CriticAdapter("REVISE") } });

  const adjudication = await adjudicateSuiteCritique(runDir, {
    schema_version: 2,
    summary: "The evaluator cannot prove the full confirmed claim.",
    decisions: [{ critic_host: "codex", issue_index: 0, disposition: "limitation", rationale: "The environment cannot observe the terminal benefit." }],
  });

  expect(adjudication.approved).toBe(false);
  await expect(assertSuiteApproved(runDir)).rejects.toThrow("critical limitation");
});

test("execution recomputes adjudication approval from dispositions", async () => {
  const runDir = await fixture();
  await runSuiteCritics({ runDir, criticHosts: ["codex"], adapters: { codex: new CriticAdapter("REVISE") } });
  await adjudicateSuiteCritique(runDir, {
    schema_version: 2,
    summary: "The issue requires revision.",
    decisions: [{ critic_host: "codex", issue_index: 0, disposition: "accepted", rationale: "The fixture is not discriminating." }],
  });
  const latestPath = join(runDir, "artifacts", "suite-adjudication-latest.json");
  const latest = JSON.parse(await readFile(latestPath, "utf8"));
  latest.adjudication.approved = true;
  await writeJson(latestPath, latest);

  await expect(assertSuiteApproved(runDir)).rejects.toThrow("approval is inconsistent");
});

test("a new critique invalidates an older adjudication", async () => {
  const runDir = await fixture();
  await runSuiteCritics({ runDir, criticHosts: ["codex"], adapters: { codex: new CriticAdapter("REVISE") } });
  await adjudicateSuiteCritique(runDir, {
    schema_version: 2,
    summary: "First critique reconciled.",
    decisions: [{ critic_host: "codex", issue_index: 0, disposition: "limitation", rationale: "The final report will narrow the claim." }],
  });
  await runSuiteCritics({ runDir, criticHosts: ["codex"], adapters: { codex: new CriticAdapter("REVISE") } });

  await expect(assertSuiteApproved(runDir)).rejects.toThrow("does not match the latest critique");
});

test("a passing independent critique unlocks effectiveness execution", async () => {
  const runDir = await fixture();
  const results = await runSuiteCritics({ runDir, criticHosts: ["codex"], adapters: { codex: new CriticAdapter("PASS") } });
  expect(results[0]?.verdict).toBe("PASS");
  const latest = JSON.parse(await readFile(join(runDir, "artifacts", "suite-critique-latest.json"), "utf8"));
  expect(await Bun.file(join(latest.critique_dir, "codex", "critique.json")).exists()).toBe(true);
  await expect(assertSuiteApproved(runDir)).resolves.toBeUndefined();
});

test("a passing critique may preserve non-blocking diagnostic notes", async () => {
  const runDir = await fixture();
  const results = await runSuiteCritics({ runDir, criticHosts: ["codex"], adapters: { codex: new DiagnosticPassAdapter() } });
  expect(results[0]).toMatchObject({ verdict: "PASS", valid: true });
  expect(results[0]?.issues).toHaveLength(1);
  await expect(assertSuiteApproved(runDir)).resolves.toBeUndefined();
});

test("critics receive frozen fixtures and a Codex-compatible output schema", async () => {
  const runDir = await fixture("Improve the user's plan quality without increasing unsupported claims.");
  const adapter = new CriticAdapter("PASS", true);
  const results = await runSuiteCritics({ runDir, criticHosts: ["codex"], adapters: { codex: adapter } });
  expect(results[0]?.valid).toBe(true);
  expect(adapter.request).not.toBeNull();
  expect(adapter.fixtureText).toBe("fixture evidence\n");
  expect(adapter.schema.properties.issues.items.properties.issue.type).toBe("string");
  expect(adapter.request!.prompt).toContain("Prepared behavior hosts: codex");
  expect(adapter.request!.prompt).toContain("Confirmed campaign measurement goal: Improve the user's plan quality without increasing unsupported claims.");
  expect(adapter.request!.prompt).toContain("Draft suite hypothesis: better");
  const latest = JSON.parse(await readFile(join(runDir, "artifacts", "suite-critique-latest.json"), "utf8"));
  expect(latest.campaign_measurement_goal).toBe("Improve the user's plan quality without increasing unsupported claims.");
});

test("a failed critic attempt can be retried without deleting evidence", async () => {
  const runDir = await fixture();
  await runSuiteCritics({ runDir, criticHosts: ["codex"], adapters: { codex: new CriticAdapter("REVISE") } });
  const first = JSON.parse(await readFile(join(runDir, "artifacts", "suite-critique-latest.json"), "utf8"));
  await runSuiteCritics({ runDir, criticHosts: ["codex"], adapters: { codex: new CriticAdapter("PASS") } });
  const second = JSON.parse(await readFile(join(runDir, "artifacts", "suite-critique-latest.json"), "utf8"));
  expect(second.critique_dir).not.toBe(first.critique_dir);
  expect(await Bun.file(join(first.critique_dir, "results.json")).exists()).toBe(true);
  await expect(assertSuiteApproved(runDir)).resolves.toBeUndefined();
});

test("suite critique is observable through run status while it is active", async () => {
  const runDir = await fixture();
  const running = runSuiteCritics({ runDir, criticHosts: ["codex"], adapters: { codex: new CriticAdapter("PASS", false, 40) } });
  await Bun.sleep(10);

  const status = await readRunStatus(runDir);
  expect(status.status).toBe("running");
  expect(status.operations[0]).toMatchObject({ kind: "suite-critique", phase: "reviewing-eval-design", status: "active", planned_units: 1 });
  await running;
  expect((await readRunStatus(runDir)).status).toBe("complete");
});
