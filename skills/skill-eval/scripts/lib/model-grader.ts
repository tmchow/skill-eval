import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mapLimit } from "./async.ts";
import { createHostAdapters } from "./hosts.ts";
import { copyTree, parseJsonObject, readJson, reserveArtifactDir, writeJson } from "./json.ts";
import { executionCanBeGraded, executionFailure } from "./validity.ts";
import { expectationAppliesTo } from "./expectations.ts";
import { loadSuite, verifyRunIntegrity } from "./workspace.ts";
import type { EvalCase, ExecutionRecord, Expectation, HostAdapter, HostName, ModelGradingResult } from "./types.ts";

export interface ModelGraderOptions {
  runDir: string;
  executionAttemptIds: string[];
  gradingId: string;
  graderHosts: HostName[];
  adapters?: Partial<Record<HostName, HostAdapter>>;
  timeoutMs?: number;
  concurrency?: number;
  models?: Partial<Record<HostName, string>>;
  reasoningEfforts?: Partial<Record<HostName, string>>;
}

interface ParsedGrading {
  expectations: Array<{ id: string; status: "PASS" | "FAIL" | "BLOCKED"; evidence: string }>;
  claims: ModelGradingResult["claims"];
  eval_feedback: ModelGradingResult["eval_feedback"];
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parse(raw: string): ParsedGrading | null {
  try {
    const value = object(parseJsonObject(raw));
    if (!value || !Array.isArray(value.expectations) || !Array.isArray(value.claims) || !Array.isArray(value.eval_feedback)) return null;
    const expectations = value.expectations.map(object);
    const claims = value.claims.map(object);
    const feedback = value.eval_feedback.map(object);
    if (expectations.some((item) => !item || typeof item.id !== "string" || !["PASS", "FAIL", "BLOCKED"].includes(String(item.status)) || typeof item.evidence !== "string")) return null;
    if (claims.some((item) => !item || typeof item.claim !== "string" || !["factual", "process", "quality"].includes(String(item.type)) || typeof item.verified !== "boolean" || typeof item.evidence !== "string")) return null;
    if (feedback.some((item) => !item || typeof item.issue !== "string" || (item.expectation_id !== undefined && item.expectation_id !== null && typeof item.expectation_id !== "string"))) return null;
    return {
      expectations: expectations as ParsedGrading["expectations"],
      claims: claims as ParsedGrading["claims"],
      eval_feedback: feedback.map((item) => item!.expectation_id === null ? { issue: item!.issue as string } : item) as ParsedGrading["eval_feedback"],
    };
  } catch { return null; }
}

export async function runModelGraders(options: ModelGraderOptions): Promise<ModelGradingResult[]> {
  if (options.graderHosts.length === 0) throw new Error("model grading requires at least one grader host");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.gradingId)) throw new Error("grading id must contain only letters, digits, dot, underscore, or hyphen");
  const runDir = resolve(options.runDir);
  await verifyRunIntegrity(runDir);
  const suite = await loadSuite(runDir);
  const attempts = new Set(options.executionAttemptIds);
  const selectedExecutions = (await readJson<ExecutionRecord[]>(join(runDir, "executions.json"))).filter((item) => attempts.has(item.attempt_id));
  if (selectedExecutions.length === 0) throw new Error("model grading requires executions from the selected attempts");
  const selectedEvalIds = new Set(selectedExecutions.map((item) => item.eval_id));
  if (!selectedExecutions.some((execution) => {
    const evalCase = suite.evals.find((item) => item.id === execution.eval_id);
    return evalCase?.expectations.some((expectation) => !expectation.check && expectation.scope !== "comparison" && expectationAppliesTo(expectation, execution.version));
  })) {
    throw new Error("model grading requires at least one execution-scoped qualitative expectation");
  }
  const executions = selectedExecutions.filter(executionCanBeGraded);
  const skipped = selectedExecutions.filter((item) => !executionCanBeGraded(item)).map((item) => ({
    attempt_id: item.attempt_id, host: item.host, eval_id: item.eval_id, version: item.version, repetition: item.repetition,
    reason: executionFailure(item)!,
  }));
  if (executions.length === 0) throw new Error("model grading found no successful executions");
  let previous: ModelGradingResult[] = [];
  try { previous = await readJson<ModelGradingResult[]>(join(runDir, "model-gradings.json")); } catch { /* first grading */ }
  if (previous.some((item) => item.grading_id === options.gradingId)) throw new Error(`grading id already exists: ${options.gradingId}`);
  const gradingRoot = join(runDir, "artifacts", "model-graders", options.gradingId);
  await reserveArtifactDir(gradingRoot);
  await writeJson(join(gradingRoot, "grading-attempt.json"), { schema_version: 2, grading_id: options.gradingId, status: "started", created_at: new Date().toISOString(), execution_attempt_ids: options.executionAttemptIds, grader_hosts: options.graderHosts, skipped_executions: skipped });
  const adapters = { ...createHostAdapters(), ...options.adapters };
  const graderInstructions = await readFile(resolve(import.meta.dir, "../../references/agents/grader.md"), "utf8");
  const tasks: Array<{ execution: ExecutionRecord; evalCase: EvalCase; qualitative: Expectation[]; graderHost: HostName }> = [];
  for (const execution of executions) {
    const evalCase = suite.evals.find((item) => item.id === execution.eval_id);
    if (!evalCase) continue;
    const qualitative = evalCase.expectations.filter((item) => !item.check && item.scope !== "comparison" && expectationAppliesTo(item, execution.version));
    for (const graderHost of options.graderHosts) if (qualitative.length > 0) tasks.push({ execution, evalCase, qualitative, graderHost });
  }
  const scratchRoot = await mkdtemp(join(tmpdir(), "skill-eval-grader-"));
  let results: ModelGradingResult[] = [];
  try {
    results = await mapLimit(tasks, options.concurrency ?? 2, async ({ execution, evalCase, qualitative, graderHost }) => {
        const opaqueExecution = createHash("sha256").update(`${execution.attempt_id}\0${execution.eval_id}\0${execution.host}\0${execution.version}\0${execution.repetition}`).digest("hex").slice(0, 16);
        const graderDir = join(scratchRoot, opaqueExecution, graderHost);
        const archiveDir = join(runDir, "artifacts", "model-graders", options.gradingId, execution.attempt_id, execution.eval_id, execution.host, execution.version, `run-${execution.repetition}`, graderHost);
        const inputDir = join(graderDir, "input"); await mkdir(inputDir, { recursive: true });
        const outputPath = join(inputDir, "artifacts"); await copyTree(execution.output_dir, outputPath);
        const transcriptPath = join(inputDir, "events.jsonl");
        try {
          const transcript = await readFile(execution.host_result.event_path, "utf8");
          await writeFile(transcriptPath, transcript.split(execution.run_dir).join("/anonymous/run"));
        } catch { await writeFile(transcriptPath, ""); }
        const schemaPath = join(graderDir, "grading.schema.json");
        await writeJson(schemaPath, {
          type: "object",
          properties: {
            expectations: { type: "array", items: { type: "object", properties: { id: { type: "string" }, status: { type: "string", enum: ["PASS", "FAIL", "BLOCKED"] }, evidence: { type: "string" } }, required: ["id", "status", "evidence"], additionalProperties: false } },
            claims: { type: "array", items: { type: "object", properties: { claim: { type: "string" }, type: { type: "string", enum: ["factual", "process", "quality"] }, verified: { type: "boolean" }, evidence: { type: "string" } }, required: ["claim", "type", "verified", "evidence"], additionalProperties: false } },
            eval_feedback: { type: "array", items: { type: "object", properties: { expectation_id: { type: ["string", "null"] }, issue: { type: "string" } }, required: ["expectation_id", "issue"], additionalProperties: false } },
          },
          required: ["expectations", "claims", "eval_feedback"],
          additionalProperties: false,
        });
        const expectationText = qualitative.map((item) => `- ${item.id}: ${item.text}`).join("\n");
        const prompt = `${graderInstructions.trim()}\n\nGrade one anonymous execution for the task below.\n\nTask: ${evalCase.prompt}\nExpectations:\n${expectationText}\nArtifacts: ${outputPath}\nEvent transcript: ${transcriptPath}\n\nReturn only JSON: expectations [{id,status:PASS|FAIL|BLOCKED,evidence}], claims [{claim,type:factual|process|quality,verified,evidence}], eval_feedback [{expectation_id:string|null,issue}].`;
        const eventPath = join(graderDir, "events.jsonl"); const stderrPath = join(graderDir, "stderr.txt"); const finalPath = join(graderDir, "final.json");
        const hostResult = await adapters[graderHost].execute({ cwd: graderDir, prompt, eventPath, stderrPath, finalPath, outputSchemaPath: schemaPath, timeoutMs: options.timeoutMs ?? 300_000, model: options.models?.[graderHost], reasoningEffort: options.reasoningEfforts?.[graderHost], role: "grader", capabilities: ["artifact-read"] });
        const parsed = parse(hostResult.final_text);
        const byId = new Map(qualitative.map((item) => [item.id, item]));
        const expectations = (parsed?.expectations ?? []).filter((item) => byId.has(item.id)).map((item) => ({
          ...item,
          severity: byId.get(item.id)!.severity,
          evidence_role: byId.get(item.id)!.evidence_role,
        }));
        const expectationIds = new Set(expectations.map((item) => item.id));
        const grading: ModelGradingResult = {
          schema_version: 2, grading_id: options.gradingId, execution_attempt_id: execution.attempt_id, partition: execution.partition, executor_host: execution.host, grader_host: graderHost,
          eval_id: execution.eval_id, version: execution.version, repetition: execution.repetition, expectations,
          claims: parsed?.claims ?? [], eval_feedback: parsed?.eval_feedback ?? [], valid: parsed !== null && expectations.length === qualitative.length && expectationIds.size === qualitative.length && hostResult.exit_code === 0, run_dir: graderDir,
          runtime_profile: hostResult.runtime_profile,
        };
        await copyTree(graderDir, archiveDir);
        grading.run_dir = archiveDir;
        await writeJson(join(archiveDir, "grading.json"), grading);
        return grading;
    });
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
  await writeJson(join(runDir, "model-gradings.json"), [...previous, ...results]);
  await writeJson(join(gradingRoot, "grading-attempt.json"), { schema_version: 2, grading_id: options.gradingId, status: "complete", completed_at: new Date().toISOString(), execution_attempt_ids: options.executionAttemptIds, grader_hosts: options.graderHosts, record_count: results.length, skipped_executions: skipped });
  return results;
}
