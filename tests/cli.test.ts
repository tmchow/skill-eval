import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const cli = resolve(import.meta.dir, "../skills/skill-eval/scripts/skill-eval.ts");

function run(args: string[]) {
  return Bun.spawnSync(["bun", cli, ...args], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
}

describe("skill-eval CLI", () => {
  test("lists every workflow command", () => {
    const result = run(["--help"]);
    const output = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    for (const command of ["preflight", "prepare", "add-version", "run", "grade", "grade-model", "judge", "trigger", "benchmark", "decide", "optimize", "optimize-description", "certify", "persist-suite", "review-suite", "review", "ingest-feedback", "promote"]) {
      expect(output).toContain(command);
    }
  });

  test("fails unknown commands with machine-readable error output", () => {
    const result = run(["unknown"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr.toString()).error).toContain("unknown command");
  });

  test("rejects options that do not belong to a command", () => {
    const result = run(["grade", "--run-dir", "/tmp/run", "--bogus", "value"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr.toString()).error).toContain("unknown option for grade: --bogus");
  });
});
