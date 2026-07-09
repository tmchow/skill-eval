import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  input: string;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
  stdoutPath: string;
  stderrPath: string;
}

export interface ProcessResult {
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

type SignalProcess = (pid: number, signal?: NodeJS.Signals | number) => boolean;

export function terminateProcessTree(
  processHandle: Pick<Bun.Subprocess, "pid" | "kill">,
  platform = process.platform,
  signalProcess: SignalProcess = process.kill,
): void {
  if (platform !== "win32") {
    try {
      signalProcess(-processHandle.pid, "SIGKILL");
      return;
    } catch {
      // Fall through when the process group has already exited or was not detached.
    }
  }
  try { processHandle.kill("SIGKILL"); } catch { /* process already exited */ }
}

function environment(overrides?: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...overrides })) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

const SECRET_ENV_KEY = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE_KEY|ACCESS_KEY|CLIENT_SECRET)(?:_|$)/i;

export function redactSecrets(value: string, overrides: Record<string, string | undefined> = {}): string {
  let redacted = value;
  const candidates = Object.entries({ ...process.env, ...overrides })
    .filter(([key, secret]) => SECRET_ENV_KEY.test(key) && typeof secret === "string" && secret.length >= 6)
    .map(([, secret]) => secret as string)
    .sort((a, b) => b.length - a.length);
  for (const secret of new Set(candidates)) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED]")
    .replace(/(?:sk-(?:ant-|proj-)?|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
    .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED]");
}

export async function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  await mkdir(dirname(request.stdoutPath), { recursive: true });
  await mkdir(dirname(request.stderrPath), { recursive: true });
  const started = performance.now();
  let timedOut = false;
  let processHandle: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    processHandle = Bun.spawn([request.command, ...request.args], {
      cwd: request.cwd,
      detached: process.platform !== "win32",
      env: environment(request.env),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    const stderr = error instanceof Error ? error.message : String(error);
    await writeFile(request.stdoutPath, "");
    const safeStderr = redactSecrets(stderr, request.env);
    await writeFile(request.stderrPath, safeStderr);
    return { exitCode: 127, timedOut: false, durationMs: performance.now() - started, stdout: "", stderr: safeStderr };
  }
  processHandle.stdin.write(request.input);
  processHandle.stdin.end();
  const stdoutPromise = new Response(processHandle.stdout).text();
  const stderrPromise = new Response(processHandle.stderr).text();
  const timer = setTimeout(() => {
    timedOut = true;
    terminateProcessTree(processHandle);
  }, request.timeoutMs);
  const exitCode = await processHandle.exited;
  clearTimeout(timer);
  const [rawStdout, rawStderr] = await Promise.all([stdoutPromise, stderrPromise]);
  const stdout = redactSecrets(rawStdout, request.env);
  const stderr = redactSecrets(rawStderr, request.env);
  await writeFile(request.stdoutPath, stdout);
  await writeFile(request.stderrPath, stderr);
  return { exitCode, timedOut, durationMs: performance.now() - started, stdout, stderr };
}
