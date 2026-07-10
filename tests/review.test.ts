import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateReview } from "../skills/skill-eval/scripts/lib/review.ts";
import { writeJson } from "../skills/skill-eval/scripts/lib/json.ts";

test("generates a read-only anonymous review and returns safe case descriptors", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-review-"));
  const judgeDir = join(runDir, "judge");
  for (const label of ["A", "B"]) {
    const path = join(judgeDir, "input", label); await mkdir(path, { recursive: true });
    await writeFile(join(path, "answer.md"), `${label} answer`);
    await writeFile(join(path, "image.png"), Buffer.from([137, 80, 78, 71]));
  }
  await writeJson(join(runDir, "judgments.json"), [
    { schema_version: 1, comparison_id: "cmp", execution_attempt_id: "attempt", repetition: 1, eval_id: "case", executor_host: "codex", judge_host: "claude", left_version: "left", right_version: "right", labels: { A: "left", B: "right" }, winner_label: "A", preferred_version: "left", reasoning: "A is clearer", valid: true, run_dir: judgeDir },
    { schema_version: 1, comparison_id: "cmp", execution_attempt_id: "attempt", repetition: 1, eval_id: "case", executor_host: "codex", judge_host: "codex", left_version: "left", right_version: "right", labels: { A: "right", B: "left" }, winner_label: "A", preferred_version: "right", reasoning: "A is more complete", valid: true, run_dir: judgeDir },
  ]);
  await writeJson(join(runDir, "benchmark.json"), { verdict: "blocked or limited signal", notes: ["judges disagree"] });

  const generated = await generateReview(runDir);
  const html = await readFile(generated.path, "utf8");
  expect(generated.cases).toBe(1);
  expect(html).toContain("Anonymous output A");
  expect(html).toContain("A answer");
  expect(html).toContain("data:image/png;base64");
  expect(html).toContain("Cross-model judgment");
  expect(html).toContain("Judgment");
  expect(html).toContain("Output A");
  expect(html).toContain("Output B");
  expect(html).toContain("Evidence");
  expect(html).not.toContain("Export decision");
  expect(html).not.toContain("skill-eval-feedback.json");
  expect(html).not.toContain('type="radio"');
  expect(html).not.toContain("<textarea");
  expect(html).not.toContain("left_version");
  expect(generated.reviews).toHaveLength(1);
  expect(generated.reviews[0]).toMatchObject({ eval_id: "case", executor_host: "codex", repetition: 1 });
  expect(generated.reviews[0]?.case_id).toMatch(/^review-[a-f0-9]{12}$/);
  expect(JSON.stringify(generated.reviews)).not.toContain("left");
  expect(JSON.stringify(generated.reviews)).not.toContain("right");
});
