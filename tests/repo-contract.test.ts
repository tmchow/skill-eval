import { expect, test } from "bun:test";
import { lstat, readFile, readlink } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("uses AGENTS.md as the canonical cross-harness repository instructions", async () => {
  const instructions = await readFile(resolve(root, "AGENTS.md"), "utf8");
  const compatibility = await lstat(resolve(root, "CLAUDE.md"));
  expect(instructions).toContain("bun run validate");
  expect(instructions).toContain("Evaluation Integrity");
  expect(compatibility.isSymbolicLink()).toBe(true);
  expect(await readlink(resolve(root, "CLAUDE.md"))).toBe("AGENTS.md");
});
