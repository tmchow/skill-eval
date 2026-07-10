#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const DEFAULT_HOST = "127.0.0.1";
const IDLE_TIMEOUT_MS = Number(process.env.SKILL_EVAL_REVIEW_IDLE_TIMEOUT_MS) || 30 * 60 * 1000;
const LIFECYCLE_CHECK_MS = Number(process.env.SKILL_EVAL_REVIEW_LIFECYCLE_CHECK_MS) || 60 * 1000;

function usage() {
  return [
    "Usage:",
    "  bun review-server.js start --root <dir> [--host 127.0.0.1] [--port 0] [--foreground] [--owner-pid <pid>]",
    "  bun review-server.js stop --root <dir>",
    "  bun review-server.js status --root <dir>",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { command: argv[2], host: DEFAULT_HOST, port: 0, foreground: false };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") options.root = argv[++index];
    else if (argument === "--host") options.host = argv[++index];
    else if (argument === "--port") options.port = Number(argv[++index]);
    else if (argument === "--foreground") options.foreground = true;
    else if (argument === "--owner-pid") options.ownerPid = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!["start", "serve", "stop", "status"].includes(options.command)) throw new Error(usage());
  if (!options.root) throw new Error("--root is required");
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error("--port must be an integer from 0 to 65535");
  if (options.ownerPid !== undefined && (!Number.isInteger(options.ownerPid) || options.ownerPid <= 1)) throw new Error("--owner-pid must be an integer greater than 1");
  options.root = path.resolve(options.root);
  options.screensDir = path.join(options.root, "screens");
  options.stateDir = path.join(options.root, "state");
  options.pidFile = path.join(options.stateDir, "server.pid");
  options.infoFile = path.join(options.stateDir, "display-info.json");
  options.logFile = path.join(options.stateDir, "server.log");
  return options;
}

function ensureDirectories(options) {
  fs.mkdirSync(options.screensDir, { recursive: true });
  fs.mkdirSync(options.stateDir, { recursive: true });
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function processAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

function processArguments(pid) {
  try { return execFileSync("ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

function ownsServerProcess(options, pid) {
  const argumentsText = processArguments(pid);
  return argumentsText === null || (argumentsText.includes(scriptPath) && argumentsText.includes("serve") && argumentsText.includes(options.root));
}

function ownerPid() {
  const parent = process.ppid;
  if (!parent || parent <= 1) return null;
  try {
    const grandparent = Number(execFileSync("ps", ["-o", "ppid=", "-p", String(parent)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
    if (Number.isInteger(grandparent) && grandparent > 1) return grandparent;
  } catch { /* direct parent is the best available owner */ }
  return parent;
}

function readPid(options) {
  if (!fs.existsSync(options.pidFile)) return null;
  const pid = Number(fs.readFileSync(options.pidFile, "utf8").trim());
  return Number.isInteger(pid) ? pid : null;
}

function runningInfo(options) {
  const pid = readPid(options);
  if (!processAlive(pid) || !ownsServerProcess(options, pid) || !fs.existsSync(options.infoFile)) return null;
  return JSON.parse(fs.readFileSync(options.infoFile, "utf8"));
}

function newestScreen(options) {
  if (!fs.existsSync(options.screensDir)) return null;
  return fs.readdirSync(options.screensDir)
    .filter((file) => file.endsWith(".html"))
    .map((file) => ({ path: path.join(options.screensDir, file), modified: fs.statSync(path.join(options.screensDir, file)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified)[0]?.path ?? null;
}

function screenVersion(options) {
  const screen = newestScreen(options);
  return screen ? { screen: path.basename(screen), mtimeMs: fs.statSync(screen).mtimeMs } : { screen: null, mtimeMs: 0 };
}

function refreshScript(options) {
  return `<script>
(function(){
  var currentVersion=${JSON.stringify(screenVersion(options))};
  function key(version){return String(version&&version.screen)+":"+String(version&&version.mtimeMs)}
  async function check(){try{var response=await fetch("/version",{cache:"no-store"});if(!response.ok)return;var next=await response.json();if(key(next)!==key(currentVersion))window.location.reload()}catch(error){}}
  setInterval(check,1000);
})();
</script>`;
}

function renderPage(options) {
  const screen = newestScreen(options);
  const refresh = refreshScript(options);
  if (!screen) return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Skill Eval Review</title></head><body><h1>Waiting for review...</h1>${refresh}</body></html>`;
  const html = fs.readFileSync(screen, "utf8");
  return html.includes("</body>") ? html.replace("</body>", `${refresh}\n</body>`) : `${html}\n${refresh}`;
}

async function waitForInfo(options, pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(options.infoFile)) return JSON.parse(fs.readFileSync(options.infoFile, "utf8"));
    if (pid && !processAlive(pid)) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function start(options) {
  ensureDirectories(options);
  options.ownerPid = options.ownerPid ?? ownerPid();
  const existing = runningInfo(options);
  if (existing) { output({ ...existing, status: "running" }); return; }
  fs.rmSync(options.pidFile, { force: true });
  fs.rmSync(options.infoFile, { force: true });
  if (options.foreground) { await serve(options); return; }
  const log = fs.openSync(options.logFile, "a");
  const child = spawn(process.execPath, [scriptPath, "serve", "--root", options.root, "--host", options.host, "--port", String(options.port), ...(options.ownerPid ? ["--owner-pid", String(options.ownerPid)] : [])], { detached: true, stdio: ["ignore", log, log] });
  child.unref();
  fs.closeSync(log);
  const info = await waitForInfo(options, child.pid);
  if (!info) throw new Error(`Server failed to start. See ${options.logFile}`);
  output({ ...info, status: "started" });
}

async function serve(options) {
  ensureDirectories(options);
  let lastActivity = Date.now();
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/") {
      lastActivity = Date.now();
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(renderPage(options));
      return;
    }
    if (request.method === "GET" && request.url === "/version") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(`${JSON.stringify(screenVersion(options))}\n`);
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  });
  server.listen(options.port, options.host, () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : options.port;
    const info = { status: "running", root: options.root, host: options.host, port, url: `http://localhost:${port}`, screen_dir: options.screensDir, state_dir: options.stateDir, pid: process.pid, owner_pid: options.ownerPid ?? null };
    fs.writeFileSync(options.pidFile, `${process.pid}\n`);
    fs.writeFileSync(options.infoFile, `${JSON.stringify(info, null, 2)}\n`);
    output(info);
  });
  const lifecycle = setInterval(() => {
    if ((options.ownerPid && !processAlive(options.ownerPid)) || Date.now() - lastActivity > IDLE_TIMEOUT_MS) server.close(() => process.exit(0));
  }, LIFECYCLE_CHECK_MS);
  lifecycle.unref();
}

async function stop(options) {
  const pid = readPid(options);
  if (!processAlive(pid) || !ownsServerProcess(options, pid)) {
    fs.rmSync(options.pidFile, { force: true });
    output({ status: "stopped", root: options.root });
    return;
  }
  process.kill(pid);
  for (let attempt = 0; attempt < 20 && processAlive(pid); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  if (processAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* process exited between checks */ } }
  fs.rmSync(options.pidFile, { force: true });
  output({ status: "stopped", root: options.root });
}

function status(options) {
  const info = runningInfo(options);
  output(info ? { ...info, status: "running" } : { status: "stopped", root: options.root });
}

try {
  const options = parseArgs(process.argv);
  if (options.command === "start") await start(options);
  else if (options.command === "serve") await serve(options);
  else if (options.command === "stop") await stop(options);
  else status(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
