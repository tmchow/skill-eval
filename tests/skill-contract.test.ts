import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFile(resolve(root, path), "utf8");

describe("runtime skill contract", () => {
  test("defines an evaluator-only ownership boundary", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    expect(skill).toContain("Evaluate and diagnose agent skills without installing them.");
    expect(skill).toContain("Do not edit the target skill, generate challenger versions, select a revision, commit, or promote.");
    expect(skill).toContain("The caller or authoring workflow owns changes");
    expect(skill).toContain("Do not apply the advice.");
    for (const command of ["optimize --", "optimize-description", "certify --", "promote --", "add-version", "decide --"]) expect(skill).not.toContain(command);
  });

  test("starts with a model-neutral outcome spine", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    const outcome = skill.indexOf("- **Result:**");
    const workflow = skill.indexOf("## Required Decisions");
    expect(outcome).toBeGreaterThan(0);
    expect(outcome).toBeLessThan(workflow);
    expect(skill).toContain("- **Next consumer:**");
    expect(skill).toContain("- **Done:**");
    expect(skill).toContain("- **Intent:** scope follows the claim, not the evaluator machinery");
    expect(skill).toContain("stop the target at the earliest boundary that preserves the causal link");
  });

  test("uses a portable model-filled script anchor", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    expect(skill).toContain('SKILL_DIR="<absolute path of this skill directory>"');
    expect(skill).not.toContain("${CLAUDE_SKILL_DIR}");
    expect(skill).not.toContain("${CODEX_HOME}");
  });

  test("resolves common development states against a fixed anchor", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    expect(skill).toContain("including committed and uncommitted work");
    expect(skill).toContain("merge base");
    expect(skill).toContain("no-skill baseline");
    expect(skill).toContain("If anchor and current hashes match, stop before model calls");
    expect(skill).toContain("Never invoke an installed copy");
  });

  test("requires terminal outcomes and separates evidence roles", async () => {
    const contract = `${await read("skills/skill-eval/SKILL.md")}\n${await read("skills/skill-eval/references/eval-design.md")}\n${await read("skills/skill-eval/references/schemas.md")}`;
    expect(contract).toContain("The change exists so");
    expect(contract).toContain('evidence_role: "outcome" | "mechanism"');
    expect(contract).toContain("Mechanism evidence can fail a critical gate");
    expect(contract).toContain("passing mechanism cannot");
    expect(contract).toContain("normal no-skill behavior");
    expect(contract).toContain("blindly compare the final reviews");
  });

  test("resists measurement goalpost movement", async () => {
    const contract = `${await read("skills/skill-eval/SKILL.md")}\n${await read("skills/skill-eval/references/agents/suite-critic.md")}\n${await read("skills/skill-eval/references/evidence-preparation.md")}`;
    expect(contract).toContain("campaign goal remains scope authority");
    expect(contract).toContain("A critical issue cannot be waived as a limitation");
    expect(contract).toContain("Do not rerun critics");
    expect(contract).toContain("must not select candidate runs based on a favorable post-treatment outcome");
    expect(contract).toContain("Retire a prior campaign case only");
  });

  test("defaults to cross-host coverage without a mandatory matrix", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    const design = await read("skills/skill-eval/references/eval-design.md");
    expect(skill).toContain("Assume skills target both Claude Code and Codex");
    expect(skill).toContain("low-risk host coverage in parallel");
    expect(skill).toContain("otherwise calibrate on the invoking host first");
    expect(skill).toContain("automatically run the same frozen evidence on the second host");
    expect(skill).toContain("does not establish cross-host behavior");
    expect(design).toContain("not a mandatory matrix");
    expect(skill).toContain("Add repetitions only when observed variance");
  });

  test("keeps narrow conformance bounded and mechanically graded", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    const design = await read("skills/skill-eval/references/eval-design.md");
    const preparation = await read("skills/skill-eval/references/evidence-preparation.md");
    expect(skill).toContain("For conformance, default to the current version only");
    expect(skill).toContain("Use workflow `run` for conformance");
    expect(skill).toContain("`compare` rejects conformance");
    expect(design).toContain("prove dispatch with a structured tool event or sentinel side effect, then stop");
    expect(preparation).toContain("### Boundary-Stop Gate");
    expect(preparation).toContain("use a fixture `bin/bash` wrapper");
    expect(preparation).toContain("Put the sentinel and immediate stop instruction in the executor prompt");
    expect(preparation).toContain("`tool_called` alone proves launch and does not enforce the stop");
    expect(preparation).toContain("A shim plus an `exit_success` check on the later workflow is not boundary-stopped");
    expect(preparation).toContain("Do not merge a narrow route check and a broad restraint into a full run");
    expect(design).toContain("an expectation that observes a tool call does not stop the called tool or later workflow by itself");
    expect(preparation).toContain("is not a feasibility finding");
    expect(skill).toContain("expected baseline behavior must not appear as a target failure");
  });

  test("maps the full behavioral claim before choosing machinery", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    const design = await read("skills/skill-eval/references/eval-design.md");
    expect(skill).toContain("build this claim map internally");
    expect(skill).toContain("- **Claim:**");
    expect(skill).toContain("- **Mechanism:**");
    expect(skill).toContain("- **Boundaries:**");
    expect(skill).toContain("- **Observation point:**");
    expect(skill).toContain("`only`, `while preserving`, `without`, `except`");
    expect(skill).toContain("Mechanisms receive supporting expectations when needed, but belong in the goal only when the mechanism itself is the contract");
    expect(skill).toContain("Omit unrelated behavior; do not omit an implicated restraint");
    expect(skill).toContain("A restraint must not widen the execution boundary of the positive claim");
    expect(skill).toContain("Routing conformance has a two-case coverage floor");
    expect(skill).toContain("Choose the experiment boundary before building fixtures");
    expect(skill).toContain("Supplying state directly is invalid when it bypasses the changed mechanism");
    expect(design).toContain("## Choose The Right-Sized Experiment");
    expect(design).toContain("**Direct decision probe:**");
    expect(design).toContain("**Simulated environment:**");
    expect(design).toContain("**Stage or workflow execution:**");
    expect(design).toContain("Give the executor situation facts, not the expected answer or grading criteria");
    expect(design).toContain("current-only decision probes may establish restraints or safety invariants, but they do not count as improvement evidence");
  });

  test("asks only when plausible eval goals would answer different questions", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    const design = await read("skills/skill-eval/references/eval-design.md");
    expect(skill).toContain("at most three concise choices before creating a campaign");
    expect(skill).toContain("offer mechanism-only conformance as a narrower alternative");
    expect(skill).toContain("Do not ask the user to choose fixtures, graders, repetition counts");
    expect(design).toContain("it can prove the wiring or contract but not the benefit");
  });

  test("supersedes changed campaign goals and avoids report overclaims", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    const preparation = await read("skills/skill-eval/references/evidence-preparation.md");
    expect(skill).toContain("Campaign goals are immutable");
    expect(preparation).toContain("A changed terminal claim or material regression/restraint boundary requires a new campaign");
    expect(skill).toContain("Do not infer that work was cheap, fast, safe, or ready to ship");
    expect(skill).toContain("do not recommend committing, shipping, or merging it");
    expect(skill).toContain("never tell the user to ship, commit, merge, or deploy it");
    expect(preparation).toContain("Never describe a workspace ledger or executor-written artifact as unforgeable");
  });

  test("keeps the campaign goal, suite coverage, and external-state claims honest", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    const preparation = await read("skills/skill-eval/references/evidence-preparation.md");
    expect(skill).toContain("map every material outcome, regression, and restraint clause to at least one suite expectation");
    expect(skill).toContain("whether downstream work is intercepted or runs");
    expect(skill).toContain("Do not ask for confirmation until `estimate` succeeds");
    expect(skill).toContain("proposal states its exact direct-call count");
    expect(skill).toContain("Never predict an outcome from home-directory, network, installed-tool, or other external state");
    expect(preparation).toContain("A repository fixture does not isolate the executor's home directory");
    expect(preparation).toContain("every material clause in the campaign goal maps to an expectation");
    expect(skill).toContain("do not add host names, version labels, run counts");
    expect(preparation).toContain("must not predict that the dependency will be skipped, empty, available, or successful");
  });

  test("uses observable evidence for non-interactive contracts", async () => {
    const preparation = await read("skills/skill-eval/references/evidence-preparation.md");
    const schemas = await read("skills/skill-eval/references/schemas.md");
    expect(preparation).toContain("Use `interactive_prompt_not_used`");
    expect(preparation).toContain("`exit_success` proves executor health, not that the agent avoided a question");
    expect(schemas).toContain('`{"type":"interactive_prompt_not_used"}`');
  });

  test("keeps facts deterministic and final reasoning agent-authored", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    const schemas = await read("skills/skill-eval/references/schemas.md");
    expect(skill).toContain("evidence-index");
    expect(skill).toContain("conversation history alone");
    expect(skill).toContain("Checkpoints preserve interpretation");
    expect(schemas).toContain("contains no diagnosis or advice");
    expect(skill).toContain("Record count is not success count");
  });

  test("uses human review only for irreducible judgment", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    const review = await read("skills/skill-eval/references/human-review.md");
    expect(skill).toContain("only when anonymous evaluators genuinely disagree");
    expect(review).toContain('bun "$SKILL_DIR/scripts/review-server.js" start');
    expect(review).toContain("native blocking question");
    expect(review).toContain("display-only");
    expect(review).not.toContain("Export decision");
  });

  test("separates training calibration from mutation-free confirmation", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    const schemas = await read("skills/skill-eval/references/schemas.md");
    expect(skill).toContain("`confirm` only when the confirmed measurement goal claims generalization");
    expect(skill).toContain("It never changes the target");
    expect(schemas).toContain("`compare` runs training calibration");
    expect(schemas).toContain("`confirm` requires a generalization suite");
  });

  test("stops when evidence is decision-sufficient", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    expect(skill).toContain("Decision-sufficient evidence is terminal");
    expect(skill).toContain("One favorable case cannot establish that breadth");
    expect(skill).toContain("Do not confuse scenario breadth with repetition count");
    expect(skill).toContain("If neither result would change the decision, stop");
    expect(skill).toContain("An unfavorable target result is evidence");
    expect(skill).toContain("Do not escalate an effectiveness evaluation into confirmation");
    expect(skill).not.toContain("--repetitions 3");
  });

  test("keeps communication value-first", async () => {
    const skill = await read("skills/skill-eval/SKILL.md");
    expect(skill).toContain("Do not narrate every read or command");
    expect(skill).toContain("Start the first pass?");
    expect(skill).toContain("under 180 words");
    expect(skill).toContain("Do not report dollar cost");
    expect(skill).toContain("Coverage by two hosts is not itself cross-model value");
    expect(skill.split("\n").length).toBeLessThan(350);
  });
});
