import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

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
