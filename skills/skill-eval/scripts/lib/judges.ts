import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mapLimit } from "./async.ts";
import { createHostAdapters } from "./hosts.ts";
import { copyTree, readJson, reserveArtifactDir, writeJson } from "./json.ts";
import { loadSuite, verifyRunIntegrity } from "./workspace.ts";
import type { EvalCase, ExecutionRecord, HostAdapter, HostName, JudgeResult } from "./types.ts";

export interface BlindJudgeOptions {
  runDir: string;
  left: string;
  right: string;
  executionAttemptIds: string[];
  comparisonId?: string;
  judgeHosts: HostName[];
  adapters?: Partial<Record<HostName, HostAdapter>>;
  timeoutMs?: number;
  concurrency?: number;
  seed?: string;
  models?: Partial<Record<HostName, string>>;
}

function safeId(value: string | undefined, prefix: string): string {
  const id = value ?? `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error(`${prefix} id must contain only letters, digits, dot, underscore, or hyphen`);
  return id;
}

function swap(seed: string): boolean {
  return createHash("sha256").update(seed).digest()[0]! % 2 === 1;
}

interface Verdict {
  winner: "A" | "B" | "TIE";
  reasoning: string;
  rubric: Record<string, unknown>;
  strengths: Record<string, string[]>;
  weaknesses: Record<string, string[]>;
}

function parseVerdict(raw: string): Verdict | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value = JSON.parse(cleaned);
    if (!["A", "B", "TIE"].includes(value.winner) || typeof value.reasoning !== "string") return null;
    if (!value.rubric || typeof value.rubric !== "object" || !value.strengths || !value.weaknesses) return null;
    return value as Verdict;
  } catch {
    return null;
  }
}

function prompt(instructions: string, evalName: string, task: string, expectations: string[], aPath: string, bPath: string): string {
  return `${instructions.trim()}\n\nTask: ${task}\nCase: ${evalName}\nCriteria:\n${expectations.map((item) => `- ${item}`).join("\n")}\n\nOutput A artifacts: ${aPath}\nOutput B artifacts: ${bPath}\n\nBuild a task-specific rubric and score each dimension from 1 to 5 and overall quality from 1 to 10. Return only JSON with winner (A, B, or TIE), reasoning, rubric keyed by A/B, strengths keyed by A/B, and weaknesses keyed by A/B.\n`;
}

export async function runBlindJudges(options: BlindJudgeOptions): Promise<JudgeResult[]> {
  if (options.executionAttemptIds.length === 0) throw new Error("blind judging requires explicit execution attempt ids");
  if (options.judgeHosts.length === 0) throw new Error("blind judging requires at least one judge host");
  const runDir = resolve(options.runDir);
  await verifyRunIntegrity(runDir);
  const suite = await loadSuite(runDir);
  const allExecutions = await readJson<ExecutionRecord[]>(join(runDir, "executions.json"));
  const selectedAttempts = new Set(options.executionAttemptIds);
  const executions = allExecutions.filter((item) => selectedAttempts.has(item.attempt_id));
  const id = safeId(options.comparisonId, "comparison");
  const opaqueComparisonId = createHash("sha256").update(id).digest("hex").slice(0, 16);
  let previous: JudgeResult[] = [];
  try { previous = await readJson<JudgeResult[]>(join(runDir, "judgments.json")); } catch { /* first comparison */ }
  if (previous.some((item) => item.comparison_id === id)) throw new Error(`comparison id already exists: ${id}`);
  const comparisonRoot = join(runDir, "artifacts", "judges", opaqueComparisonId);
  await reserveArtifactDir(comparisonRoot);
  await writeJson(join(comparisonRoot, "comparison-attempt.json"), { schema_version: 1, comparison_id: id, status: "started", created_at: new Date().toISOString(), execution_attempt_ids: options.executionAttemptIds, judge_hosts: options.judgeHosts });
  const defaults = createHostAdapters();
  const adapters = { ...defaults, ...options.adapters };
  const comparatorInstructions = await readFile(resolve(import.meta.dir, "../../references/agents/comparator.md"), "utf8");
  const executorHosts = [...new Set(executions.map((item) => item.host))];
  const tasks: Array<{ attempt: string; opaqueAttemptId: string; evalCase: EvalCase; executorHost: HostName; repetition: number; left: ExecutionRecord; right: ExecutionRecord; judgeHost: HostName }> = [];
  for (const attempt of options.executionAttemptIds) {
    const opaqueAttemptId = createHash("sha256").update(attempt).digest("hex").slice(0, 16);
    for (const evalCase of suite.evals) {
      for (const executorHost of executorHosts) {
        const repetitions = [...new Set(executions.filter((item) => item.attempt_id === attempt && item.eval_id === evalCase.id && item.host === executorHost).map((item) => item.repetition))];
        for (const repetition of repetitions) {
          const left = executions.find((item) => item.attempt_id === attempt && item.eval_id === evalCase.id && item.host === executorHost && item.version === options.left && item.repetition === repetition);
          const right = executions.find((item) => item.attempt_id === attempt && item.eval_id === evalCase.id && item.host === executorHost && item.version === options.right && item.repetition === repetition);
          if (left && right) for (const judgeHost of options.judgeHosts) tasks.push({ attempt, opaqueAttemptId, evalCase, executorHost, repetition, left, right, judgeHost });
        }
      }
    }
  }
  const scratchRoot = await mkdtemp(join(tmpdir(), "skill-eval-judge-"));
  let results: JudgeResult[] = [];
  try {
    results = await mapLimit(tasks, options.concurrency ?? 2, async ({ attempt, opaqueAttemptId, evalCase, executorHost, repetition, left, right, judgeHost }) => {
              const opaqueExecutor = createHash("sha256").update(executorHost).digest("hex").slice(0, 8);
              const judgeDir = join(scratchRoot, opaqueAttemptId, evalCase.id, opaqueExecutor, `run-${repetition}`, judgeHost);
              const archiveDir = join(runDir, "artifacts", "judges", opaqueComparisonId, opaqueAttemptId, evalCase.id, executorHost, `run-${repetition}`, judgeHost);
              const inputDir = join(judgeDir, "input");
              await mkdir(inputDir, { recursive: true });
              const shouldSwap = swap(`${options.seed ?? "skill-eval"}:${id}:${attempt}:${evalCase.id}:${executorHost}:${repetition}:${judgeHost}`);
              const labels = shouldSwap ? { A: options.right, B: options.left } : { A: options.left, B: options.right };
              const sourceA = labels.A === options.left ? left.output_dir : right.output_dir;
              const sourceB = labels.B === options.left ? left.output_dir : right.output_dir;
              const aPath = join(inputDir, "A"); const bPath = join(inputDir, "B");
              await copyTree(sourceA, aPath); await copyTree(sourceB, bPath);
              const schemaPath = join(judgeDir, "verdict.schema.json");
              await writeJson(schemaPath, {
                type: "object",
                properties: {
                  winner: { enum: ["A", "B", "TIE"] }, reasoning: { type: "string" },
                  rubric: { type: "object" }, strengths: { type: "object" }, weaknesses: { type: "object" },
                },
                required: ["winner", "reasoning", "rubric", "strengths", "weaknesses"], additionalProperties: false,
              });
              const eventPath = join(judgeDir, "events.jsonl"); const stderrPath = join(judgeDir, "stderr.txt"); const finalPath = join(judgeDir, "final.json");
              const result = await adapters[judgeHost].execute({ cwd: judgeDir, prompt: prompt(comparatorInstructions, evalCase.name, evalCase.prompt, evalCase.expectations.map((item) => item.text), aPath, bPath), eventPath, stderrPath, finalPath, timeoutMs: options.timeoutMs ?? 5 * 60_000, outputSchemaPath: schemaPath, model: options.models?.[judgeHost] });
              const verdict = parseVerdict(result.final_text);
              await writeJson(join(judgeDir, "label-map.json"), labels);
              const winnerLabel = verdict?.winner ?? "TIE";
              const judgeResult: JudgeResult = {
                schema_version: 1, comparison_id: id, execution_attempt_id: attempt, repetition, eval_id: evalCase.id, executor_host: executorHost, judge_host: judgeHost,
                left_version: options.left, right_version: options.right, labels, winner_label: winnerLabel, preferred_version: winnerLabel === "TIE" ? "TIE" : labels[winnerLabel],
                reasoning: verdict?.reasoning ?? `invalid judge output: ${result.final_text.slice(0, 500)}`,
                rubric: verdict?.rubric, strengths: verdict?.strengths, weaknesses: verdict?.weaknesses,
                valid: verdict !== null && result.exit_code === 0, run_dir: archiveDir,
              };
              await copyTree(judgeDir, archiveDir);
              await writeJson(join(archiveDir, "judgment.json"), judgeResult);
              return judgeResult;
    });
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
  if (results.length === 0) throw new Error("blind judging found no paired executions");
  await writeJson(join(runDir, "judgments.json"), [...previous, ...results]);
  await writeJson(join(comparisonRoot, "comparison-attempt.json"), { schema_version: 1, comparison_id: id, status: "complete", completed_at: new Date().toISOString(), execution_attempt_ids: options.executionAttemptIds, judge_hosts: options.judgeHosts, record_count: results.length });
  return results;
}
