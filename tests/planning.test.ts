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
