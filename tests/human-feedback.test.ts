import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestHumanFeedback } from "../skills/skill-eval/scripts/lib/human-feedback.ts";
import { writeJson } from "../skills/skill-eval/scripts/lib/json.ts";

test("maps anonymous human decisions through the post-judge label map", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-human-feedback-"));
  await writeJson(join(runDir, "judgments.json"), [{ schema_version: 1, comparison_id: "cmp", execution_attempt_id: "attempt", repetition: 1, eval_id: "case", executor_host: "codex", judge_host: "claude", left_version: "left", right_version: "right", labels: { A: "right", B: "left" }, winner_label: "TIE", preferred_version: "TIE", reasoning: "agents disagree", valid: true, run_dir: runDir }]);
  const feedback = join(runDir, "feedback.json");
  await writeFile(feedback, JSON.stringify({ status: "complete", reviews: [{ comparison_id: "cmp", execution_attempt_id: "attempt", eval_id: "case", executor_host: "codex", judge_host: "claude", repetition: 1, winner: "A", reason: "A is factually correct" }] }));
  const result = await ingestHumanFeedback({ runDir, feedbackPath: feedback, feedbackId: "human-review" });
  expect(result).toHaveLength(1);
  expect(result[0]?.preferred_version).toBe("right");
  expect(result[0]?.reason).toBe("A is factually correct");
});
