import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

export async function reserveArtifactDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await mkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`artifact directory already exists: ${path}`);
    throw error;
  }
}

export async function copyTree(source: string, destination: string): Promise<void> {
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, dereference: false, preserveTimestamps: true });
}

async function treeEntries(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) paths.push(...await treeEntries(root, path));
    else paths.push(relative(root, path));
  }
  return paths;
}

export async function hashTree(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const path of await treeEntries(root)) {
    const absolute = join(root, path);
    const info = await lstat(absolute);
    hash.update(path.split(sep).join("/"));
    hash.update("\0");
    hash.update(String(info.mode & 0o777));
    hash.update("\0");
    if (info.isSymbolicLink()) throw new Error(`symlinks are not allowed in frozen trees: ${path}`);
    hash.update("file\0");
    hash.update(await readFile(absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function containedPath(root: string, requested: string): string {
  const absoluteRoot = resolve(root);
  const absolute = resolve(root, requested);
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error(`path escapes root: ${requested}`);
  }
  return absolute;
}

export async function assertWritableDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  const marker = join(path, `.write-test-${randomUUID()}`);
  const handle = await open(marker, "wx");
  await handle.close();
  await rm(marker);
}
