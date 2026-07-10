import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { assertWritableDirectory } from "./json.ts";
import { terminateProcessTree } from "./process.ts";
import { findPotentialEvaluatorFiles, readSkill, resolveSkillTarget } from "./skill.ts";
import type { CommandProbe, HostName, HostReadiness, PreflightCheck, PreflightReport } from "./types.ts";

export interface PreflightOptions {
  invokingHost: HostName;
  requestedHosts: HostName[];
  probe?: CommandProbe;
  probeTimeoutMs?: number;
  cwd?: string;
}

export function createCommandProbe(timeoutMs: number): CommandProbe {
  return async (command, args) => {
  try {
    const processHandle = Bun.spawn([command, ...args], { detached: process.platform !== "win32", stdout: "pipe", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; terminateProcessTree(processHandle); }, timeoutMs);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
      processHandle.exited,
    ]);
    clearTimeout(timer);
    return timedOut ? { exitCode: 124, stdout, stderr: stderr || `probe timed out after ${timeoutMs}ms` } : { exitCode, stdout, stderr };
  } catch (error) {
    return { exitCode: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
  };
}

function check(id: string, status: PreflightCheck["status"], message: string, remediation?: string): PreflightCheck {
  return { id, status, message, ...(remediation ? { remediation } : {}) };
}

function versionAtLeast(value: string, minimum: [number, number]): boolean {
  const match = value.match(/(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > minimum[0] || (major === minimum[0] && minor >= minimum[1]);
}

async function hostReadiness(host: HostName, probe: CommandProbe): Promise<{ readiness: HostReadiness; checks: PreflightCheck[] }> {
  const version = await probe(host, ["--version"]);
  const installCommand = host === "claude"
    ? "npm install -g @anthropic-ai/claude-code"
    : "npm install -g @openai/codex";
  if (version.exitCode !== 0) {
    const readiness: HostReadiness = {
      installed: false,
      authenticated: false,
      ready: false,
      version: null,
      remediation: installCommand,
      capabilities: {},
    };
    return { readiness, checks: [check(`host.${host}.installed`, "degraded", `${host} is not installed`, installCommand)] };
  }
  const authArgs = host === "claude" ? ["auth", "status"] : ["login", "status"];
  const auth = await probe(host, authArgs);
  let authenticated = auth.exitCode === 0;
  if (host === "claude" && authenticated) {
    try { authenticated = JSON.parse(auth.stdout).loggedIn === true; } catch { authenticated = false; }
  }
  const remediation = authenticated ? undefined : `${host} ${host === "claude" ? "auth login" : "login"}`;
  const nativePluginEval = host === "claude"
    ? (await probe("claude", ["plugin", "eval", "--help"])).exitCode === 0
    : false;
  const readiness: HostReadiness = {
    installed: true,
    authenticated,
    ready: authenticated,
    version: version.stdout.trim() || version.stderr.trim(),
    ...(remediation ? { remediation } : {}),
    capabilities: host === "claude" ? { native_plugin_eval: nativePluginEval } : {},
  };
  return {
    readiness,
    checks: [
      check(`host.${host}.installed`, "ready", `${host} is installed`),
      check(`host.${host}.auth`, authenticated ? "ready" : "degraded", authenticated ? `${host} is authenticated` : `${host} is not authenticated`, remediation),
    ],
  };
}

export async function preflight(targetPath: string, options: PreflightOptions): Promise<PreflightReport> {
  const probe = options.probe ?? createCommandProbe(options.probeTimeoutMs ?? 10_000);
  const checks: PreflightCheck[] = [];
  let skillName: string | null = null;
  let resolvedTarget = resolve(options.cwd ?? process.cwd(), targetPath);
  try {
    resolvedTarget = await resolveSkillTarget(targetPath, options.cwd);
    skillName = (await readSkill(resolvedTarget)).name;
    checks.push(check("target.skill", "ready", `valid skill: ${skillName}`));
    const evaluatorFiles = await findPotentialEvaluatorFiles(resolvedTarget);
    if (evaluatorFiles.length > 0) checks.push(check(
      "target.evaluator-files",
      "degraded",
      `possible evaluator-only files would be visible to executors: ${evaluatorFiles.join(", ")}`,
      "Confirm whether each file is runtime material; exclude evaluator-only paths during prepare",
    ));
  } catch (error) {
    checks.push(check("target.skill", "blocked", error instanceof Error ? error.message : String(error)));
  }
  const bun = await probe("bun", ["--version"]);
  checks.push(bun.exitCode === 0 && versionAtLeast(bun.stdout, [1, 2])
    ? check("dependency.bun", "ready", `Bun ${bun.stdout.trim()}`)
    : check("dependency.bun", "blocked", "Bun 1.2 or newer is required", "curl -fsSL https://bun.sh/install | bash"));
  const git = await probe("git", ["--version"]);
  checks.push(git.exitCode === 0
    ? check("dependency.git", "ready", git.stdout.trim())
    : check("dependency.git", "blocked", "Git is required", "Install Git with the operating system package manager"));
  if (git.exitCode === 0) {
    const repository = await probe("git", ["-C", resolvedTarget, "rev-parse", "--show-toplevel"]);
    checks.push(repository.exitCode === 0
      ? check("target.repository", "ready", `Git repository: ${repository.stdout.trim()}`)
      : check("target.repository", "blocked", "target skill must be inside a Git repository"));
  }
  if (!["darwin", "linux"].includes(process.platform)) {
    checks.push(check("platform", "blocked", `unsupported platform: ${process.platform}`));
  } else {
    checks.push(check("platform", "ready", `supported platform: ${process.platform}`));
  }
  try {
    await assertWritableDirectory(resolve(tmpdir(), "skill-eval-preflight"));
    checks.push(check("storage.temp", "ready", "temporary storage is writable"));
  } catch (error) {
    checks.push(check("storage.temp", "blocked", `temporary storage is not writable: ${String(error)}`));
  }

  const hosts = {
    claude: { installed: false, authenticated: false, ready: false, version: null, capabilities: {} } as HostReadiness,
    codex: { installed: false, authenticated: false, ready: false, version: null, capabilities: {} } as HostReadiness,
  };
  for (const host of [...new Set([...options.requestedHosts, options.invokingHost])]) {
    const result = await hostReadiness(host, probe);
    hosts[host] = result.readiness;
    for (const item of result.checks) {
      const isRequired = host === options.invokingHost;
      checks.push(!isRequired && item.status === "degraded" ? item : isRequired && item.status === "degraded" ? { ...item, status: "blocked" } : item);
    }
  }
  const blocked = checks.filter((item) => item.status === "blocked");
  const degraded = checks.filter((item) => item.status === "degraded");
  const ready = blocked.length === 0;
  return {
    ready,
    coverage: ready ? (degraded.length > 0 ? "degraded" : "full") : "blocked",
    invoking_host: options.invokingHost,
    target_path: resolvedTarget,
    skill_name: skillName,
    hosts,
    checks,
    blocked,
    degraded,
  };
}
