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
    expect(skill).toContain("calibrate on the invoking host first");
    expect(skill).toContain("automatically run the same frozen evidence on the second host");
    expect(skill).toContain("does not establish cross-host behavior");
    expect(design).toContain("not a mandatory matrix");
    expect(skill).toContain("Add repetitions only when observed variance");
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
