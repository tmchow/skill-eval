import { afterEach, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const serverScript = join(import.meta.dir, "..", "skills", "skill-eval", "scripts", "review-server.js");
const rootsToStop: string[] = [];

async function command(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const process = Bun.spawn(["bun", serverScript, ...args], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  return { exitCode, stdout, stderr };
}

async function start(root: string): Promise<Record<string, any>> {
  const result = await command(["start", "--root", root, "--port", "0"]);
  expect(result.exitCode, result.stderr).toBe(0);
  rootsToStop.push(root);
  return JSON.parse(result.stdout.trim());
}

afterEach(async () => {
  while (rootsToStop.length > 0) await command(["stop", "--root", rootsToStop.pop()!]);
});

test("serves the newest read-only review at a stable localhost URL", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "skill-eval-review-server-"));
  const info = await start(root);
  expect(info.url).toMatch(/^http:\/\/localhost:\d+$/);

  await fs.writeFile(join(info.screen_dir, "001-review.html"), "<!doctype html><html><body><h1>Review one</h1></body></html>");
  let response = await fetch(info.url);
  let html = await response.text();
  expect(html).toContain("Review one");
  expect(html).toContain('fetch("/version"');
  expect(html).not.toContain("WebSocket");
  expect(html).not.toContain("/events");

  await new Promise((resolve) => setTimeout(resolve, 20));
  await fs.writeFile(join(info.screen_dir, "002-review.html"), "<!doctype html><html><body><h1>Review two</h1></body></html>");
  response = await fetch(info.url);
  html = await response.text();
  expect(html).toContain("Review two");
  expect(html).not.toContain("Review one");
});

test("reports status and stops the server by display root", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "skill-eval-review-status-"));
  await start(root);

  let result = await command(["status", "--root", root]);
  expect(JSON.parse(result.stdout).status).toBe("running");
  result = await command(["stop", "--root", root]);
  expect(JSON.parse(result.stdout).status).toBe("stopped");
  result = await command(["status", "--root", root]);
  expect(JSON.parse(result.stdout).status).toBe("stopped");
});
