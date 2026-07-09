import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { readJson } from "./json.ts";
import type { JudgeResult } from "./types.ts";

function escape(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

const textExtensions = new Set([".txt", ".md", ".json", ".csv", ".ts", ".tsx", ".js", ".jsx", ".py", ".sh", ".yaml", ".yml", ".xml", ".html", ".css", ".toml", ".sql"]);
const imageMimes: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

async function files(root: string, current = root): Promise<string[]> {
  let info;
  try { info = await stat(current); } catch { return []; }
  if (!info.isDirectory()) return [current];
  const result: string[] = [];
  for (const entry of await readdir(current)) result.push(...await files(root, join(current, entry)));
  return result;
}

async function renderArtifacts(root: string, label: string): Promise<string> {
  const cards: string[] = [];
  for (const path of await files(root)) {
    const name = path.slice(root.length + 1); const extension = extname(path).toLowerCase(); const data = await readFile(path);
    let body: string;
    if (textExtensions.has(extension)) body = `<pre>${escape(data.toString("utf8"))}</pre>`;
    else if (imageMimes[extension]) body = `<img alt="${escape(name)}" src="data:${imageMimes[extension]};base64,${data.toString("base64")}">`;
    else if (extension === ".pdf") body = `<iframe title="${escape(name)}" src="data:application/pdf;base64,${data.toString("base64")}"></iframe>`;
    else if (extension === ".xlsx") body = `<div class="xlsx" data-name="${escape(name)}" data-content="${data.toString("base64")}">Spreadsheet preview loads locally when SheetJS is available.</div>`;
    else body = `<a download="${escape(name)}" href="data:application/octet-stream;base64,${data.toString("base64")}">Download ${escape(name)}</a>`;
    cards.push(`<article><h4>${escape(name)}</h4>${body}</article>`);
  }
  return `<div class="output"><h3>Anonymous output ${label}</h3>${cards.join("") || "<p>No artifacts.</p>"}</div>`;
}

export async function generateReview(runDirInput: string, outputPath?: string, includeAll = false): Promise<{ path: string; cases: number }> {
  const runDir = resolve(runDirInput);
  const judgments = await readJson<JudgeResult[]>(join(runDir, "judgments.json"));
  const groups = new Map<string, JudgeResult[]>();
  for (const judgment of judgments) {
    const key = `${judgment.comparison_id}:${judgment.execution_attempt_id}:${judgment.eval_id}:${judgment.executor_host}:${judgment.repetition}`;
    groups.set(key, [...(groups.get(key) ?? []), judgment]);
  }
  const disputed = [...groups.values()].filter((items) => includeAll || items.some((item) => !item.valid) || new Set(items.map((item) => item.preferred_version)).size > 1);
  let benchmark: any = null;
  try { benchmark = await readJson(join(runDir, "benchmark.json")); } catch { /* review can run before aggregation */ }
  const sections: string[] = [];
  for (const [index, items] of disputed.entries()) {
    const first = items[0]!; const input = join(first.run_dir, "input");
    const outputA = await renderArtifacts(join(input, "A"), "A"); const outputB = await renderArtifacts(join(input, "B"), "B");
    const displayWinner = (item: JudgeResult): "A" | "B" | "TIE" => item.preferred_version === "TIE" ? "TIE" : first.labels.A === item.preferred_version ? "A" : "B";
    const agentJudgments = items.map((item) => `<p><strong>${escape(item.judge_host)}:</strong> ${displayWinner(item)}. ${escape(item.reasoning)}</p>`).join("");
    sections.push(`<section data-case="${index}"><h2>${escape(first.eval_id)} on ${escape(first.executor_host)}, repetition ${first.repetition}</h2><div class="outputs">${outputA}${outputB}</div><details><summary>Agent judgments</summary>${agentJudgments}</details><fieldset><legend>Human decision</legend><label><input type="radio" name="decision-${index}" value="A"> A</label><label><input type="radio" name="decision-${index}" value="B"> B</label><label><input type="radio" name="decision-${index}" value="TIE"> Tie</label><textarea aria-label="Reason" placeholder="Reason or correction"></textarea></fieldset><input type="hidden" value="${escape(first.comparison_id)}|${escape(first.execution_attempt_id)}|${escape(first.eval_id)}|${escape(first.executor_host)}|${escape(first.judge_host)}|${first.repetition}"></section>`);
  }
  const publicBenchmark = benchmark ? { verdict: benchmark.verdict, gates: benchmark.gates, preferences: benchmark.preferences, notes: benchmark.notes } : null;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Skill Eval Review</title>
<style>body{font:15px system-ui;max-width:1200px;margin:32px auto;padding:0 20px;color:#171717}section{border-top:1px solid #bbb;padding:24px 0}.outputs{display:grid;grid-template-columns:1fr 1fr;gap:16px}.output{min-width:0}.output article{border:1px solid #ddd;padding:12px;margin:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}img,iframe{max-width:100%;min-height:240px}textarea{display:block;width:100%;min-height:80px;margin-top:12px}button{padding:8px 12px}@media(max-width:760px){.outputs{grid-template-columns:1fr}}</style>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" integrity="sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw" crossorigin="anonymous"></script></head>
<body><h1>Skill Eval Review</h1><p>Outputs remain anonymous. Review only the unresolved cases.</p>${sections.join("") || "<p>No unresolved judge disagreements.</p>"}<details><summary>Benchmark evidence</summary><pre>${escape(JSON.stringify(publicBenchmark, null, 2))}</pre></details><button id="export">Export decision</button>
<script>
for(const node of document.querySelectorAll('.xlsx')){try{if(!window.XLSX)throw new Error('SheetJS unavailable');const bytes=Uint8Array.from(atob(node.dataset.content),c=>c.charCodeAt(0));const book=XLSX.read(bytes,{type:'array'});node.textContent='';for(const name of book.SheetNames){const heading=document.createElement('h5');heading.textContent=name;node.appendChild(heading);const table=document.createElement('div');table.innerHTML=XLSX.utils.sheet_to_html(book.Sheets[name]);node.appendChild(table)}}catch(error){node.textContent='Spreadsheet preview unavailable: '+error.message}}
document.getElementById('export').addEventListener('click',()=>{const reviews=[...document.querySelectorAll('section[data-case]')].map(section=>{const [comparison_id,execution_attempt_id,eval_id,executor_host,judge_host,repetition]=section.querySelector('input[type=hidden]').value.split('|');return{comparison_id,execution_attempt_id,eval_id,executor_host,judge_host,repetition:Number(repetition),winner:section.querySelector('input[type=radio]:checked')?.value||null,reason:section.querySelector('textarea').value}});const status=reviews.every(review=>review.winner)?'complete':'incomplete';const blob=new Blob([JSON.stringify({status,reviews},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='skill-eval-feedback.json';a.click();URL.revokeObjectURL(a.href)});
</script></body></html>`;
  const path = resolve(outputPath ?? join(runDir, "review.html")); await writeFile(path, html);
  return { path, cases: disputed.length };
}
