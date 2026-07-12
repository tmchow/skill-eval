import { join, resolve } from "node:path";
import { hashValue, readOptionalJson, writeJson } from "./json.ts";
import { loadSuite } from "./workspace.ts";
import type { InvalidatedCheck } from "./types.ts";

export async function loadInvalidatedChecks(runDir: string): Promise<InvalidatedCheck[]> {
  const records = await readOptionalJson<InvalidatedCheck[]>(join(resolve(runDir), "invalidated-checks.json"), []);
  for (const record of records) {
    const { content_hash: contentHash, ...unsigned } = record;
    if (!contentHash || hashValue(unsigned) !== contentHash) throw new Error(`invalidated check hash mismatch: ${record.attempt_id}/${record.eval_id}/${record.expectation_id}`);
  }
  return records;
}

export async function invalidateCheck(options: Omit<InvalidatedCheck, "schema_version" | "created_at" | "content_hash"> & { runDir: string }): Promise<InvalidatedCheck> {
  const suite = await loadSuite(options.runDir);
  const expectation = suite.evals.find((item) => item.id === options.eval_id)?.expectations.find((item) => item.id === options.expectation_id);
  if (!expectation?.check) throw new Error("only a deterministic check in the frozen suite can be invalidated");
  if (!options.reason.trim()) throw new Error("invalidation requires a reason");
  const unsigned = { schema_version: 2 as const, attempt_id: options.attempt_id, eval_id: options.eval_id, expectation_id: options.expectation_id, reason: options.reason, created_at: new Date().toISOString() };
  const record: InvalidatedCheck = { ...unsigned, content_hash: hashValue(unsigned) };
  const path = join(resolve(options.runDir), "invalidated-checks.json");
  const previous = await loadInvalidatedChecks(options.runDir);
  if (previous.some((item) => item.attempt_id === record.attempt_id && item.eval_id === record.eval_id && item.expectation_id === record.expectation_id)) throw new Error("check is already invalidated for this attempt");
  await writeJson(path, [...previous, record]);
  return record;
}
