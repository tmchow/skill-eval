import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordHumanFeedback } from "../skills/skill-eval/scripts/lib/human-feedback.ts";
import { reviewCaseId } from "../skills/skill-eval/scripts/lib/review.ts";
import { writeJson } from "../skills/skill-eval/scripts/lib/json.ts";

test("maps anonymous human decisions through the post-judge label map", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-human-feedback-"));
  const judgment = { schema_version: 1 as const, comparison_id: "cmp", execution_attempt_id: "attempt", repetition: 1, eval_id: "case", executor_host: "codex" as const, judge_host: "claude" as const, left_version: "left", right_version: "right", labels: { A: "right", B: "left" }, winner_label: "TIE" as const, preferred_version: "TIE", reasoning: "agents disagree", valid: true, run_dir: runDir };
  await writeJson(join(runDir, "judgments.json"), [judgment]);

  const result = await recordHumanFeedback({ runDir, caseId: reviewCaseId(judgment), winner: "A", reason: "A is factually correct", feedbackId: "human-review" });

  expect(result.preferred_version).toBe("right");
  expect(result.reason).toBe("A is factually correct");
});

test("rejects a decision that does not match a generated review case", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-human-feedback-missing-"));
  await writeJson(join(runDir, "judgments.json"), []);
  await expect(recordHumanFeedback({ runDir, caseId: "review-000000000000", winner: "B", feedbackId: "human-review" })).rejects.toThrow("unknown review case");
});

test("accepts only one immutable human decision per review case", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-human-feedback-once-"));
  const judgment = { schema_version: 1 as const, comparison_id: "cmp", execution_attempt_id: "attempt", repetition: 1, eval_id: "case", executor_host: "codex" as const, judge_host: "claude" as const, left_version: "left", right_version: "right", labels: { A: "left", B: "right" }, winner_label: "TIE" as const, preferred_version: "TIE", reasoning: "agents disagree", valid: true, run_dir: runDir };
  await writeJson(join(runDir, "judgments.json"), [judgment]);
  const caseId = reviewCaseId(judgment);
  await recordHumanFeedback({ runDir, caseId, winner: "B" });
  await expect(recordHumanFeedback({ runDir, caseId, winner: "A" })).rejects.toThrow("already has a human decision");
});
