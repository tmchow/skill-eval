import { stat } from "node:fs/promises";
import { join } from "node:path";
import { readJson } from "./json.ts";
import type { BehaviorAttemptManifest, ExecutionRecord, HostName, RunState } from "./types.ts";

export function relatedId(id: string, base: string): boolean {
  return id === base || new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-retry-[0-9]+$`).test(id);
}

async function pathExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

export async function nextArtifactId(base: string, pathFor: (id: string) => string): Promise<string> {
  for (let retry = 1; ; retry += 1) {
    const id = retry === 1 ? base : `${base}-retry-${retry}`;
    if (!await pathExists(pathFor(id))) return id;
  }
}

export async function behaviorAttemptId(runDir: string, base: string, executions: ExecutionRecord[]): Promise<string> {
  const indexed = [...new Set(executions.map((item) => item.attempt_id).filter((id) => relatedId(id, base)))].reverse();
  for (const id of indexed) {
    const records = executions.filter((item) => item.attempt_id === id);
    const manifestPath = join(runDir, "artifacts", "runs", id, "attempt.json");
    if (!await pathExists(manifestPath)) continue;
    try {
      const manifest = await readJson<BehaviorAttemptManifest>(manifestPath);
      if (manifest.status === "complete" && records.length === manifest.planned_records && manifest.record_count === manifest.planned_records) return id;
      if (["started", "interrupted"].includes(manifest.status)
        && records.length <= manifest.planned_records
        && manifest.record_count <= records.length) return id;
    } catch { /* preserve the corrupt attempt and allocate a retry */ }
  }
  return nextArtifactId(base, (id) => join(runDir, "artifacts", "runs", id));
}

export function validateEvaluationInputs(state: RunState, versions: string[], hosts: HostName[], judgeHosts: HostName[]): void {
  if (hosts.length === 0) throw new Error("behavior evaluation requires at least one executor host");
  if (judgeHosts.length === 0) throw new Error("behavior evaluation requires at least one judge host");
  for (const version of versions) {
    if (!state.versions[version] && !(version === "anchor" && state.anchor.kind === "none")) {
      throw new Error(`unknown version: ${version}`);
    }
  }
}
