import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

describe("runtime skill contract", () => {
  test("keeps load-bearing evaluation gates in SKILL.md", async () => {
    const skill = await readFile(resolve(root, "skills/skill-eval/SKILL.md"), "utf8");
    expect(skill).toContain("name: skill-eval");
    expect(skill).toContain("Evaluate, compare, benchmark, or optimize agent skills without installing them.");
    expect(skill).toContain("wait for confirmation");
    expect(skill).toContain("Preflight");
    expect(skill).toContain("hard-stops after five challengers");
    expect(skill).toContain("training and held-out");
    expect(skill).toContain("--skill-creator");
    expect(skill).toContain("`references/revision.md`");
    expect(skill).toContain("For every emitted `progress` event");
    expect(skill).toContain("review page only when");
    expect(skill).toContain("sealed decision");
    expect(skill.split("\n").length).toBeLessThan(500);
  });

  test("uses a portable model-filled script anchor", async () => {
    const skill = await readFile(resolve(root, "skills/skill-eval/SKILL.md"), "utf8");
    expect(skill).toContain('SKILL_DIR="<absolute path of this skill directory>"');
    expect(skill).not.toContain("${CLAUDE_SKILL_DIR}");
    expect(skill).not.toContain("${CODEX_HOME}");
  });

  test("selects development baseline and execution scope from the actual request", async () => {
    const skill = await readFile(resolve(root, "skills/skill-eval/SKILL.md"), "utf8");
    expect(skill).toContain("`--anchor-ref`");
    expect(skill).toContain("merge base");
    expect(skill).toContain("committed and uncommitted");
    expect(skill).toContain("trigger-only");
    expect(skill).toContain("Do not run the full workflow by default");
    expect(skill).toContain("Honor explicit user constraints");
    expect(skill).toContain("hard scope boundary");
    expect(skill).toContain("under 180 words");
    expect(skill).toContain("not a matrix formula");
    expect(skill).toContain("exact direct-call total");
  });

  test("bases resource guidance on measured calibration evidence", async () => {
    const skill = await readFile(resolve(root, "skills/skill-eval/SKILL.md"), "utf8");
    expect(skill).toContain("Do not invent token totals or wall-clock estimates");
    expect(skill).toContain("observed calibration");
    expect(skill).toContain("direct call count");
  });

  test("keeps user communication value-first instead of narrating machinery", async () => {
    const skill = await readFile(resolve(root, "skills/skill-eval/SKILL.md"), "utf8");
    expect(skill).toContain("## Communication Contract");
    expect(skill).toContain("Do not narrate every read or command");
    expect(skill).toContain("Batch routine investigation");
    expect(skill).toContain("transition-only updates");
    expect(skill).toContain("what changed in the evaluation and why it matters");
    expect(skill).toContain("implementation detail only when it changes");
    expect(skill).toContain("baseline/current version");
    expect(skill).toContain('End with "Start the first pass?"');
    expect(skill).toContain("The user is confirming the measurement scope, coverage, bounded model use, and allowed side effects");
    expect(skill).toContain("Immutability and evidence preparation are internal integrity guarantees");
    expect(skill).toContain("## 3. Prepare Evaluation Evidence");
    expect(skill).not.toContain("## 3. Author And Freeze");
    expect(skill).toContain("Do not praise or grade the target skill before evidence");
    expect(skill).toContain("cause, impact on the conclusion, and next action");
    expect(skill).toContain("Measured change");
    expect(skill).toContain("Evidence coverage");
    expect(skill).toContain("Not established");
    expect(skill).toContain("Do not claim that the whole skill or harness passed");
    expect(skill).toContain("Do not include unrelated repository work or generic workflow suggestions");
    expect(skill).toContain("Do not report dollar cost");
    expect(skill).toContain("Report tokens only when");
    expect(skill).toContain("Cross-model signal");
    expect(skill).toContain("Coverage alone is not cross-model value");
    expect(skill).toContain("disagreement became convergence");
    expect(skill).toContain("campaign-context");
    expect(skill).toContain("agent-authored reasoning checkpoint");
    expect(skill).toContain("does not generate the final report");
    expect(skill).toContain("before presenting the pass update");
  });

  test("separates delivered outcomes from enabling mechanisms", async () => {
    const skill = await readFile(resolve(root, "skills/skill-eval/SKILL.md"), "utf8");
    const design = await readFile(resolve(root, "skills/skill-eval/references/eval-design.md"), "utf8");
    expect(skill).toContain("Trace each changed mechanism through immediate effects");
    expect(skill).toContain("Evidence modes are composable");
    expect(skill).toContain("both anchor and authored arms on the same fixture");
    expect(design).toContain("candidate evidence, not scope authority");
    expect(design).toContain("reuse valid cases, add missing claim layers");
    expect(design).toContain("cannot establish the delivered outcome");
    expect(design).toContain("Do not stub the component claimed to create the benefit");
    expect(design).toContain("narrowest execution boundary that preserves the causal link");
    expect(design).toContain("Do not require byte equality between independent model runs");
  });

  test("makes outcome sufficiency a stop condition instead of advice", async () => {
    const skill = await readFile(resolve(root, "skills/skill-eval/SKILL.md"), "utf8");
    const design = await readFile(resolve(root, "skills/skill-eval/references/eval-design.md"), "utf8");
    expect(skill).toContain("### Outcome Sufficiency Gate");
    expect(skill).toContain("<benefit is absent even though the mechanism works>");
    expect(skill).toContain("do not recast the mechanism as the primary claim");
    expect(skill).toContain("Do not stop at the first observable effect");
    expect(skill).toContain("Stochastic or subjective does not mean untestable");
    expect(skill).toContain("The change exists so");
    expect(skill).toContain("Presence, provenance, promotion, or formatting");
    expect(design).toContain("cannot be the sole improvement evidence");
    expect(design).toContain("mark that outcome blocked or degraded");
    expect(design).toContain("deterministic proxy");
    expect(design).toContain("a second model is added to improve review quality");
    expect(design).toContain("blindly compare the final reviews");
  });

  test("documents inspectable orchestration and fake dependency fixtures", async () => {
    const skill = await readFile(resolve(root, "skills/skill-eval/SKILL.md"), "utf8");
    const design = await readFile(resolve(root, "skills/skill-eval/references/eval-design.md"), "utf8");
    const schemas = await readFile(resolve(root, "skills/skill-eval/references/schemas.md"), "utf8");
    const hosts = await readFile(resolve(root, "skills/skill-eval/references/hosts.md"), "utf8");
    expect(skill).toContain("`fixture/bin/`");
    expect(design).toContain("`tool_call_count`");
    expect(schemas).toContain('"type":"tool_called"');
    expect(hosts).toContain("re-establishes `CLAUDECODE=1`");
  });

  test("keeps installed copies out of repository-source evaluation", async () => {
    const skill = await readFile(resolve(root, "skills/skill-eval/SKILL.md"), "utf8");
    const hosts = await readFile(resolve(root, "skills/skill-eval/references/hosts.md"), "utf8");
    expect(skill).toContain("never invoke an installed copy of the target skill");
    expect(skill).toContain("resolved repository path");
    expect(hosts).toContain("same-name installed skills cannot participate");
  });

  test("keeps human review display-only and native to the active harness", async () => {
    const skill = await readFile(resolve(root, "skills/skill-eval/SKILL.md"), "utf8");
    const review = await readFile(resolve(root, "skills/skill-eval/references/human-review.md"), "utf8");
    expect(skill).toContain("`references/human-review.md`");
    expect(review).toContain('bun "$SKILL_DIR/scripts/review-server.js" start');
    expect(review).toContain("native blocking question");
    expect(review).toContain("display-only");
    expect(review).toContain("record-feedback");
    expect(review).not.toContain("Export decision");
    expect(review).not.toContain("skill-eval-feedback.json");
  });

  test("separates evaluation-only comparison from long-running promotion certification", async () => {
    const skill = await readFile(resolve(root, "skills/skill-eval/SKILL.md"), "utf8");
    const hosts = await readFile(resolve(root, "skills/skill-eval/references/hosts.md"), "utf8");
    expect(skill).toContain("`compare` is the default paired evaluation path");
    expect(skill).toContain("`certify` is promotion-grade");
    expect(skill).toContain("--executor-timeout-ms");
    expect(skill).toContain("--exclude-from-executor");
    expect(skill).toContain("check-script --run-dir");
    expect(skill).toContain("status --run-dir");
    expect(hosts).toContain("host's native background or persistent-command primitive");
    expect(hosts).toContain("Claude Code");
    expect(hosts).toContain("Codex");
    expect(hosts).toContain("Do not wrap a host-managed background command in `nohup`");
  });
});
