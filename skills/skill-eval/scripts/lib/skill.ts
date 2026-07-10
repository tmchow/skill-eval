import { readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

export interface SkillMetadata {
  name: string;
  description: string;
  content: string;
}

export function parseSkillMarkdown(content: string): SkillMetadata {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") throw new Error("SKILL.md missing opening frontmatter delimiter");
  const end = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (end < 0) throw new Error("SKILL.md missing closing frontmatter delimiter");
  const frontmatter = lines.slice(1, end + 1);
  let name = "";
  let description = "";
  for (let index = 0; index < frontmatter.length; index += 1) {
    const line = frontmatter[index] ?? "";
    if (line.startsWith("name:")) name = line.slice(5).trim().replace(/^['"]|['"]$/g, "");
    if (line.startsWith("description:")) {
      const value = line.slice(12).trim();
      if ([">", "|", ">-", "|-"].includes(value)) {
        const parts: string[] = [];
        while ((frontmatter[index + 1] ?? "").match(/^\s+/)) {
          index += 1;
          parts.push((frontmatter[index] ?? "").trim());
        }
        description = parts.join(" ");
      } else {
        description = value.replace(/^['"]|['"]$/g, "");
      }
    }
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error("SKILL.md has an invalid or missing name");
  if (!description) throw new Error("SKILL.md has a missing description");
  if (description.length > 1024) throw new Error("SKILL.md description exceeds 1024 characters");
  if (/[<>]/.test(description)) throw new Error("SKILL.md description must not contain angle brackets");
  return { name, description, content };
}

export async function readSkill(targetPath: string): Promise<SkillMetadata> {
  const target = resolve(targetPath);
  return parseSkillMarkdown(await readFile(join(target, "SKILL.md"), "utf8"));
}

async function filesUnder(root: string, current = root): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) paths.push(...await filesUnder(root, path));
    else if (entry.isFile()) paths.push(relative(root, path).replaceAll("\\", "/"));
  }
  return paths;
}

export async function findPotentialEvaluatorFiles(targetPath: string): Promise<string[]> {
  const target = resolve(targetPath);
  const skill = await readSkill(target);
  const namePattern = /(^|[-_.])(evals?|evaluation|benchmark)([-_.]|$)/i;
  return (await filesUnder(target))
    .filter((path) => /\.(md|json|ya?ml)$/i.test(path) && namePattern.test(basename(path)))
    .filter((path) => !skill.content.includes(path) && !skill.content.includes(basename(path)))
    .sort();
}

async function skillDirectory(path: string): Promise<string | null> {
  try {
    if (!(await stat(join(path, "SKILL.md"))).isFile()) return null;
    return realpath(path);
  } catch {
    return null;
  }
}

function gitRoot(cwd: string): string | null {
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd, stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

export async function resolveSkillTarget(input: string, cwd = process.cwd()): Promise<string> {
  const direct = resolve(cwd, input);
  const directSkill = await skillDirectory(direct);
  if (directSkill) return directSkill;
  if (basename(input) !== input) throw new Error(`skill target not found: ${direct}`);

  const root = gitRoot(cwd);
  const searchRoots = [...new Set([cwd, ...(root ? [root] : [])])];
  const matches = new Set<string>();
  for (const searchRoot of searchRoots) {
    for (const candidate of [join(searchRoot, "skills", input), join(searchRoot, input)]) {
      const found = await skillDirectory(candidate);
      if (found) matches.add(found);
    }
    const skillsRoot = join(searchRoot, "skills");
    let entries: Array<import("node:fs").Dirent<string>> = [];
    try { entries = await readdir(skillsRoot, { withFileTypes: true, encoding: "utf8" }); } catch { /* no conventional skills directory */ }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const candidate = await skillDirectory(join(skillsRoot, entry.name));
      if (!candidate) continue;
      try {
        if ((await readSkill(candidate)).name === input) matches.add(candidate);
      } catch { /* malformed candidates are reported only when addressed directly */ }
    }
  }
  if (matches.size === 1) return [...matches][0]!;
  if (matches.size > 1) throw new Error(`skill name is ambiguous: ${input}; matches ${[...matches].join(", ")}`);
  throw new Error(`skill target not found by path or repository skill name: ${input}`);
}

export function replaceSkillDescription(content: string, description: string): string {
  if (!description.trim()) throw new Error("description must not be empty");
  if (description.length > 1024) throw new Error("description exceeds 1024 characters");
  if (/[<>\n\r]/.test(description)) throw new Error("description must be one line without angle brackets");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") throw new Error("SKILL.md missing opening frontmatter delimiter");
  const end = lines.slice(1).findIndex((line) => line.trim() === "---") + 1;
  if (end <= 0) throw new Error("SKILL.md missing closing frontmatter delimiter");
  const index = lines.slice(1, end).findIndex((line) => line.startsWith("description:")) + 1;
  if (index <= 0) throw new Error("SKILL.md has a missing description");
  let removeThrough = index;
  const value = lines[index]!.slice(12).trim();
  if ([">", "|", ">-", "|-"].includes(value)) while (removeThrough + 1 < end && /^\s+/.test(lines[removeThrough + 1]!)) removeThrough += 1;
  lines.splice(index, removeThrough - index + 1, `description: ${description}`);
  return lines.join("\n");
}

export async function writeSkillDescription(targetPath: string, description: string): Promise<void> {
  const path = join(resolve(targetPath), "SKILL.md");
  const updated = replaceSkillDescription(await readFile(path, "utf8"), description);
  parseSkillMarkdown(updated);
  await writeFile(path, updated);
}
