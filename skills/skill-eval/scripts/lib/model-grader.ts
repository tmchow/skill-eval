import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHostAdapters } from "./hosts.ts";
import { copyTree, readJson, reserveArtifactDir, writeJson } from "./json.ts";
import { loadSuite, verifyRunIntegrity } from "./workspace.ts";
import type { ExecutionRecord, HostAdapter, HostName, ModelGradingResult } from "./types.ts";

export interface ModelGraderOptions {
  runDir: string;
  executionAttemptIds: string[];
  gradingId: string;
  graderHosts: HostName[];
  adapters?: Partial<Record<HostName, HostAdapter>>;
  timeoutMs?: number;
  models?: Partial<Record<HostName, string>>;
}

function parse(raw: string): { expectations: any[]; claims: any[]; eval_feedback: any[] } | null {
  try {
    const value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (!Array.isArray(value.expectations) || !Array.isArray(value.claims) || !Array.isArray(value.eval_feedback)) return null;
    return value;
  } catch { return null; }
}

export async function runModelGraders(options: ModelGraderOptions): Promise<ModelGradingResult[]> {
  if (options.graderHosts.length === 0) throw new Error("model grading requires at least one grader host");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.gradingId)) throw new Error("grading id must contain only letters, digits, dot, underscore, or hyphen");
  const runDir = resolve(options.runDir);
  await verifyRunIntegrity(runDir);
  const suite = await loadSuite(runDir);
  const attempts = new Set(options.executionAttemptIds);
  const executions = (await readJson<ExecutionRecord[]>(join(runDir, "executions.json"))).filter((item) => attempts.has(item.attempt_id));
  if (executions.length === 0) throw new Error("model grading requires executions from the selected attempts");
  let previous: ModelGradingResult[] = [];
  try { previous = await readJson<ModelGradingResult[]>(join(runDir, "model-gradings.json")); } catch { /* first grading */ }
  if (previous.some((item) => item.grading_id === options.gradingId)) throw new Error(`grading id already exists: ${options.gradingId}`);
  const gradingRoot = join(runDir, "artifacts", "model-graders", options.gradingId);
  await reserveArtifactDir(gradingRoot);
  await writeJson(join(gradingRoot, "grading-attempt.json"), { schema_version: 1, grading_id: options.gradingId, status: "started", created_at: new Date().toISOString(), execution_attempt_ids: options.executionAttemptIds, grader_hosts: options.graderHosts });
  const adapters = { ...createHostAdapters(), ...options.adapters };
  const graderInstructions = await readFile(resolve(import.meta.dir, "../../references/agents/grader.md"), "utf8");
  const results: ModelGradingResult[] = [];
  for (const execution of executions) {
    const evalCase = suite.evals.find((item) => item.id === execution.eval_id);
    if (!evalCase) continue;
    const qualitative = evalCase.expectations.filter((item) => !item.check);
    if (qualitative.length === 0) continue;
    for (const graderHost of options.graderHosts) {
      const graderDir = join(runDir, "artifacts", "model-graders", options.gradingId, execution.attempt_id, execution.eval_id, execution.host, `run-${execution.repetition}`, graderHost);
      const inputDir = join(graderDir, "input"); await mkdir(inputDir, { recursive: true });
      const outputPath = join(inputDir, "artifacts"); await copyTree(execution.output_dir, outputPath);
      const transcriptPath = join(inputDir, "events.jsonl");
      try {
        const transcript = await readFile(execution.host_result.event_path, "utf8");
        await writeFile(transcriptPath, transcript.split(execution.run_dir).join("/anonymous/run"));
      } catch { await writeFile(transcriptPath, ""); }
      const schemaPath = join(graderDir, "grading.schema.json");
      await writeJson(schemaPath, { type: "object", properties: { expectations: { type: "array" }, claims: { type: "array" }, eval_feedback: { type: "array" } }, required: ["expectations", "claims", "eval_feedback"], additionalProperties: false });
      const expectationText = qualitative.map((item) => `- ${item.id}: ${item.text}`).join("\n");
      const prompt = `${graderInstructions.trim()}\n\nGrade one anonymous execution for the task below.\n\nTask: ${evalCase.prompt}\nExpectations:\n${expectationText}\nArtifacts: ${outputPath}\nEvent transcript: ${transcriptPath}\n\nReturn only JSON: expectations [{id,status:PASS|FAIL|BLOCKED,evidence}], claims [{claim,type:factual|process|quality,verified,evidence}], eval_feedback [{expectation_id?,issue}].`;
      const eventPath = join(graderDir, "events.jsonl"); const stderrPath = join(graderDir, "stderr.txt"); const finalPath = join(graderDir, "final.json");
      const hostResult = await adapters[graderHost].execute({ cwd: graderDir, prompt, eventPath, stderrPath, finalPath, outputSchemaPath: schemaPath, timeoutMs: options.timeoutMs ?? 300_000, model: options.models?.[graderHost] });
      const parsed = parse(hostResult.final_text);
      const byId = new Map(qualitative.map((item) => [item.id, item]));
      const expectations = (parsed?.expectations ?? []).filter((item: any) => byId.has(item.id) && ["PASS", "FAIL", "BLOCKED"].includes(item.status) && typeof item.evidence === "string").map((item: any) => ({ ...item, severity: byId.get(item.id)!.severity }));
      results.push({
        schema_version: 1, grading_id: options.gradingId, execution_attempt_id: execution.attempt_id, partition: execution.partition, executor_host: execution.host, grader_host: graderHost,
        eval_id: execution.eval_id, version: execution.version, repetition: execution.repetition, expectations,
        claims: parsed?.claims ?? [], eval_feedback: parsed?.eval_feedback ?? [], valid: parsed !== null && expectations.length === qualitative.length && hostResult.exit_code === 0, run_dir: graderDir,
      });
    }
  }
  await writeJson(join(runDir, "model-gradings.json"), [...previous, ...results]);
  await writeJson(join(gradingRoot, "grading-attempt.json"), { schema_version: 1, grading_id: options.gradingId, status: "complete", completed_at: new Date().toISOString(), execution_attempt_ids: options.executionAttemptIds, grader_hosts: options.graderHosts, record_count: results.length });
  return results;
}
