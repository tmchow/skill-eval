import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirmAuthored } from "../skills/skill-eval/scripts/lib/confirmation.ts";
import { hashTree, hashValue, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import { validateSuite } from "../skills/skill-eval/scripts/lib/suite.ts";
import type { HostAdapter, HostRequest, HostResult, RunState } from "../skills/skill-eval/scripts/lib/types.ts";

class ConfirmationAdapter implements HostAdapter {
  name = "codex" as const;

  async execute(request: HostRequest): Promise<HostResult> {
    const baseline = request.prompt.includes("No additional skill instructions");
    const finalText = baseline ? "baseline" : "useful result";
    await writeFile(request.eventPath, "{}\n");
    await writeFile(request.stderrPath, "");
    await writeFile(request.finalPath, finalText);
    return {
      host: "codex", exit_code: 0, timed_out: false, malformed_events: 0,
      final_text: finalText, duration_ms: 1,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, cost_usd: null },
      event_path: request.eventPath, stderr_path: request.stderrPath, final_path: request.finalPath,
    };
  }
}

async function fixture() {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-confirm-"));
  const target = join(runDir, "target");
  const authored = join(runDir, "versions", "authored");
  await mkdir(target, { recursive: true });
  await mkdir(authored, { recursive: true });
  const skill = "---\nname: demo\ndescription: Use when testing.\n---\n# Demo\n";
  await writeFile(join(target, "SKILL.md"), skill);
  await writeFile(join(authored, "SKILL.md"), skill);
  const suite = validateSuite({
    schema_version: 2,
    claim_class: "generalization",
    environment: { fidelity: "isolated", external_state: [] },
    skill_name: "demo",
    hypothesis: "The skill produces a more useful result.",
    evals: [
      { id: "training", name: "Training", purpose: "improvement", severity: "quality", prompt: "Do the task", expectations: [{ id: "useful", text: "The result is useful", severity: "quality", evidence_role: "outcome", check: { type: "final_contains", value: "useful result" } }] },
      { id: "validation", name: "Validation", purpose: "regression", severity: "quality", prompt: "Do the related task", validation: true, expectations: [{ id: "useful", text: "The result remains useful", severity: "quality", evidence_role: "outcome", check: { type: "final_contains", value: "useful result" } }] },
    ],
  });
  await writeJson(join(runDir, "suite.json"), suite);
  const now = new Date().toISOString();
  const state: RunState = {
    schema_version: 2, run_id: "run", run_dir: runDir, created_at: now, target_path: target, repo_root: runDir, skill_name: "demo",
    invoking_host: "codex", requested_hosts: ["codex"], anchor: { kind: "none" }, versions: { authored: { path: authored, parent: null, created_at: now } },
    hashes: { versions: { anchor: null, authored: await hashTree(authored) }, fixtures: {}, suite: hashValue(suite) },
    git: { initial_clean: true, initial_status: "", branch: "feature", head: "abc", target_tracked: false },
  };
  await writeJson(join(runDir, "run.json"), state);
  await writeJson(join(runDir, "artifacts", "suite-critique-latest.json"), { results: [{ schema_version: 2, critic_host: "codex", verdict: "PASS", reasoning: "The suite measures the terminal outcome.", issues: [], valid: true, created_at: now }] });
  return { runDir, target, targetHash: await hashTree(target), adapter: new ConfirmationAdapter() };
}

test("confirms authored against anchor and seals a mutation-free evidence claim", async () => {
  const { runDir, target, targetHash, adapter } = await fixture();
  const result = await confirmAuthored({ runDir, label: "confirmation", hosts: ["codex"], judgeHosts: ["codex"], repetitions: 2, adapters: { codex: adapter } });

  expect(result.benchmark.comparison).toEqual({ left: "anchor", right: "authored" });
  expect(result.benchmark.verdict).toBe("improvement demonstrated");
  expect(result.claim).toMatchObject({ authored_version: "authored", requested_hosts: ["codex"], completed_partitions: ["training", "validation"], supported: true });
  expect(result.claim.claim_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(await hashTree(target)).toBe(targetHash);
  expect(await Bun.file(join(runDir, "promotion", "backup")).exists()).toBe(false);
});

test("confirmation requires the exact frozen host scope", async () => {
  const { runDir, adapter } = await fixture();
  await expect(confirmAuthored({ runDir, label: "confirmation", hosts: ["claude"], judgeHosts: ["codex"], adapters: { codex: adapter } })).rejects.toThrow("hosts must exactly match");
});
