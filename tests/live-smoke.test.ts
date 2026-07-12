import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gradeMatrix } from "../skills/skill-eval/scripts/lib/assertions.ts";
import { runMatrix } from "../skills/skill-eval/scripts/lib/executor.ts";
import { preflight } from "../skills/skill-eval/scripts/lib/preflight.ts";
import { runTriggerSuite } from "../skills/skill-eval/scripts/lib/triggers.ts";
import { prepareRun } from "../skills/skill-eval/scripts/lib/workspace.ts";
import type { HostName } from "../skills/skill-eval/scripts/lib/types.ts";

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

test.skipIf(process.env.SKILL_EVAL_LIVE !== "1")("runs an uninstalled skill through every available host", async () => {
  const repo = await mkdtemp(join(tmpdir(), "skill-eval-live-"));
  const target = join(repo, "skills", "live-probe");
  const suiteDir = join(repo, "eval-authoring");
  await mkdir(target, { recursive: true });
  await mkdir(suiteDir, { recursive: true });
  await writeFile(join(target, "SKILL.md"), `---
name: live-probe
description: Use when asked to create the live probe result.
---

# Live Probe

Write \`outputs/live-probe.txt\` containing exactly \`skill-eval-live-ok\`.
`);
  const suitePath = join(suiteDir, "suite.json");
  await writeFile(suitePath, JSON.stringify({
    schema_version: 2,
    claim_class: "generalization",
    environment: { fidelity: "isolated", external_state: [] },
    skill_name: "live-probe",
    hypothesis: "The supplied skill creates the required inspectable artifact.",
    evals: [{
      id: "probe",
      name: "Live probe",
      purpose: "improvement",
      severity: "critical",
      prompt: "Create the live probe result.",
      expectations: [{ id: "content", text: "probe contains sentinel", severity: "critical", evidence_role: "outcome", check: { type: "file_contains", path: "live-probe.txt", value: "skill-eval-live-ok" } }],
    }],
    trigger_queries: [{ id: "probe-trigger", query: "Please create the live probe result", should_trigger: true }],
  }));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "Skill Eval"]);
  git(repo, ["config", "user.email", "skill-eval@example.invalid"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "live probe"]);

  const report = await preflight(target, { invokingHost: "codex", requestedHosts: ["claude", "codex"] });
  const hosts = (["claude", "codex"] as HostName[]).filter((host) => report.hosts[host].ready);
  expect(hosts.length).toBeGreaterThan(0);
  const state = await prepareRun({ targetPath: target, suitePath, hosts, invokingHost: "codex" });
  const records = await runMatrix({ runDir: state.run_dir, versions: ["authored"], hosts, timeoutMs: 300_000 });
  const grades = await gradeMatrix(state.run_dir);
  const triggers = await runTriggerSuite({ runDir: state.run_dir, version: "authored", hosts, repetitions: 1, timeoutMs: 120_000 });

  expect(records).toHaveLength(hosts.length);
  expect(grades.every((grade) => grade.summary.critical_failed === 0)).toBe(true);
  expect(triggers).toHaveLength(hosts.length);
  expect(triggers.every((result) => result.triggered)).toBe(true);
}, 700_000);
