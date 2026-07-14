import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function readOptionalJson<T>(path: string, fallback: T): Promise<T> {
  try { return await readJson<T>(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export function parseJsonObject(raw: string): Record<string, any> | null {
  const candidates = [raw.trim()];
  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== "{") continue;
    let depth = 0; let quoted = false; let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const character = raw[index]!;
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        candidates.push(raw.slice(start, index + 1));
        start = index;
        break;
      }
    }
  }
  for (const candidate of [...new Set(candidates)]) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch { /* try the next complete JSON object */ }
  }
  return null;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function withFileLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + 60_000;
  await mkdir(dirname(path), { recursive: true });
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockStat = await stat(lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > 30_000) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`timed out waiting for state lock: ${path}`);
      await Bun.sleep(10);
    }
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function updateJsonArray<T>(path: string, values: T[], key: (value: T) => string, replace: boolean): Promise<T[]> {
  return withFileLock(path, async () => {
    const current = await readOptionalJson<T[]>(path, []);
    const indexes = new Map(current.map((value, index) => [key(value), index]));
    let changed = false;
    for (const value of values) {
      const identity = key(value);
      const index = indexes.get(identity);
      if (index === undefined) {
        indexes.set(identity, current.length);
        current.push(value);
        changed = true;
        continue;
      }
      if (JSON.stringify(current[index]) === JSON.stringify(value)) continue;
      if (!replace) throw new Error(`conflicting immutable state record: ${identity}`);
      current[index] = value;
      changed = true;
    }
    if (changed) await writeJson(path, current);
    return current;
  });
}

export async function mergeJsonArray<T>(path: string, values: T[], key: (value: T) => string): Promise<T[]> {
  return updateJsonArray(path, values, key, false);
}

export async function upsertJsonArray<T>(path: string, values: T[], key: (value: T) => string): Promise<T[]> {
  return updateJsonArray(path, values, key, true);
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
