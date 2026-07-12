import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEvidenceIndex } from "../skills/skill-eval/scripts/lib/evidence-index.ts";
import { hashTree, hashValue, readOptionalJson, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import { validateSuite } from "../skills/skill-eval/scripts/lib/suite.ts";

test("builds a stable factual index without diagnosis prose", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-index-"));
  const authored = join(runDir, "versions", "authored");
  await mkdir(authored, { recursive: true });
  await writeFile(join(authored, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n# Demo\n");
  const suite = validateSuite({
    schema_version: 2, claim_class: "effectiveness", environment: { fidelity: "isolated", external_state: [] }, skill_name: "demo", hypothesis: "The result improves.",
    evals: [{ id: "case", name: "Case", purpose: "improvement", severity: "quality", prompt: "Do it", expectations: [{ id: "quality", text: "The result is useful", severity: "quality", evidence_role: "outcome", check: { type: "final_contains", value: "useful" } }] }],
  });
  await writeJson(join(runDir, "suite.json"), suite);
  await writeJson(join(runDir, "run.json"), {
    schema_version: 2, run_id: "run", run_dir: runDir, created_at: new Date().toISOString(), target_path: authored, repo_root: runDir, skill_name: "demo", invoking_host: "codex", requested_hosts: ["claude", "codex"], anchor: { kind: "none" },
    versions: { authored: { path: authored, parent: null, created_at: new Date().toISOString() } }, hashes: { versions: { anchor: null, authored: await hashTree(authored) }, fixtures: {}, suite: hashValue(suite) }, git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: false },
  });
  await writeJson(join(runDir, "executions.json"), [{
    schema_version: 2, attempt_id: "attempt", partition: "training", created_at: new Date().toISOString(), host: "codex", eval_id: "case", version: "authored", repetition: 1, run_dir: join(runDir, "execution"), output_dir: join(runDir, "outputs"), skill_path: authored, skill_hash_before: null, skill_hash_after: null, source_mutated: false,
    host_result: { host: "codex", exit_code: 0, timed_out: false, malformed_events: 0, final_text: "not useful", duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, cost_usd: null }, event_path: "events", stderr_path: "stderr", final_path: "final" },
  }]);
  await writeJson(join(runDir, "gradings.json"), [{
    schema_version: 2, attempt_id: "attempt", partition: "training", host: "codex", eval_id: "case", version: "authored", repetition: 1,
    expectations: [{ id: "quality", text: "The result is useful", severity: "quality", evidence_role: "outcome", passed: false, blocked: false, evidence: "final output lacked useful" }],
    summary: { passed: 0, failed: 1, blocked: 0, qualitative: 0, total: 1, pass_rate: 0, critical_failed: 0, critical_blocked: 0, run_failed: false },
  }]);
  const invalidation = { schema_version: 2 as const, attempt_id: "attempt", eval_id: "case", expectation_id: "quality", reason: "The substring check was semantically invalid.", created_at: new Date().toISOString() };
  await writeJson(join(runDir, "invalidated-checks.json"), [{ ...invalidation, content_hash: hashValue(invalidation) }]);

  const first = await buildEvidenceIndex(runDir);
  const second = await buildEvidenceIndex(runDir);
  expect(first.source_hash).toBe(second.source_hash);
  expect(first.content_hash).toBe(second.content_hash);
  expect(first.missing_hosts).toEqual(["claude"]);
  expect(first.failures[0]).toMatchObject({ source: "deterministic-grade", evidence_role: "outcome", status: "FAIL" });
  expect(JSON.stringify(first)).not.toContain("suggested_fix");
  expect(JSON.stringify(first)).not.toContain("diagnosis");
});

test("does not hide malformed evidence as an absent optional artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-eval-malformed-json-"));
  const path = join(root, "judgments.json");
  await writeFile(path, "not-json\n");
  await expect(readOptionalJson(path, [])).rejects.toThrow();
});
