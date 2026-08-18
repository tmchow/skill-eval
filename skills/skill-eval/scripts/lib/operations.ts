import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { readJson, writeJson } from "./json.ts";
import type { HostAdapter, HostName, HostResult } from "./types.ts";

export type OperationKind = "model-grading" | "suite-critique" | "trigger";
export type OperationState = "active" | "complete" | "attention" | "stopped";

export interface OperationLimits {
  max_model_calls?: number;
  max_elapsed_ms?: number;
}

export interface OperationUsage {
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface OperationRecord {
  schema_version: 2;
  operation_id: string;
  kind: OperationKind;
  status: OperationState;
  phase: string;
  started_at: string;
  updated_at: string;
  completed_at?: string;
  pid: number;
  completed_units: number;
  planned_units: number | null;
  stop_reason?: string;
  message?: string;
  limits: OperationLimits;
  usage: OperationUsage;
}

export interface CreateOperationOptions {
  kind: OperationKind;
  phase: string;
  planned_units?: number | null;
  limits?: OperationLimits;
}

function operationId(kind: OperationKind): string {
  return `${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

export class OperationTracker {
  private pending = Promise.resolve();

  constructor(readonly runDir: string, readonly path: string, private record: OperationRecord) {}

  snapshot(): OperationRecord {
    return structuredClone(this.record);
  }

  async update(patch: Partial<Omit<OperationRecord, "schema_version" | "operation_id" | "kind" | "started_at" | "pid" | "limits" | "usage">> & {
    limits?: Partial<OperationLimits>;
    usage?: Partial<OperationUsage>;
  }): Promise<OperationRecord> {
    this.record = {
      ...this.record,
      ...patch,
      limits: { ...this.record.limits, ...patch.limits },
      usage: { ...this.record.usage, ...patch.usage },
      updated_at: new Date().toISOString(),
    };
    const value = this.snapshot();
    const write = this.pending.then(() => writeJson(this.path, value));
    this.pending = write.catch(() => {});
    await write;
    return value;
  }

  async beginModelCall(): Promise<number> {
    const elapsed = Date.now() - Date.parse(this.record.started_at);
    if (this.record.limits.max_elapsed_ms !== undefined && elapsed >= this.record.limits.max_elapsed_ms) {
      throw new Error(`elapsed-time limit reached for ${this.record.kind}`);
    }
    if (this.record.limits.max_model_calls !== undefined && this.record.usage.model_calls >= this.record.limits.max_model_calls) {
      throw new Error(`model-call limit reached for ${this.record.kind}`);
    }
    await this.update({ usage: { model_calls: this.record.usage.model_calls + 1 } });
    return this.record.limits.max_elapsed_ms === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(1, this.record.limits.max_elapsed_ms - elapsed);
  }

  async finishModelCall(result?: HostResult): Promise<void> {
    await this.update({
      completed_units: this.record.completed_units + 1,
      usage: {
        input_tokens: this.record.usage.input_tokens + (result?.usage.input_tokens ?? 0),
        output_tokens: this.record.usage.output_tokens + (result?.usage.output_tokens ?? 0),
        total_tokens: this.record.usage.total_tokens + (result?.usage.total_tokens ?? 0),
      },
    });
  }

  async complete(stopReason = "completed"): Promise<void> {
    await this.update({ status: "complete", stop_reason: stopReason, completed_at: new Date().toISOString() });
  }

  async fail(error: unknown): Promise<void> {
    await this.update({ status: "attention", stop_reason: "error", message: error instanceof Error ? error.message : String(error), completed_at: new Date().toISOString() });
  }
}

export async function createOperation(runDirInput: string, options: CreateOperationOptions): Promise<OperationTracker> {
  const runDir = resolve(runDirInput);
  const id = operationId(options.kind);
  const path = join(runDir, "artifacts", "operations", `${id}.json`);
  const now = new Date().toISOString();
  const record: OperationRecord = {
    schema_version: 2,
    operation_id: id,
    kind: options.kind,
    status: "active",
    phase: options.phase,
    started_at: now,
    updated_at: now,
    pid: process.pid,
    completed_units: 0,
    planned_units: options.planned_units ?? null,
    limits: { ...options.limits },
    usage: { model_calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };
  await writeJson(path, record);
  return new OperationTracker(runDir, path, record);
}

export function instrumentAdapters(adapters: Partial<Record<HostName, HostAdapter>>, operation: OperationTracker): Partial<Record<HostName, HostAdapter>> {
  const consecutiveHostFailures = new Map<HostName, number>();
  return Object.fromEntries(Object.entries(adapters).map(([host, adapter]) => [host, {
    name: adapter.name,
    execute: async (request) => {
      const hostName = host as HostName;
      if ((consecutiveHostFailures.get(hostName) ?? 0) >= 3) throw new Error(`host failure circuit open for ${hostName} after three consecutive timeouts or adapter errors`);
      const remaining = await operation.beginModelCall();
      try {
        const result = await adapter.execute({ ...request, timeoutMs: Math.min(request.timeoutMs, remaining) });
        consecutiveHostFailures.set(hostName, result.timed_out ? (consecutiveHostFailures.get(hostName) ?? 0) + 1 : 0);
        await operation.finishModelCall(result);
        return result;
      } catch (error) {
        consecutiveHostFailures.set(hostName, (consecutiveHostFailures.get(hostName) ?? 0) + 1);
        throw error;
      }
    },
  }])) as Partial<Record<HostName, HostAdapter>>;
}

export async function readOperations(runDirInput: string): Promise<OperationRecord[]> {
  const root = join(resolve(runDirInput), "artifacts", "operations");
  const glob = new Bun.Glob("*.json");
  const records: OperationRecord[] = [];
  try {
    for await (const file of glob.scan({ cwd: root, absolute: true })) records.push(await readJson<OperationRecord>(file));
  } catch { /* no operations yet */ }
  return records.sort((a, b) => a.started_at.localeCompare(b.started_at));
}
