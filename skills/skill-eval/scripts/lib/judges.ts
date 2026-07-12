import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { mapLimit } from "./async.ts";
import { createHostAdapters } from "./hosts.ts";
import { copyTree, parseJsonObject, readJson, reserveArtifactDir, writeJson } from "./json.ts";
import { executionCanBeGraded, executionFailure } from "./validity.ts";
import { expectationAppliesTo, hasBlindJudgeCriteria } from "./expectations.ts";
import { loadSuite, verifyRunIntegrity } from "./workspace.ts";
import type { EvalCase, ExecutionRecord, GradingResult, HostAdapter, HostName, JudgeResult } from "./types.ts";

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
  reasoningEfforts?: Partial<Record<HostName, string>>;
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
  rubric: Array<{ criterion: string; A: number; B: number }>;
  overall: { A: number; B: number };
  strengths: Record<string, string[]>;
  weaknesses: Record<string, string[]>;
  expectations: Array<{ id: string; winner: "A" | "B" | "TIE" | "BLOCKED"; evidence: string }>;
}

function parseVerdict(raw: string, expectedIds: string[]): Verdict | null {
  try {
    const value = parseJsonObject(raw);
    if (!value) return null;
    if (!["A", "B", "TIE"].includes(value.winner) || typeof value.reasoning !== "string") return null;
    if (!Array.isArray(value.rubric) || !value.overall || !value.strengths || !value.weaknesses || !Array.isArray(value.expectations)) return null;
    if (value.expectations.some((item: any) => typeof item?.id !== "string" || !["A", "B", "TIE", "BLOCKED"].includes(item.winner) || typeof item.evidence !== "string")) return null;
    const ids = value.expectations.map((item: any) => item.id).sort();
    if (new Set(ids).size !== ids.length || JSON.stringify(ids) !== JSON.stringify([...expectedIds].sort())) return null;
    return value as Verdict;
  } catch {
    return null;
  }
}

function prompt(instructions: string, evalName: string, task: string, expectations: string[], comparisonIds: string[], aPath: string, bPath: string, projected: boolean): string {
  const evidenceDescription = projected
    ? "Each package contains a symmetrically projected copy of the delivered task artifacts plus arm-symmetric objective grading. Treatment-identifying metadata and tool traces are intentionally withheld from this quality comparison; mechanism validity was evaluated separately."
    : "Each package contains task artifacts plus an evidence directory with path-scrubbed structured tool events and arm-symmetric objective grading. Use the structured events when a criterion depends on mechanism evidence; do not infer a tool result from final prose.";
  return `${instructions.trim()}\n\nTask: ${task}\nCase: ${evalName}\nCriteria:\n${expectations.map((item) => `- ${item}`).join("\n")}\n\nComparison-scoped expectation IDs: ${comparisonIds.length > 0 ? comparisonIds.join(", ") : "none"}\nAnonymous package A: ${aPath}\nAnonymous package B: ${bPath}\n${evidenceDescription}\n\nBuild a task-specific rubric and score each dimension from 1 to 5 and overall quality from 1 to 10. For every comparison-scoped expectation ID, separately return whether A, B, or neither has the material advantage; use BLOCKED only when the artifacts cannot support a decision. Return only JSON with winner (A, B, or TIE), reasoning, rubric as [{criterion,A,B}], overall as {A,B}, strengths/weaknesses as {A:[...],B:[...]}, and expectations as [{id,winner:A|B|TIE|BLOCKED,evidence}].\n`;
}

type ComparisonProjection = NonNullable<NonNullable<Awaited<ReturnType<typeof loadSuite>>["environment"]>["comparison_projection"]>;

function projectText(text: string, projection: ComparisonProjection): string {
  for (const redaction of projection.text_redactions) text = text.replace(new RegExp(redaction.pattern, "g"), redaction.replacement);
  return text;
}

function projectValue(value: unknown, projection: ComparisonProjection): unknown {
  if (typeof value === "string") return projectText(value, projection);
  if (Array.isArray(value)) return value.map((item) => projectValue(item, projection));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, projectValue(item, projection)]));
  return value;
}

async function applyTextProjection(root: string, projection: ComparisonProjection): Promise<void> {
  const glob = new Bun.Glob("**/*");
  for await (const path of glob.scan({ cwd: root, absolute: true, onlyFiles: true })) {
    const info = await stat(path);
    if (info.size > 2 * 1024 * 1024) continue;
    const buffer = await readFile(path);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { continue; }
    await writeFile(path, projectText(text, projection));
  }
}

