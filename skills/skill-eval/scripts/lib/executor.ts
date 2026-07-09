import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { copyTree, hashTree, readJson, reserveArtifactDir, writeJson } from "./json.ts";
import { createHostAdapters } from "./hosts.ts";
import { loadRun, loadSuite, verifyRunIntegrity } from "./workspace.ts";
import type { EvidencePartition, ExecutionRecord, HostAdapter, HostName } from "./types.ts";

export interface RunMatrixOptions {
  runDir: string;
  versions: string[];
  hosts: HostName[];
  repetitions?: number;
  timeoutMs?: number;
  concurrency?: number;
  adapters?: Partial<Record<HostName, HostAdapter>>;
  attemptId?: string;
  partition?: EvidencePartition | "all";
  evalIds?: string[];
  models?: Partial<Record<HostName, string>>;
}

function attemptId(value?: string): string {
  const id = value ?? `behavior-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error("attempt id must contain only letters, digits, dot, underscore, or hyphen");
  return id;
}

function executorPrompt(skillPath: string | null, task: string, outputDir: string): string {
  const skillInstruction = skillPath
    ? `Exact skill snapshot: ${skillPath}\nRead its SKILL.md and follow that skill for this task. Load bundled files only as directed by that skill.`
    : "No additional skill instructions are supplied. Complete the task using only your normal capabilities.";
  return `You are completing a real user task inside an isolated workspace.\n\n${skillInstruction}\n\nUser task:\n${task}\n\nWrite task artifacts under: ${outputDir}\nDo not discuss comparisons, expected results, or alternative instructions. Complete the task normally.\n`;
}

async function mapLimit<T, R>(items: T[], limit: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function runMatrix(options: RunMatrixOptions): Promise<ExecutionRecord[]> {
  if (options.hosts.length === 0) throw new Error("behavior execution requires at least one host");
  if (options.versions.length === 0) throw new Error("behavior execution requires at least one version");
  const runDir = resolve(options.runDir);
  await verifyRunIntegrity(runDir);
  const state = await loadRun(runDir);
  const suite = await loadSuite(runDir);
  const id = attemptId(options.attemptId);
  let previous: ExecutionRecord[] = [];
  try { previous = await readJson<ExecutionRecord[]>(join(runDir, "executions.json")); } catch { /* first matrix */ }
  if (previous.some((record) => record.attempt_id === id)) throw new Error(`attempt id already exists: ${id}`);
  const defaults = createHostAdapters();
  const adapters = { ...defaults, ...options.adapters };
  const tasks: Array<{ host: HostName; version: string; evalId: string; repetition: number }> = [];
  const partition = options.partition ?? "training";
  const selectedEvals = suite.evals.filter((evalCase) => {
    if (options.evalIds && !options.evalIds.includes(evalCase.id)) return false;
    if (partition === "all") return true;
    return partition === (evalCase.holdout ? "holdout" : "training");
  });
  if (selectedEvals.length === 0) throw new Error(`no ${partition} behavior evals selected`);
  for (const host of options.hosts) {
    for (const evalCase of selectedEvals) {
      for (const version of options.versions) {
        for (let repetition = 1; repetition <= (options.repetitions ?? 1); repetition += 1) {
          tasks.push({ host, version, evalId: evalCase.id, repetition });
        }
      }
    }
  }
  const attemptRoot = join(runDir, "artifacts", "runs", id);
  await reserveArtifactDir(attemptRoot);
  const manifestPath = join(attemptRoot, "attempt.json");
  const manifest = {
    schema_version: 1, attempt_id: id, kind: "behavior", status: "started", created_at: new Date().toISOString(),
    partition, versions: [...options.versions], hosts: [...options.hosts], eval_ids: selectedEvals.map((item) => item.id),
    repetitions: options.repetitions ?? 1, planned_records: tasks.length,
  };
  await writeJson(manifestPath, manifest);
  const records = await mapLimit(tasks, options.concurrency ?? 2, async (task): Promise<ExecutionRecord> => {
    const evalCase = suite.evals.find((item) => item.id === task.evalId)!;
    const executionDir = join(runDir, "artifacts", "runs", id, task.host, task.evalId, task.version, `run-${task.repetition}`);
    const workspace = join(executionDir, "workspace");
    const outputDir = join(workspace, "outputs");
    const fixturePath = state.hashes.fixtures[task.evalId] ? join(runDir, "fixtures", task.evalId) : null;
    if (fixturePath) await copyTree(fixturePath, workspace);
    else await mkdir(workspace, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    const version = state.versions[task.version];
    let skillPath: string | null = null;
    let hashBefore: string | null = null;
    if (version) {
      skillPath = join(executionDir, "skill");
      await copyTree(version.path, skillPath);
      hashBefore = await hashTree(skillPath);
    } else if (!(task.version === "anchor" && state.anchor.kind === "none")) {
      throw new Error(`unknown version: ${task.version}`);
    }
    const eventPath = join(executionDir, "events.jsonl");
    const stderrPath = join(executionDir, "stderr.txt");
    const finalPath = join(executionDir, "final.md");
    const adapter = adapters[task.host];
    if (!adapter) throw new Error(`missing adapter: ${task.host}`);
    const result = await adapter.execute({
      cwd: workspace,
      prompt: executorPrompt(skillPath, evalCase.prompt, outputDir),
      eventPath,
      stderrPath,
      finalPath,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
      model: options.models?.[task.host],
    });
    await writeFile(join(outputDir, "final.md"), result.final_text);
    const hashAfter = skillPath ? await hashTree(skillPath) : null;
    const sourceMutated = hashBefore !== hashAfter;
    if (sourceMutated && result.exit_code === 0) result.exit_code = 86;
    const record: ExecutionRecord = {
      schema_version: 1,
      attempt_id: id,
      partition: evalCase.holdout ? "holdout" : "training",
      created_at: new Date().toISOString(),
      host: task.host,
      eval_id: task.evalId,
      version: task.version,
      repetition: task.repetition,
      run_dir: executionDir,
      output_dir: outputDir,
      skill_path: skillPath,
      skill_hash_before: hashBefore,
      skill_hash_after: hashAfter,
      source_mutated: sourceMutated,
      host_result: result,
    };
    await writeJson(join(executionDir, "execution.json"), record);
    return record;
  });
  await writeJson(join(runDir, "executions.json"), [...previous, ...records]);
  await writeJson(manifestPath, { ...manifest, status: "complete", completed_at: new Date().toISOString(), record_count: records.length });
  return records;
}
