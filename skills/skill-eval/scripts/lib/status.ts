import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { readJson } from "./json.ts";
import { readOperations } from "./operations.ts";
import type { OperationRecord } from "./operations.ts";
import type { BehaviorAttemptManifest, ExecutionRecord } from "./types.ts";

export interface AttemptStatus {
  attempt_id: string;
  status: string;
  completed_records: number;
  planned_records: number;
  timed_out_records: number;
  failed_records: number;
  active_records: Array<{
    host: string;
    version: string;
    eval_id: string;
    repetition: number;
    started_at: string;
    elapsed_ms: number;
  }>;
}

export interface RunStatus {
  run_dir: string;
  status: "idle" | "running" | "complete" | "attention";
  attempts: AttemptStatus[];
  operations: Array<OperationRecord & { elapsed_ms: number }>;
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function overallStatus(attempts: AttemptStatus[], operations: OperationRecord[]): RunStatus["status"] {
  if (attempts.length === 0 && operations.length === 0) return "idle";
  const active = attempts.filter((item) => item.status !== "superseded");
  if (operations.some((item) => item.status === "attention" || (item.status === "active" && !processAlive(item.pid)))) return "attention";
  if (operations.some((item) => item.status === "active")) return "running";
  if (active.some((item) => ["invalid", "interrupted"].includes(item.status) || item.failed_records > 0 || item.timed_out_records > 0)) return "attention";
  if (active.some((item) => item.status !== "complete")) return "running";
  return "complete";
}

function retryBase(id: string): string {
  return id.replace(/-retry-[0-9]+$/, "");
}

export async function readRunStatus(runDirInput: string): Promise<RunStatus> {
  const runDir = resolve(runDirInput);
  const attemptsRoot = join(runDir, "artifacts", "runs");
  let entries: string[] = [];
  try { entries = (await readdir(attemptsRoot, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name).sort(); } catch { /* no behavior attempts yet */ }
  let executions: ExecutionRecord[] = [];
  try { executions = await readJson<ExecutionRecord[]>(join(runDir, "executions.json")); } catch { /* no completed arms yet */ }
  const attempts: AttemptStatus[] = [];
  for (const id of entries) {
    const manifestPath = join(attemptsRoot, id, "attempt.json");
    try {
      const manifest = await readJson<BehaviorAttemptManifest>(manifestPath);
      const records = executions.filter((item) => item.attempt_id === id);
      const completedCells = new Set(records.map((item) => `${item.host}\0${item.version}\0${item.eval_id}\0${item.repetition}`));
      const activeRecords: AttemptStatus["active_records"] = [];
      const states = new Bun.Glob("*/*/*/run-*/execution-state.json");
      for await (const path of states.scan({ cwd: join(attemptsRoot, id), absolute: true })) {
        try {
          const parts = relative(join(attemptsRoot, id), path).split(sep);
          if (parts.length !== 5 || parts[4] !== "execution-state.json" || !/^run-[0-9]+$/.test(parts[3]!)) continue;
          const state = await readJson<{ status: string; host: string; version: string; eval_id: string; repetition: number; started_at: string }>(path);
          const key = `${state.host}\0${state.version}\0${state.eval_id}\0${state.repetition}`;
          if (manifest.status === "started" && state.status === "started" && !completedCells.has(key)) activeRecords.push({
            host: state.host, version: state.version, eval_id: state.eval_id, repetition: state.repetition, started_at: state.started_at,
            elapsed_ms: Math.max(0, Date.now() - Date.parse(state.started_at)),
          });
        } catch { /* malformed task state is reflected by the attempt status */ }
      }
      attempts.push({
        attempt_id: id,
        status: String(manifest.status ?? "unknown"),
        completed_records: Math.max(Number(manifest.record_count ?? 0), records.length),
        planned_records: Number(manifest.planned_records ?? 0),
        timed_out_records: records.filter((item) => item.host_result.timed_out).length,
        failed_records: records.filter((item) => item.host_result.exit_code !== 0 && !item.host_result.timed_out).length,
        active_records: activeRecords.sort((a, b) => a.started_at.localeCompare(b.started_at)),
      });
    } catch {
      attempts.push({ attempt_id: id, status: "invalid", completed_records: 0, planned_records: 0, timed_out_records: 0, failed_records: 0, active_records: [] });
    }
  }
  for (const attempt of attempts) {
    if (["complete", "invalid"].includes(attempt.status)) continue;
    if (attempts.some((candidate) => candidate.attempt_id !== attempt.attempt_id && candidate.status === "complete" && retryBase(candidate.attempt_id) === retryBase(attempt.attempt_id))) {
      attempt.status = "superseded";
    }
  }
  const operationRecords = await readOperations(runDir);
  const operations = operationRecords.map((item) => {
    const end = item.completed_at === undefined ? Date.now() : Date.parse(item.completed_at);
    return { ...item, elapsed_ms: Math.max(0, end - Date.parse(item.started_at)) };
  });
  return { run_dir: runDir, status: overallStatus(attempts, operationRecords), attempts, operations };
}

export async function waitForRun(runDir: string, options: { pollMs?: number; timeoutMs?: number } = {}): Promise<RunStatus> {
  const pollMs = Math.max(10, options.pollMs ?? 1_000);
  const timeoutMs = Math.max(pollMs, options.timeoutMs ?? 30 * 60_000);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const status = await readRunStatus(runDir);
    if (status.status !== "running") return status;
    if (Date.now() >= deadline) throw new Error(`wait timed out after ${timeoutMs}ms with run status ${status.status}`);
    await Bun.sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
}