async function applyPathProjection(root: string, projection: ComparisonProjection): Promise<void> {
  const projectedRoot = `${root}.projection-${randomUUID()}`;
  async function copyProjected(source: string, destination: string): Promise<void> {
    await mkdir(destination, { recursive: true });
    const names = new Set<string>();
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const projectedName = projectText(entry.name, projection);
      if (!projectedName || projectedName === "." || projectedName === ".." || /[/\\]/.test(projectedName)) {
        throw new Error(`comparison projection produced an invalid artifact path from ${relative(root, join(source, entry.name))}`);
      }
      if (names.has(projectedName)) throw new Error(`comparison projection path collision: ${relative(root, join(source, projectedName))}`);
      names.add(projectedName);
      const sourcePath = join(source, entry.name);
      const destinationPath = join(destination, projectedName);
      if (entry.isDirectory()) await copyProjected(sourcePath, destinationPath);
      else await cp(sourcePath, destinationPath, { recursive: true, dereference: false, preserveTimestamps: true });
    }
  }
  try {
    await copyProjected(root, projectedRoot);
    await rm(root, { recursive: true, force: true });
    await rename(projectedRoot, root);
  } catch (error) {
    await rm(projectedRoot, { recursive: true, force: true });
    throw error;
  }
}

async function writeAnonymousPackage(record: ExecutionRecord, grade: GradingResult, destination: string, projection?: ComparisonProjection): Promise<void> {
  const artifacts = join(destination, "artifacts");
  const evidence = join(destination, "evidence");
  await mkdir(evidence, { recursive: true });
  await copyTree(record.output_dir, artifacts);
  if (projection) {
    await applyTextProjection(artifacts, projection);
    await applyPathProjection(artifacts, projection);
  }
  let transcript = "";
  try { transcript = await readFile(record.host_result.event_path, "utf8"); } catch { /* valid adapters may omit a transcript in tests */ }
  if (record.run_dir) transcript = transcript.split(record.run_dir).join("/anonymous/run");
  if (record.skill_path) transcript = transcript.split(record.skill_path).join("/anonymous/run/skill");
  const toolEvents: string[] = [];
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      let toolEvent: unknown;
      if (event.type === "assistant" && Array.isArray(event.message?.content)) {
        const content = event.message.content.filter((item: any) => item?.type === "tool_use");
        if (content.length > 0) toolEvent = { type: "assistant", message: { content } };
      } else if (event.type === "user" && Array.isArray(event.message?.content)) {
        const content = event.message.content.filter((item: any) => item?.type === "tool_result");
        if (content.length > 0) toolEvent = { type: "user", message: { content } };
      } else if (event.type === "item.completed" && ["command_execution", "mcp_tool_call", "web_search", "file_change"].includes(event.item?.type)) {
        toolEvent = event;
      } else if (event.type === "tool_use") {
        toolEvent = event;
      }
      if (toolEvent) toolEvents.push(JSON.stringify(projection ? projectValue(toolEvent, projection) : toolEvent));
    } catch { /* malformed source events make the execution ineligible before judging */ }
  }
  if (!projection?.omit_tool_events) await writeFile(join(evidence, "tool-events.jsonl"), toolEvents.join("\n"));
  await writeJson(join(evidence, "objective-grading.json"), {
    schema_version: 2,
    expectations: grade.expectations
      .filter((item) => (item.passed !== null || item.blocked) && (item.version_scope === undefined || item.version_scope === "all"))
      .map((item) => ({
        id: item.id,
        severity: item.severity,
        evidence_role: item.evidence_role,
        prerequisite: item.prerequisite === true,
        passed: item.passed,
        blocked: item.blocked,
        evidence: projection ? projectText(item.evidence, projection) : item.evidence,
      })),
    execution: { exit_success: !grade.summary.run_failed, critical_failed: grade.summary.critical_failed, critical_blocked: grade.summary.critical_blocked },
  });
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
  let objectiveGrades: GradingResult[] = [];
  try { objectiveGrades = await readJson<GradingResult[]>(join(runDir, "gradings.json")); } catch { /* direct judging may follow execution before aggregate grading */ }
  const gradeFor = (record: ExecutionRecord) => objectiveGrades.find((item) => item.attempt_id === record.attempt_id && item.host === record.host && item.eval_id === record.eval_id && item.version === record.version && item.repetition === record.repetition);
  const id = safeId(options.comparisonId, "comparison");
  const opaqueComparisonId = createHash("sha256").update(id).digest("hex").slice(0, 16);
  let previous: JudgeResult[] = [];
  try { previous = await readJson<JudgeResult[]>(join(runDir, "judgments.json")); } catch { /* first comparison */ }
  if (previous.some((item) => item.comparison_id === id)) throw new Error(`comparison id already exists: ${id}`);
  const comparisonRoot = join(runDir, "artifacts", "judges", opaqueComparisonId);
  await reserveArtifactDir(comparisonRoot);
  const defaults = createHostAdapters();
  const adapters = { ...defaults, ...options.adapters };
  const comparatorInstructions = await readFile(resolve(import.meta.dir, "../../references/agents/comparator.md"), "utf8");
  const executorHosts = [...new Set(executions.map((item) => item.host))];
  const tasks: Array<{ attempt: string; opaqueAttemptId: string; evalCase: EvalCase; executorHost: HostName; repetition: number; left: ExecutionRecord; right: ExecutionRecord; judgeHost: HostName }> = [];
  const skippedPairs: Array<{ attempt_id: string; eval_id: string; executor_host: HostName; repetition: number; reason: string }> = [];
  for (const attempt of options.executionAttemptIds) {
    const opaqueAttemptId = createHash("sha256").update(attempt).digest("hex").slice(0, 16);
    for (const evalCase of suite.evals) {
      if (!hasBlindJudgeCriteria(evalCase, options.left, options.right)) continue;
      for (const executorHost of executorHosts) {
        const repetitions = [...new Set(executions.filter((item) => item.attempt_id === attempt && item.eval_id === evalCase.id && item.host === executorHost).map((item) => item.repetition))];
        for (const repetition of repetitions) {
          const left = executions.find((item) => item.attempt_id === attempt && item.eval_id === evalCase.id && item.host === executorHost && item.version === options.left && item.repetition === repetition);
          const right = executions.find((item) => item.attempt_id === attempt && item.eval_id === evalCase.id && item.host === executorHost && item.version === options.right && item.repetition === repetition);
          if (!left || !right) continue;
          const leftGrade = gradeFor(left);
          const rightGrade = gradeFor(right);
          const rightCriticalFailure = rightGrade && (rightGrade.summary.critical_failed > 0 || rightGrade.summary.critical_blocked > 0);
          if (!executionCanBeGraded(left) || !executionCanBeGraded(right) || !leftGrade || !rightGrade || rightCriticalFailure) {
            skippedPairs.push({
              attempt_id: attempt, eval_id: evalCase.id, executor_host: executorHost, repetition,
              reason: executionFailure(left) ?? executionFailure(right) ?? (!leftGrade || !rightGrade ? "objective grading missing" : "candidate objective critical gate failed"),
            });
            continue;
          }
          for (const judgeHost of options.judgeHosts) tasks.push({ attempt, opaqueAttemptId, evalCase, executorHost, repetition, left, right, judgeHost });
        }
      }
    }
  }
  await writeJson(join(comparisonRoot, "comparison-attempt.json"), { schema_version: 2, comparison_id: id, status: "started", created_at: new Date().toISOString(), execution_attempt_ids: options.executionAttemptIds, judge_hosts: options.judgeHosts, skipped_pairs: skippedPairs });
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
              const recordA = labels.A === options.left ? left : right;
              const recordB = labels.B === options.left ? left : right;
              const gradeA = labels.A === options.left ? gradeFor(left)! : gradeFor(right)!;
              const gradeB = labels.B === options.left ? gradeFor(left)! : gradeFor(right)!;
              const aPath = join(inputDir, "A"); const bPath = join(inputDir, "B");
              const projection = suite.environment?.comparison_projection;
              await writeAnonymousPackage(recordA, gradeA, aPath, projection);
              await writeAnonymousPackage(recordB, gradeB, bPath, projection);
              const schemaPath = join(judgeDir, "verdict.schema.json");
              await writeJson(schemaPath, {
                type: "object",
                properties: {
                  winner: { type: "string", enum: ["A", "B", "TIE"] }, reasoning: { type: "string" },
                  rubric: { type: "array", items: { type: "object", properties: { criterion: { type: "string" }, A: { type: "integer", minimum: 1, maximum: 5 }, B: { type: "integer", minimum: 1, maximum: 5 } }, required: ["criterion", "A", "B"], additionalProperties: false } },
                  overall: { type: "object", properties: { A: { type: "integer", minimum: 1, maximum: 10 }, B: { type: "integer", minimum: 1, maximum: 10 } }, required: ["A", "B"], additionalProperties: false },
                  strengths: { type: "object", properties: { A: { type: "array", items: { type: "string" } }, B: { type: "array", items: { type: "string" } } }, required: ["A", "B"], additionalProperties: false },
                  weaknesses: { type: "object", properties: { A: { type: "array", items: { type: "string" } }, B: { type: "array", items: { type: "string" } } }, required: ["A", "B"], additionalProperties: false },
                  expectations: { type: "array", items: { type: "object", properties: { id: { type: "string" }, winner: { type: "string", enum: ["A", "B", "TIE", "BLOCKED"] }, evidence: { type: "string" } }, required: ["id", "winner", "evidence"], additionalProperties: false } },
                },
                required: ["winner", "reasoning", "rubric", "overall", "strengths", "weaknesses", "expectations"], additionalProperties: false,
              });
              const eventPath = join(judgeDir, "events.jsonl"); const stderrPath = join(judgeDir, "stderr.txt"); const finalPath = join(judgeDir, "final.json");
              const comparisonExpectations = evalCase.expectations.filter((item) => item.evidence_role === "outcome" && item.scope === "comparison");
              const commonExecutionExpectations = evalCase.expectations.filter((item) => item.evidence_role === "outcome" && !item.check && item.scope !== "comparison" && expectationAppliesTo(item, options.left) && expectationAppliesTo(item, options.right));
              const criteria = [...commonExecutionExpectations, ...comparisonExpectations].map((item) => `${item.id} [${item.scope ?? "execution"}]: ${item.text}`);
              const result = await adapters[judgeHost].execute({ cwd: judgeDir, prompt: prompt(comparatorInstructions, evalCase.name, evalCase.prompt, criteria, comparisonExpectations.map((item) => item.id), aPath, bPath, projection !== undefined), eventPath, stderrPath, finalPath, timeoutMs: options.timeoutMs ?? 5 * 60_000, outputSchemaPath: schemaPath, model: options.models?.[judgeHost], reasoningEffort: options.reasoningEfforts?.[judgeHost], role: "judge", capabilities: ["artifact-read", "blind-comparison"] });
              const verdict = parseVerdict(result.final_text, comparisonExpectations.map((item) => item.id));
              await writeJson(join(judgeDir, "label-map.json"), labels);
              const winnerLabel = verdict?.winner ?? "TIE";
              const judgeResult: JudgeResult = {
                schema_version: 2, comparison_id: id, execution_attempt_id: attempt, repetition, eval_id: evalCase.id, executor_host: executorHost, judge_host: judgeHost,
                left_version: options.left, right_version: options.right, labels, winner_label: winnerLabel, preferred_version: winnerLabel === "TIE" ? "TIE" : labels[winnerLabel],
                reasoning: verdict?.reasoning ?? `invalid judge output: ${result.final_text.slice(0, 500)}`,
                rubric: verdict ? { dimensions: verdict.rubric, overall: verdict.overall } : undefined, strengths: verdict?.strengths, weaknesses: verdict?.weaknesses,
                expectations: verdict?.expectations.map((item) => {
                  const expectation = comparisonExpectations.find((candidate) => candidate.id === item.id)!;
                  const preferred = item.winner === "BLOCKED" ? "BLOCKED" : item.winner === "TIE" ? "TIE" : labels[item.winner];
                  const passed = expectation.comparison_goal === "improve" ? preferred === options.right : preferred === options.right || preferred === "TIE";
                  return { id: item.id, severity: expectation.severity, evidence_role: expectation.evidence_role, goal: expectation.comparison_goal!, status: item.winner === "BLOCKED" ? "BLOCKED" as const : passed ? "PASS" as const : "FAIL" as const, evidence: item.evidence };
                }),
                valid: verdict !== null && result.exit_code === 0, run_dir: archiveDir, runtime_profile: result.runtime_profile,
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
  await writeJson(join(comparisonRoot, "comparison-attempt.json"), { schema_version: 2, comparison_id: id, status: "complete", completed_at: new Date().toISOString(), execution_attempt_ids: options.executionAttemptIds, judge_hosts: options.judgeHosts, record_count: results.length, skipped_pairs: skippedPairs });
  return results;
}
