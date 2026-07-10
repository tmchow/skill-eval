import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { mapLimit } from "./async.ts";
import { gradeExecution } from "./assertions.ts";
import { containedPath, copyTree, hashTree, readJson, reserveArtifactDir, writeJson } from "./json.ts";
import { createHostAdapters } from "./hosts.ts";
import { loadRun, loadSuite, verifyRunIntegrity } from "./workspace.ts";
import type { BehaviorAttemptManifest, EvidencePartition, ExecutionRecord, GradingResult, HostAdapter, HostName } from "./types.ts";

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
  resume?: boolean;
}

interface MatrixTask {
  host: HostName;
  version: string;
  evalId: string;
  repetition: number;
}

function attemptId(value?: string): string {
  const id = value ?? `behavior-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error("attempt id must contain only letters, digits, dot, underscore, or hyphen");
  return id;
}

function executorPrompt(skillPath: string | null, task: string, outputDir: string): string {
  const skillInstruction = skillPath
    ? `Exact skill snapshot: ${skillPath}\nRead its SKILL.md and follow that skill for this task. Load bundled files only as directed by that skill. Do not invoke a same-name installed skill or use skill files outside this exact snapshot.`
    : "No additional skill instructions are supplied. Complete the task using only your normal capabilities. Do not invoke an installed skill as a substitute baseline.";
  return `You are completing a real user task inside an isolated workspace.\n\n${skillInstruction}\n\nUser task:\n${task}\n\nWrite task artifacts under: ${outputDir}\nDo not discuss comparisons, expected results, or alternative instructions. Complete the task normally.\n`;
}

function recordKey(record: Pick<ExecutionRecord, "host" | "eval_id" | "version" | "repetition">): string {
  return `${record.host}\0${record.eval_id}\0${record.version}\0${record.repetition}`;
}

function taskKey(task: MatrixTask): string {
  return `${task.host}\0${task.evalId}\0${task.version}\0${task.repetition}`;
}

function executionDir(runDir: string, attemptId: string, task: MatrixTask): string {
  return join(runDir, "artifacts", "runs", attemptId, task.host, task.evalId, task.version, `run-${task.repetition}`);
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
  if (!options.resume && previous.some((record) => record.attempt_id === id)) throw new Error(`attempt id already exists: ${id}`);
  const defaults = createHostAdapters();
  const adapters = { ...defaults, ...options.adapters };
  const tasks: MatrixTask[] = [];
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
  const manifestPath = join(attemptRoot, "attempt.json");
  const manifest: BehaviorAttemptManifest = {
    schema_version: 1, attempt_id: id, kind: "behavior", status: "started", created_at: new Date().toISOString(),
    partition, versions: [...options.versions], hosts: [...options.hosts], eval_ids: selectedEvals.map((item) => item.id),
    repetitions: options.repetitions ?? 1, planned_records: tasks.length, record_count: 0,
  };
  const manifestExists = await Bun.file(manifestPath).exists();
  if (!manifestExists) {
    await reserveArtifactDir(attemptRoot);
    await writeJson(manifestPath, manifest);
  } else {
    if (!options.resume) throw new Error(`attempt id already exists: ${id}`);
    const existing = await readJson<BehaviorAttemptManifest>(manifestPath);
    for (const key of ["partition", "versions", "hosts", "eval_ids", "repetitions", "planned_records"] as const) {
      if (JSON.stringify(existing[key]) !== JSON.stringify(manifest[key])) throw new Error(`cannot resume attempt ${id}: ${key} changed`);
    }
    if (!["started", "interrupted", "complete"].includes(existing.status)) throw new Error(`cannot resume attempt ${id}: invalid status ${String(existing.status)}`);
  }

  let grades: GradingResult[] = [];
  try { grades = await readJson<GradingResult[]>(join(runDir, "gradings.json")); } catch { /* first grade */ }
  const attemptRecords = new Map<string, ExecutionRecord>();
  for (const record of previous.filter((item) => item.attempt_id === id)) attemptRecords.set(recordKey(record), record);
  for (const task of tasks) {
    const path = join(executionDir(runDir, id, task), "execution.json");
    if (!await Bun.file(path).exists()) continue;
    const record = await readJson<ExecutionRecord>(path);
    if (record.attempt_id !== id || recordKey(record) !== taskKey(task)) throw new Error(`cannot resume attempt ${id}: execution identity mismatch`);
    attemptRecords.set(taskKey(task), record);
  }

  let persistence = Promise.resolve();
  async function persistRecord(record: ExecutionRecord): Promise<void> {
    const operation = persistence.then(async () => {
      attemptRecords.set(recordKey(record), record);
      const key = recordKey(record);
      previous = previous.filter((item) => item.attempt_id !== id || recordKey(item) !== key);
      previous.push(record);
      await writeJson(join(runDir, "executions.json"), previous);
      const evalCase = suite.evals.find((item) => item.id === record.eval_id);
      if (!evalCase) throw new Error(`execution references missing eval: ${record.eval_id}`);
      const grade = await gradeExecution(record, evalCase);
      await writeJson(join(record.run_dir, "grading.json"), grade);
      grades = grades.filter((item) => item.attempt_id !== id || recordKey(item) !== key);
      grades.push(grade);
      await writeJson(join(runDir, "gradings.json"), grades);
      await writeJson(manifestPath, { ...manifest, record_count: attemptRecords.size });
    });
    persistence = operation;
    await operation;
  }

  for (const record of attemptRecords.values()) await persistRecord(record);
  const remaining = tasks.filter((task) => !attemptRecords.has(taskKey(task)));
  try {
    await mapLimit(remaining, options.concurrency ?? 2, async (task): Promise<ExecutionRecord> => {
      const evalCase = suite.evals.find((item) => item.id === task.evalId)!;
      const taskDir = executionDir(runDir, id, task);
      const workspace = join(taskDir, "workspace");
      const outputDir = join(workspace, "outputs");
      const fixturePath = state.hashes.fixtures[task.evalId] ? join(runDir, "fixtures", task.evalId) : null;
      if (fixturePath) await copyTree(fixturePath, workspace);
      else await mkdir(workspace, { recursive: true });
      await mkdir(outputDir, { recursive: true });

      const version = state.versions[task.version];
      let skillPath: string | null = null;
      let hashBefore: string | null = null;
      if (version) {
        skillPath = join(taskDir, "skill");
        await copyTree(version.path, skillPath);
        for (const excluded of state.executor_exclusions ?? []) await rm(containedPath(skillPath, excluded), { recursive: true, force: true });
        hashBefore = await hashTree(skillPath);
      } else if (!(task.version === "anchor" && state.anchor.kind === "none")) {
        throw new Error(`unknown version: ${task.version}`);
      }
      const eventPath = join(taskDir, "events.jsonl");
      const stderrPath = join(taskDir, "stderr.txt");
      const finalPath = join(taskDir, "final.md");
      const adapter = adapters[task.host];
      if (!adapter) throw new Error(`missing adapter: ${task.host}`);
      const fixtureBin = join(workspace, "bin");
      let taskEnv: Record<string, string> | undefined;
      try {
        if ((await stat(fixtureBin)).isDirectory()) taskEnv = { PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ""}` };
      } catch { /* fixtures do not need a bin directory */ }
      const result = await adapter.execute({
        cwd: workspace,
        prompt: executorPrompt(skillPath, evalCase.prompt, outputDir),
        eventPath,
        stderrPath,
        finalPath,
        timeoutMs: options.timeoutMs ?? 10 * 60_000,
        env: taskEnv,
        model: options.models?.[task.host],
      });
      await writeFile(join(outputDir, "final.md"), result.final_text);
      const hashAfter = skillPath ? await hashTree(skillPath) : null;
      const sourceMutated = hashBefore !== hashAfter;
      if (sourceMutated && result.exit_code === 0) result.exit_code = 86;
      if (result.malformed_events > 0 && result.exit_code === 0) result.exit_code = 87;
      const record: ExecutionRecord = {
        schema_version: 1,
        attempt_id: id,
        partition: evalCase.holdout ? "holdout" : "training",
        created_at: new Date().toISOString(),
        host: task.host,
        eval_id: task.evalId,
        version: task.version,
        repetition: task.repetition,
        run_dir: taskDir,
        output_dir: outputDir,
        skill_path: skillPath,
        skill_hash_before: hashBefore,
        skill_hash_after: hashAfter,
        source_mutated: sourceMutated,
        executor_exclusions: [...(state.executor_exclusions ?? [])],
        host_result: result,
      };
      await writeJson(join(taskDir, "execution.json"), record);
      await persistRecord(record);
      return record;
    });
  } catch (error) {
    await writeJson(manifestPath, { ...manifest, status: "interrupted", interrupted_at: new Date().toISOString(), record_count: attemptRecords.size });
    throw error;
  }
  const records = tasks.map((task) => attemptRecords.get(taskKey(task))!);
  await writeJson(manifestPath, { ...manifest, status: "complete", completed_at: new Date().toISOString(), record_count: records.length });
  return records;
}
