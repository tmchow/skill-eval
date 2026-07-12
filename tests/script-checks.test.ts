import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashTree, readJson, writeJson } from "../skills/skill-eval/scripts/lib/json.ts";
import { runScriptCheck } from "../skills/skill-eval/scripts/lib/script-checks.ts";
import type { RunState } from "../skills/skill-eval/scripts/lib/types.ts";

test("runs a frozen skill script without model calls and records immutable evidence", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-script-check-"));
  const authored = join(runDir, "versions", "authored");
  const fixture = join(runDir, "fixtures", "case");
  await mkdir(join(authored, "scripts"), { recursive: true });
  await mkdir(fixture, { recursive: true });
  await writeFile(join(authored, "SKILL.md"), "---\nname: demo\ndescription: Use when testing.\n---\n");
  await writeFile(join(authored, "scripts", "probe.sh"), "#!/bin/sh\nprintf 'peer=%s workspace=%s skill=%s input=%s\\n' \"$1\" \"$(basename \"$PWD\")\" \"$(basename \"$SKILL_DIR\")\" \"$(cat input.txt)\"\n");
  await writeFile(join(fixture, "input.txt"), "fixture-data\n");
  await chmod(join(authored, "scripts", "probe.sh"), 0o755);
  const now = new Date().toISOString();
  const state: RunState = {
    schema_version: 2,
    run_id: "run",
    run_dir: runDir,
    created_at: now,
    target_path: authored,
    repo_root: runDir,
    skill_name: "demo",
    invoking_host: "codex",
    requested_hosts: ["codex"],
    anchor: { kind: "none" },
    versions: { authored: { path: authored, parent: null, created_at: now } },
    hashes: { versions: { authored: await hashTree(authored) }, fixtures: { case: await hashTree(fixture) }, suite: "legacy" },
    git: { initial_clean: false, initial_status: "", branch: "feature", head: "abc", target_tracked: true },
  };
  await writeJson(join(runDir, "run.json"), state);

  const result = await runScriptCheck({
    runDir,
    checkId: "peer-selection",
    version: "authored",
    script: "scripts/probe.sh",
    fixtureId: "case",
    args: ["codex"],
    stdoutContains: "peer=codex",
  });

  expect(result).toMatchObject({ check_id: "peer-selection", version: "authored", fixture_id: "case", passed: true, exit_code: 0, timed_out: false });
  expect(await Bun.file(result.stdout_path).text()).toContain("workspace=workspace skill=skill input=fixture-data");
  expect((await readJson<any[]>(join(runDir, "script-checks.json")))[0]).toEqual(result);
  await expect(runScriptCheck({ runDir, checkId: "peer-selection", version: "authored", script: "scripts/probe.sh" })).rejects.toThrow("check id already exists");
});
