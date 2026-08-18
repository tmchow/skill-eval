import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import { estimateCalls } from "../skills/skill-eval/scripts/lib/planning.ts";

test("computes exact compare calls from the frozen suite", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-plan-"));
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 2, claim_class: "effectiveness", environment: { fidelity: "isolated", external_state: [] }, skill_name: "demo", hypothesis: "better",
    evals: [
      { id: "quality", name: "Quality", purpose: "improvement", severity: "critical", prompt: "task", expectations: [{ id: "useful", text: "useful", severity: "critical", evidence_role: "outcome" }] },
      { id: "restraint", name: "Restraint", purpose: "restraint", severity: "critical", prompt: "task", expectations: [{ id: "exit", text: "exits", severity: "critical", evidence_role: "outcome", check: { type: "exit_success" } }] },
    ],
  });
  const estimate = await estimateCalls({ suitePath: join(runDir, "suite.json"), workflow: "compare", versions: ["anchor", "authored"], hosts: ["claude"], judgeHosts: ["claude", "codex"], criticHosts: ["claude", "codex"], repetitions: 1 });
  expect(estimate.calls).toEqual({ critics: 2, behavior: 4, qualitative_graders: 4, blind_judges: 2, total: 12 });
});

test("counts candidate-only qualitative mechanism grading without scheduling a blind pair", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-plan-scoped-"));
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 2, claim_class: "effectiveness", environment: { fidelity: "isolated", external_state: [] }, skill_name: "demo", hypothesis: "better",
    evals: [{
      id: "candidate", name: "Candidate", purpose: "improvement", severity: "quality", prompt: "task",
      expectations: [
        { id: "complete", text: "the task completes", severity: "quality", evidence_role: "outcome", check: { type: "exit_success" } },
        { id: "candidate-only", text: "candidate emits a diagnostic artifact", severity: "quality", evidence_role: "mechanism", version_scope: "candidate" },
      ],
    }],
  });

  const estimate = await estimateCalls({ suitePath: join(runDir, "suite.json"), workflow: "compare", versions: ["anchor", "authored"], hosts: ["claude"], judgeHosts: ["claude", "codex"], criticHosts: ["claude", "codex"], repetitions: 1 });

  expect(estimate.calls).toEqual({ critics: 2, behavior: 2, qualitative_graders: 2, blind_judges: 0, total: 6 });
});

test("rejects a compare estimate for conformance before the user confirms an impossible plan", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-plan-conformance-"));
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 2, claim_class: "conformance", skill_name: "demo", hypothesis: "follows the route",
    evals: [{ id: "route", name: "Route", purpose: "improvement", severity: "critical", prompt: "task", expectations: [{ id: "called", text: "calls the route", severity: "critical", evidence_role: "mechanism", check: { type: "tool_called", value: "route.sh" } }] }],
  });

  await expect(estimateCalls({ suitePath: join(runDir, "suite.json"), workflow: "compare", versions: ["anchor", "authored"], hosts: ["claude"], judgeHosts: ["claude"] })).rejects.toThrow("workflow run, not compare");
});

test("estimates authored-only cross-host conformance and any required graders", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-plan-conformance-run-"));
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 2, claim_class: "conformance", skill_name: "demo", hypothesis: "follows the route",
    evals: [{ id: "route", name: "Route", purpose: "improvement", severity: "critical", prompt: "task", expectations: [
      { id: "called", text: "calls the route", severity: "critical", evidence_role: "mechanism", version_scope: "candidate", check: { type: "tool_called", value: "route.sh" } },
      { id: "no-question", text: "does not ask a question", severity: "critical", evidence_role: "outcome" },
    ] }],
  });

  const estimate = await estimateCalls({ suitePath: join(runDir, "suite.json"), workflow: "run", versions: ["authored"], hosts: ["claude", "codex"], judgeHosts: ["claude"] });
  expect(estimate.calls).toEqual({ critics: 0, behavior: 2, qualitative_graders: 2, blind_judges: 0, total: 4 });
});

test("keeps deterministic authored-only cross-host conformance to one call per host", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-plan-conformance-objective-"));
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 2, claim_class: "conformance", skill_name: "demo", hypothesis: "follows the route",
    evals: [{ id: "route", name: "Route", purpose: "improvement", severity: "critical", prompt: "task", expectations: [
      { id: "called", text: "calls the route", severity: "critical", evidence_role: "mechanism", version_scope: "candidate", check: { type: "tool_called", value: "route.sh" } },
    ] }],
  });

  const estimate = await estimateCalls({ suitePath: join(runDir, "suite.json"), workflow: "run", versions: ["authored"], hosts: ["claude", "codex"] });
  expect(estimate.calls).toEqual({ critics: 0, behavior: 2, qualitative_graders: 0, blind_judges: 0, total: 2 });
});

test("requires grader hosts when a run estimate includes qualitative expectations", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-plan-run-grader-"));
  await writeJson(join(runDir, "suite.json"), {
    schema_version: 2, claim_class: "conformance", skill_name: "demo", hypothesis: "follows the route",
    evals: [{ id: "route", name: "Route", purpose: "improvement", severity: "critical", prompt: "task", expectations: [{ id: "quality", text: "is clear", severity: "quality", evidence_role: "outcome" }] }],
  });

  await expect(estimateCalls({ suitePath: join(runDir, "suite.json"), workflow: "run", versions: ["authored"], hosts: ["claude"] })).rejects.toThrow("requires at least one judge host");
});
