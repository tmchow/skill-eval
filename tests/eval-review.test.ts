import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateEvalReview } from "../skills/skill-eval/scripts/lib/eval-review.ts";

test("generates an editable suite review without changing the source suite", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-eval-suite-review-"));
  const suite = join(root, "suite.json");
  await writeFile(suite, JSON.stringify({ schema_version: 1, skill_name: "demo", hypothesis: "better", evals: [{ id: "case", name: "Case", purpose: "improvement", severity: "critical", prompt: "task", expectations: [{ id: "result", text: "result", severity: "critical" }] }], trigger_queries: [{ id: "positive", query: "evaluate it", should_trigger: true, holdout: false }] }));
  const generated = await generateEvalReview(suite);
  const html = await readFile(generated.path, "utf8");
  expect(html).toContain("Review frozen evaluation suite");
  expect(html).toContain("evaluate it");
  expect(html).toContain("Export suite");
  expect(await readFile(suite, "utf8")).not.toContain("reviewed_at");
});
