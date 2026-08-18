import { delimiter, extname, join, resolve } from "node:path";
import { mkdir, rm, stat } from "node:fs/promises";
import { containedPath, copyTree, hashTree, readJson, reserveArtifactDir, writeJson } from "./json.ts";
import { runProcess } from "./process.ts";
import { loadRun, verifyRunIntegrity } from "./workspace.ts";

export interface ScriptCheckOptions {
  runDir: string;
  checkId: string;
  version: string;
  script: string;
  fixtureId?: string;
  runtime?: string;
  args?: string[];
  timeoutMs?: number;
  stdoutContains?: string;
  stderrNotContains?: string;
}

export interface ScriptCheckResult {
  schema_version: 2;
  check_id: string;
  version: string;
  script: string;
  fixture_id: string | null;
  runtime: string | null;
  args: string[];
  created_at: string;
  passed: boolean;
  exit_code: number;
  timed_out: boolean;
  duration_ms: number;
  source_mutated: boolean;
  stdout_path: string;
  stderr_path: string;
  stdout_contains: string | null;
  stderr_not_contains: string | null;
}

function runtimeFor(script: string, explicit?: string): string | null {
  if (explicit) return explicit;
  if (extname(script) === ".sh") return "bash";
  if ([".ts", ".js", ".mjs"].includes(extname(script))) return "bun";
  if (extname(script) === ".py") return "python3";
  return null;
}

export async function runScriptCheck(options: ScriptCheckOptions): Promise<ScriptCheckResult> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.checkId)) throw new Error("check id must contain only letters, digits, dot, underscore, or hyphen");
  const runDir = resolve(options.runDir);
  await verifyRunIntegrity(runDir);
  const state = await loadRun(runDir);
  const version = state.versions[options.version];
  if (!version) throw new Error(`unknown version: ${options.version}`);
  let previous: ScriptCheckResult[] = [];
  try { previous = await readJson<ScriptCheckResult[]>(join(runDir, "script-checks.json")); } catch { /* first script check */ }
  if (previous.some((item) => item.check_id === options.checkId)) throw new Error(`check id already exists: ${options.checkId}`);

  const artifactDir = join(runDir, "artifacts", "script-checks", options.checkId);
  await reserveArtifactDir(artifactDir);
  const skillPath = join(artifactDir, "skill");
  await copyTree(version.path, skillPath);
  for (const excluded of state.executor_exclusions ?? []) await rm(containedPath(skillPath, excluded), { recursive: true, force: true });
  const scriptPath = containedPath(skillPath, options.script);
  if (!(await stat(scriptPath)).isFile()) throw new Error(`script is not a file: ${options.script}`);
  const sourceHash = await hashTree(skillPath);
  const workspace = join(artifactDir, "workspace");
  if (options.fixtureId) {
    if (!state.hashes.fixtures[options.fixtureId]) throw new Error(`unknown fixture: ${options.fixtureId}`);
    await copyTree(join(runDir, "fixtures", options.fixtureId), workspace);
  } else {
    await mkdir(workspace, { recursive: true });
  }
  const fixtureBin = join(workspace, "bin");
  let path = process.env.PATH ?? "";
  try { if ((await stat(fixtureBin)).isDirectory()) path = `${fixtureBin}${delimiter}${path}`; } catch { /* fixture has no bin */ }
  const runtime = runtimeFor(options.script, options.runtime);
  const stdoutPath = join(artifactDir, "stdout.txt");
  const stderrPath = join(artifactDir, "stderr.txt");
  const processResult = await runProcess({
    command: runtime ?? scriptPath,
    args: runtime ? [scriptPath, ...(options.args ?? [])] : options.args ?? [],
    cwd: workspace,
    input: "",
    timeoutMs: options.timeoutMs ?? 60_000,
    env: { SKILL_DIR: skillPath, PATH: path },
    stdoutPath,
    stderrPath,
  });
  const sourceMutated = await hashTree(skillPath) !== sourceHash;
  const passed = processResult.exitCode === 0
    && !processResult.timedOut
    && !sourceMutated
    && (options.stdoutContains === undefined || processResult.stdout.includes(options.stdoutContains))
    && (options.stderrNotContains === undefined || !processResult.stderr.includes(options.stderrNotContains));
  const result: ScriptCheckResult = {
    schema_version: 2,
    check_id: options.checkId,
    version: options.version,
    script: options.script,
    fixture_id: options.fixtureId ?? null,
    runtime,
    args: [...(options.args ?? [])],
    created_at: new Date().toISOString(),
    passed,
    exit_code: processResult.exitCode,
    timed_out: processResult.timedOut,
    duration_ms: processResult.durationMs,
    source_mutated: sourceMutated,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    stdout_contains: options.stdoutContains ?? null,
    stderr_not_contains: options.stderrNotContains ?? null,
  };
  await writeJson(join(artifactDir, "result.json"), result);
  await writeJson(join(runDir, "script-checks.json"), [...previous, result]);
  return result;
}
