import { join, resolve } from "node:path";
import { readJson, writeJson } from "./json.ts";
import type { HumanJudgment, JudgeResult } from "./types.ts";

export interface IngestHumanFeedbackOptions { runDir: string; feedbackPath: string; feedbackId: string }

export async function ingestHumanFeedback(options: IngestHumanFeedbackOptions): Promise<HumanJudgment[]> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.feedbackId)) throw new Error("feedback id must contain only letters, digits, dot, underscore, or hyphen");
  const runDir = resolve(options.runDir);
  const feedback = await readJson<any>(resolve(options.feedbackPath));
  if (feedback.status !== "complete" || !Array.isArray(feedback.reviews)) throw new Error("human feedback must be complete");
  const judgments = await readJson<JudgeResult[]>(join(runDir, "judgments.json"));
  let previous: HumanJudgment[] = [];
  try { previous = await readJson<HumanJudgment[]>(join(runDir, "human-judgments.json")); } catch { /* first human review */ }
  if (previous.some((item) => item.feedback_id === options.feedbackId)) throw new Error(`feedback id already exists: ${options.feedbackId}`);
  const results: HumanJudgment[] = [];
  for (const review of feedback.reviews) {
    if (!["A", "B", "TIE"].includes(review.winner)) continue;
    const judgment = judgments.find((item) => item.comparison_id === review.comparison_id && item.execution_attempt_id === review.execution_attempt_id && item.eval_id === review.eval_id && item.executor_host === review.executor_host && item.repetition === Number(review.repetition) && (!review.judge_host || item.judge_host === review.judge_host));
    if (!judgment) throw new Error(`feedback does not match an anonymous judge input: ${review.comparison_id}/${review.eval_id}`);
    results.push({
      schema_version: 1, feedback_id: options.feedbackId, comparison_id: judgment.comparison_id, execution_attempt_id: judgment.execution_attempt_id,
      eval_id: judgment.eval_id, executor_host: judgment.executor_host, repetition: judgment.repetition, winner_label: review.winner,
      preferred_version: review.winner === "TIE" ? "TIE" : judgment.labels[review.winner as "A" | "B"], reason: String(review.reason ?? ""), created_at: new Date().toISOString(),
    });
  }
  if (results.length === 0) throw new Error("human feedback contains no completed decisions");
  await writeJson(join(runDir, "human-judgments.json"), [...previous, ...results]);
  return results;
}
