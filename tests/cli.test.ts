import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { writeJson } from "../skills/skill-eval/scripts/lib/json.ts";

const cli = resolve(import.meta.dir, "../skills/skill-eval/scripts/skill-eval.ts");

function run(args: string[]) {
  return Bun.spawnSync(["bun", cli, ...args], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
}

describe("skill-eval CLI", () => {
  test("lists every workflow command", () => {
    const result = run(["--help"]);
    const output = JSON.parse(result.stdout.toString()).help as string;
    expect(result.exitCode).toBe(0);
    for (const command of ["preflight", "campaign-init", "campaign-list", "campaign-checkpoint", "campaign-context", "prepare", "add-version", "check-script", "run", "grade", "grade-model", "judge", "trigger", "benchmark", "compare", "decide", "optimize", "optimize-description", "certify", "status", "persist-suite", "review-suite", "review", "record-feedback", "promote"]) {
      expect(output).toContain(command);
    }
  });

  test("reports durable progress for long-running attempts", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "skill-eval-status-"));
    const attemptDir = join(runDir, "artifacts", "runs", "calibration-training");
    await mkdir(attemptDir, { recursive: true });
    await writeJson(join(attemptDir, "attempt.json"), {
      schema_version: 1,
      attempt_id: "calibration-training",
      kind: "behavior",
      status: "started",
      created_at: new Date().toISOString(),
      planned_records: 4,
      record_count: 2,
    });

    const result = run(["status", "--run-dir", runDir]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      status: "running",
      attempts: [{ attempt_id: "calibration-training", status: "started", completed_records: 2, planned_records: 4 }],
    });
  });

  test("surfaces interrupted attempts as requiring attention", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "skill-eval-status-interrupted-"));
    const attemptDir = join(runDir, "artifacts", "runs", "comparison-training");
    await mkdir(attemptDir, { recursive: true });
    await writeJson(join(attemptDir, "attempt.json"), { schema_version: 1, attempt_id: "comparison-training", status: "interrupted", planned_records: 2, record_count: 1 });

    const result = run(["status", "--run-dir", runDir]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString()).status).toBe("attention");
  });

  test("ignores an interrupted attempt superseded by a completed retry", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "skill-eval-status-superseded-"));
    for (const [id, status] of [["comparison-training", "interrupted"], ["comparison-training-retry-2", "complete"]] as const) {
      const attemptDir = join(runDir, "artifacts", "runs", id);
      await mkdir(attemptDir, { recursive: true });
      await writeJson(join(attemptDir, "attempt.json"), { schema_version: 1, attempt_id: id, status, planned_records: 2, record_count: status === "complete" ? 2 : 1 });
    }

    const result = run(["status", "--run-dir", runDir]);
    const status = JSON.parse(result.stdout.toString());

    expect(result.exitCode).toBe(0);
    expect(status.status).toBe("complete");
    expect(status.attempts.find((item: any) => item.attempt_id === "comparison-training").status).toBe("superseded");
  });

  test("fails unknown commands with machine-readable error output", () => {
    const result = run(["unknown"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr.toString()).error).toContain("unknown command");
  });

  test("requires an explicit trigger partition", () => {
    const result = run(["trigger", "--run-dir", "/tmp/run", "--version", "authored", "--hosts", "codex"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr.toString()).error).toContain("missing --partition");
  });

  test("accepts resume for trigger attempts", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "skill-eval-trigger-cli-resume-"));
    const result = run(["trigger", "--run-dir", runDir, "--version", "authored", "--hosts", "codex", "--partition", "training", "--resume"]);
    const error = JSON.parse(result.stderr.toString()).error as string;

    expect(result.exitCode).toBe(1);
    expect(error).not.toContain("unknown option for trigger: --resume");
    expect(error).toContain("run.json");
  });

  test("rejects options that do not belong to a command", () => {
    const result = run(["grade", "--run-dir", "/tmp/run", "--bogus", "value"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr.toString()).error).toContain("unknown option for grade: --bogus");
  });
});
