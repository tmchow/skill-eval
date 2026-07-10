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
});
