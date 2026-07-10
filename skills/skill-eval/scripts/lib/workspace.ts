import { randomUUID } from "node:crypto";
import { chmod, mkdir, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { copyTree, containedPath, hashTree, hashValue, readJson, reserveArtifactDir, writeJson } from "./json.ts";
import { findPotentialEvaluatorFiles, readSkill, resolveSkillTarget } from "./skill.ts";
import { validateSuite } from "./suite.ts";
import { registerCampaignRun, validateCampaignRole, validateCampaignTarget } from "./campaign.ts";
import type { EvalSuite, PrepareRunOptions, RunState } from "./types.ts";

function runGit(cwd: string, args: string[], allowFailure = false): { exitCode: number; stdout: Buffer; stderr: Buffer } {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (!allowFailure && result.exitCode !== 0) throw new Error(result.stderr.toString() || `git ${args.join(" ")} failed`);
  return { exitCode: result.exitCode, stdout: Buffer.from(result.stdout), stderr: Buffer.from(result.stderr) };
}

function resolveCommit(repoRoot: string, ref: string): string | null {
  const result = runGit(repoRoot, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], true);
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

function treeContainsTarget(repoRoot: string, commit: string, relativeTarget: string): boolean {
  const listing = runGit(repoRoot, ["ls-tree", "-r", "-z", commit, "--", relativeTarget], true);
  return listing.exitCode === 0 && listing.stdout.length > 0;
}

async function extractTreeAtRef(repoRoot: string, commit: string, relativeTarget: string, destination: string): Promise<boolean> {
  const listing = runGit(repoRoot, ["ls-tree", "-r", "-z", commit, "--", relativeTarget], true);
  if (listing.exitCode !== 0 || listing.stdout.length === 0) return false;
  const entries = listing.stdout.toString().split("\0").filter(Boolean);
  for (const entry of entries) {
    const match = entry.match(/^(\d+)\s+\w+\s+[0-9a-f]+\t(.+)$/);
    if (!match) throw new Error(`unable to parse git tree entry: ${entry}`);
    const [, mode, path] = match;
    const relativeFile = relative(relativeTarget, path);
    if (relativeFile.startsWith("..")) continue;
    const outputPath = join(destination, relativeFile);
    await mkdir(dirname(outputPath), { recursive: true });
    const contents = runGit(repoRoot, ["show", `${commit}:${path}`]).stdout;
    if (mode === "120000") await symlink(contents.toString(), outputPath);
    else {
      await writeFile(outputPath, contents);
      await chmod(outputPath, Number.parseInt(mode.slice(-3), 8));
    }
  }
  return true;
}

export async function prepareRun(options: PrepareRunOptions): Promise<RunState> {
  const targetPath = await resolveSkillTarget(options.targetPath, options.cwd);
  const suitePath = await realpath(resolve(options.suitePath));
  const suite = validateSuite(await readJson<unknown>(suitePath));
  const skill = await readSkill(targetPath);
  if (suite.skill_name !== skill.name) throw new Error(`suite skill_name ${suite.skill_name} does not match target ${skill.name}`);
  if ((options.campaignDir === undefined) !== (options.campaignRole === undefined)) throw new Error("prepare requires both campaignDir and campaignRole");
  if (options.campaignDir) {
    await validateCampaignTarget(options.campaignDir, targetPath, skill.name);
    validateCampaignRole(options.campaignRole!);
  }
  const repoResult = runGit(targetPath, ["rev-parse", "--show-toplevel"]);
  const repoRoot = await realpath(repoResult.stdout.toString().trim());
  const relativeTarget = relative(repoRoot, targetPath).replaceAll("\\", "/");
  if (!relativeTarget || relativeTarget.startsWith("..")) throw new Error("target must be inside its Git repository");
  const potentialEvaluatorFiles = new Set(await findPotentialEvaluatorFiles(targetPath));
  const executorExclusions = [...new Set(options.executorExclusions ?? [])].map((path) => path.replaceAll("\\", "/"));
  for (const path of executorExclusions) {
    if (path === "SKILL.md") throw new Error("cannot exclude SKILL.md from executor snapshots");
    if (!potentialEvaluatorFiles.has(path)) throw new Error(`executor exclusion is not an unreferenced evaluator file: ${path}`);
    const absolute = containedPath(targetPath, path);
    if (!(await stat(absolute)).isFile()) throw new Error(`executor exclusion is not a file: ${path}`);
  }
  const runId = options.runId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const runRoot = resolve(options.runRoot ?? join("/tmp", "skill-eval", skill.name));
  const runDir = join(runRoot, runId);
  await reserveArtifactDir(runDir);
  await mkdir(join(runDir, "versions"), { recursive: true });
  await mkdir(join(runDir, "fixtures"), { recursive: true });

  const authoredPath = join(runDir, "versions", "authored");
  await copyTree(targetPath, authoredPath);
  const anchorPath = join(runDir, "versions", "anchor");
  const requestedAnchorRef = options.anchorRef ?? "HEAD";
  const anchorCommit = resolveCommit(repoRoot, requestedAnchorRef);
  if (!anchorCommit && options.anchorRef) throw new Error(`anchor ref does not resolve to a commit: ${requestedAnchorRef}`);
  const headCommit = resolveCommit(repoRoot, "HEAD");
  const targetTracked = headCommit ? treeContainsTarget(repoRoot, headCommit, relativeTarget) : false;
  const anchorExists = anchorCommit ? await extractTreeAtRef(repoRoot, anchorCommit, relativeTarget, anchorPath) : false;
  const anchor = anchorExists
    ? { kind: "git" as const, ref: requestedAnchorRef, commit: anchorCommit! }
    : { kind: "none" as const, ref: requestedAnchorRef, ...(anchorCommit ? { commit: anchorCommit } : {}) };

  const fixtureHashes: Record<string, string> = {};
  const suiteDirectory = dirname(suitePath);
  for (const evalCase of suite.evals) {
    if (!evalCase.fixture) continue;
    const fixtureSource = containedPath(suiteDirectory, evalCase.fixture);
    const fixtureDestination = join(runDir, "fixtures", evalCase.id);
    await copyTree(fixtureSource, fixtureDestination);
    fixtureHashes[evalCase.id] = await hashTree(fixtureDestination);
  }
  await writeJson(join(runDir, "suite.json"), suite);
  const status = runGit(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout.toString();
  const branchResult = runGit(repoRoot, ["branch", "--show-current"], true);
  const headResult = runGit(repoRoot, ["rev-parse", "HEAD"], true);
  const createdAt = new Date().toISOString();
  const hostMetadata: RunState["host_metadata"] = {};
  for (const host of [...new Set(options.hosts)]) {
    try {
      const result = Bun.spawnSync([host, "--version"], { stdout: "pipe", stderr: "pipe" });
      hostMetadata[host] = { version: result.exitCode === 0 ? result.stdout.toString().trim() || result.stderr.toString().trim() || null : null };
    } catch {
      hostMetadata[host] = { version: null };
    }
  }
  const state: RunState = {
    schema_version: 1,
    run_id: runId,
    run_dir: runDir,
    created_at: createdAt,
    target_path: targetPath,
    repo_root: repoRoot,
    skill_name: skill.name,
    invoking_host: options.invokingHost,
    requested_hosts: [...new Set(options.hosts)],
    host_metadata: hostMetadata,
    executor_exclusions: executorExclusions,
    ...(options.campaignDir ? { campaign: { campaign_dir: resolve(options.campaignDir), role: options.campaignRole! } } : {}),
    anchor,
    versions: {
      authored: { path: authoredPath, parent: null, created_at: createdAt },
      ...(anchorExists ? { anchor: { path: anchorPath, parent: null, created_at: createdAt } } : {}),
    },
    hashes: {
      versions: {
        anchor: anchorExists ? await hashTree(anchorPath) : null,
        authored: await hashTree(authoredPath),
      },
      fixtures: fixtureHashes,
      suite: hashValue(suite),
    },
    git: {
      initial_clean: status.length === 0,
      initial_status: status,
      branch: branchResult.exitCode === 0 ? branchResult.stdout.toString().trim() || null : null,
      head: headResult.exitCode === 0 ? headResult.stdout.toString().trim() || null : null,
      target_tracked: targetTracked,
    },
  };
  await writeJson(join(runDir, "run.json"), state);
  if (options.campaignDir) await registerCampaignRun(options.campaignDir, { runDir, role: options.campaignRole! });
  return state;
}

export async function loadRun(runDir: string): Promise<RunState> {
  return readJson<RunState>(join(resolve(runDir), "run.json"));
}

export async function loadSuite(runDir: string): Promise<EvalSuite> {
  return validateSuite(await readJson<unknown>(join(resolve(runDir), "suite.json")));
}

function frozenHash(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export async function verifyRunIntegrity(runDir: string): Promise<void> {
  const state = await loadRun(runDir);
  if (frozenHash(state.hashes.suite)) {
    const suite = await loadSuite(runDir);
    if (hashValue(suite) !== state.hashes.suite) throw new Error("suite hash mismatch; start a new calibrated run");
  }
  for (const [evalId, expected] of Object.entries(state.hashes.fixtures)) {
    if (frozenHash(expected) && await hashTree(join(state.run_dir, "fixtures", evalId)) !== expected) throw new Error(`fixture hash mismatch: ${evalId}`);
  }
  for (const [version, expected] of Object.entries(state.hashes.versions)) {
    if (!frozenHash(expected)) continue;
    const path = state.versions[version]?.path;
    if (!path || await hashTree(path) !== expected) throw new Error(`version hash mismatch: ${version}`);
  }
}

export async function addVersion(runDir: string, id: string, sourcePath: string, parent: string | null): Promise<RunState> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("version id must be lower-case hyphen-case");
  if (["anchor", "authored"].includes(id)) throw new Error(`reserved version id: ${id}`);
  const state = await loadRun(runDir);
  if (state.versions[id]) throw new Error(`version already exists: ${id}`);
  const family = id.startsWith("challenger-") ? "challenger-" : id.startsWith("description-") ? "description-" : null;
  if (family && Object.keys(state.versions).filter((name) => name.startsWith(family)).length >= 5) throw new Error(`${family.slice(0, -1)} version limit reached (5)`);
  if (parent && !state.versions[parent]) throw new Error(`unknown parent version: ${parent}`);
  const source = await realpath(resolve(sourcePath));
  const skill = await readSkill(source);
  if (skill.name !== state.skill_name) throw new Error(`version skill name ${skill.name} does not match ${state.skill_name}`);
  const destination = join(state.run_dir, "versions", id);
  await copyTree(source, destination);
  state.versions[id] = { path: destination, parent, created_at: new Date().toISOString() };
  state.hashes.versions[id] = await hashTree(destination);
  await writeJson(join(state.run_dir, "run.json"), state);
  return state;
}

export async function persistSuite(runDir: string): Promise<{ path: string }> {
  const state = await loadRun(runDir);
  const suite = await loadSuite(runDir);
  const destination = join(state.repo_root, ".skill-eval", state.skill_name);
  await mkdir(destination, { recursive: true });
  const persistentSuite = structuredClone(suite);
  for (const evalCase of persistentSuite.evals) {
    if (!state.hashes.fixtures[evalCase.id]) {
      delete evalCase.fixture;
      continue;
    }
    evalCase.fixture = `fixtures/${evalCase.id}`;
    await copyTree(join(state.run_dir, "fixtures", evalCase.id), join(destination, "fixtures", evalCase.id));
  }
  const path = join(destination, "suite.json");
  await writeJson(path, persistentSuite);
  return { path };
}
