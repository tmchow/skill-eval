import { expect, test } from "bun:test";
import type { EvalSuite, RunState } from "../skills/skill-eval/scripts/lib/types.ts";
import { assertComparisonValidity, assertConfirmationValidity } from "../skills/skill-eval/scripts/lib/validity.ts";

const suite = (claimClass: EvalSuite["claim_class"]): EvalSuite => ({
  schema_version: 2,
  claim_class: claimClass,
  skill_name: "demo",
  hypothesis: "The skill improves the result.",
  evals: [{
    id: "case", name: "Case", purpose: "improvement", severity: "quality", prompt: "Do the task.",
    expectations: [{ id: "quality", text: "The result is useful.", severity: "quality", evidence_role: "outcome" }],
  }, ...(claimClass === "generalization" ? [{
    id: "validation", name: "Validation", purpose: "regression" as const, severity: "quality" as const, prompt: "Do a related task.", validation: true,
    expectations: [{ id: "quality", text: "The result remains useful.", severity: "quality" as const, evidence_role: "outcome" as const }],
  }] : [])],
});

const state = (anchor: RunState["anchor"]): RunState => ({
  schema_version: 2, run_id: "r", run_dir: "/tmp/r", created_at: new Date().toISOString(),
  target_path: "/tmp/skill", repo_root: "/tmp", skill_name: "demo", invoking_host: "codex",
  requested_hosts: ["codex"], anchor,
  versions: { authored: { path: "/tmp/skill", parent: null, created_at: new Date().toISOString() } },
  hashes: { versions: { authored: "a", anchor: null }, fixtures: {}, suite: "s" },
  git: { initial_clean: true, initial_status: "", branch: "feature", head: "abc", target_tracked: false },
});

test("effectiveness requires the anchor baseline, including a no-skill anchor", () => {
  expect(() => assertComparisonValidity(suite("effectiveness"), state({ kind: "none" }), "authored", "candidate")).toThrow("anchor baseline");
  expect(() => assertComparisonValidity(suite("effectiveness"), state({ kind: "none" }), "anchor", "authored")).not.toThrow();
});

test("conformance cannot produce an improvement comparison", () => {
  expect(() => assertComparisonValidity(suite("conformance"), state({ kind: "git", ref: "HEAD" }), "anchor", "authored")).toThrow("conformance");
});

test("confirmation requires a generalization claim with outcome evidence in both partitions", () => {
  expect(() => assertConfirmationValidity(suite("effectiveness"))).toThrow("generalization");
  expect(() => assertConfirmationValidity(suite("generalization"))).not.toThrow();
});
