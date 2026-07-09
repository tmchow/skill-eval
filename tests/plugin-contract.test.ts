import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

describe("plugin packaging", () => {
  test("Claude and Codex manifests describe the same plugin", async () => {
    const claude = await readJson(".claude-plugin/plugin.json");
    const codex = await readJson(".codex-plugin/plugin.json");
    const description = "Run cross-model skill evals that benchmark each revision, iteratively autofix failures, and prove improvements across Claude Code and Codex.";

    expect(claude.name).toBe("skill-eval");
    expect(codex.name).toBe("skill-eval");
    expect(claude.version).toBe(codex.version);
    expect(claude.description).toBe(description);
    expect(codex.description).toBe(description);
    expect(codex.skills).toBe("./skills/");
  });

  test("both marketplaces resolve this repository", async () => {
    const claude = await readJson(".claude-plugin/marketplace.json");
    const codex = await readJson(".agents/plugins/marketplace.json");
    const claudeEntry = (claude.plugins as Array<Record<string, unknown>>)[0];
    const codexEntry = (codex.plugins as Array<Record<string, unknown>>)[0];
    const codexSource = codexEntry.source as Record<string, unknown>;

    expect(claude.name).toBe("skill-eval");
    expect(claudeEntry.name).toBe("skill-eval");
    expect(claudeEntry.description).toBe("Run cross-model skill evals that benchmark each revision, iteratively autofix failures, and prove improvements across Claude Code and Codex.");
    expect(claudeEntry.source).toBe("./");
    expect(codex.name).toBe("skill-eval");
    expect(codexEntry.name).toBe("skill-eval");
    expect(codexSource.source).toBe("url");
    expect(codexSource.url).toBe("https://github.com/tmchow/skill-eval.git");
  });
});
