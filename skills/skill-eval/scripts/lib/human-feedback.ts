import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { readJson, writeJson } from "./json.ts";
import { reviewCaseId } from "./review.ts";
import type { HumanJudgment, JudgeResult } from "./types.ts";

export interface RecordHumanFeedbackOptions {
  runDir: string;
  caseId: string;
  winner: "A" | "B" | "TIE";
  reason?: string;
  feedbackId?: string;
}

export async function recordHumanFeedback(options: RecordHumanFeedbackOptions): Promise<HumanJudgment> {
  if (!/^review-[a-f0-9]{12}$/.test(options.caseId)) throw new Error("invalid review case id");
  if (!["A", "B", "TIE"].includes(options.winner)) throw new Error("winner must be A, B, or TIE");
  const feedbackId = options.feedbackId ?? `human-${options.caseId}-${randomUUID().slice(0, 8)}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(feedbackId)) throw new Error("feedback id must contain only letters, digits, dot, underscore, or hyphen");

  const runDir = resolve(options.runDir);
  const judgments = await readJson<JudgeResult[]>(join(runDir, "judgments.json"));
  const judgment = judgments.find((item) => reviewCaseId(item) === options.caseId);
  if (!judgment) throw new Error(`unknown review case: ${options.caseId}`);

  let previous: HumanJudgment[] = [];
  try { previous = await readJson<HumanJudgment[]>(join(runDir, "human-judgments.json")); } catch { /* first human review */ }
  if (previous.some((item) => reviewCaseId(item) === options.caseId)) throw new Error(`review case already has a human decision: ${options.caseId}`);
  if (previous.some((item) => item.feedback_id === feedbackId)) throw new Error(`feedback id already exists: ${feedbackId}`);

  const result: HumanJudgment = {
    schema_version: 1,
    feedback_id: feedbackId,
    comparison_id: judgment.comparison_id,
    execution_attempt_id: judgment.execution_attempt_id,
    eval_id: judgment.eval_id,
    executor_host: judgment.executor_host,
    repetition: judgment.repetition,
    winner_label: options.winner,
    preferred_version: options.winner === "TIE" ? "TIE" : judgment.labels[options.winner],
    reason: options.reason?.trim() ?? "",
    created_at: new Date().toISOString(),
  };
  await writeJson(join(runDir, "human-judgments.json"), [...previous, result]);
  return result;
}
