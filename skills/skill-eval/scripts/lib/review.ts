import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { escapeHtml as escape } from "./html.ts";
import { readJson } from "./json.ts";
import type { HostName, JudgeResult } from "./types.ts";

const textExtensions = new Set([".txt", ".md", ".json", ".csv", ".ts", ".tsx", ".js", ".jsx", ".py", ".sh", ".yaml", ".yml", ".xml", ".html", ".css", ".toml", ".sql"]);
const imageMimes: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

export interface ReviewCaseDescriptor {
  case_id: string;
  eval_id: string;
  executor_host: HostName;
  repetition: number;
  reason: "model-disagreement" | "invalid-judgment" | "requested";
  model_votes: Array<{ judge_host: HostName; winner: "A" | "B" | "TIE"; valid: boolean }>;
}

export function reviewCaseId(judgment: Pick<JudgeResult, "comparison_id" | "execution_attempt_id" | "eval_id" | "executor_host" | "repetition">): string {
  const identity = [judgment.comparison_id, judgment.execution_attempt_id, judgment.eval_id, judgment.executor_host, judgment.repetition].join("\0");
  return `review-${createHash("sha256").update(identity).digest("hex").slice(0, 12)}`;
}

function groupKey(judgment: JudgeResult): string {
  return [judgment.comparison_id, judgment.execution_attempt_id, judgment.eval_id, judgment.executor_host, judgment.repetition].join("\0");
}

async function files(current: string): Promise<string[]> {
  let info;
  try { info = await stat(current); } catch { return []; }
  if (!info.isDirectory()) return [current];
  const result: string[] = [];
  for (const entry of await readdir(current)) result.push(...await files(join(current, entry)));
  return result;
}

function markdownToHtml(source: string): string {
  const output: string[] = [];
  let paragraph: string[] = [];
  let list: "ul" | "ol" | null = null;
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) output.push(`<p>${paragraph.map(escape).join(" ")}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) output.push(`</${list}>`);
    list = null;
  };

  for (const line of source.split(/\r?\n/)) {
    if (line.trim().startsWith("```")) {
      flushParagraph(); closeList();
      if (code) { output.push(`<pre class="code"><code>${escape(code.join("\n"))}</code></pre>`); code = null; }
      else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { flushParagraph(); closeList(); const level = heading[1]!.length; output.push(`<h${level}>${escape(heading[2])}</h${level}>`); continue; }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || ordered) {
      flushParagraph();
      const nextList = bullet ? "ul" : "ol";
      if (list !== nextList) { closeList(); list = nextList; output.push(`<${list}>`); }
      output.push(`<li>${escape((bullet ?? ordered)![1])}</li>`);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { flushParagraph(); closeList(); output.push(`<blockquote>${escape(quote[1])}</blockquote>`); continue; }
    paragraph.push(line.trim());
  }
  flushParagraph(); closeList();
  if (code) output.push(`<pre class="code"><code>${escape(code.join("\n"))}</code></pre>`);
  return output.join("");
}

async function renderArtifact(path: string, name: string): Promise<string> {
  const extension = extname(path).toLowerCase();
  const data = await readFile(path);
  if (extension === ".md") return `<div class="document"><article class="markdown">${markdownToHtml(data.toString("utf8"))}</article></div>`;
  if (textExtensions.has(extension)) return `<pre class="code">${escape(data.toString("utf8"))}</pre>`;
  if (imageMimes[extension]) return `<div class="media-view"><img alt="${escape(name)}" src="data:${imageMimes[extension]};base64,${data.toString("base64")}"></div>`;
  if (extension === ".pdf") return `<iframe class="pdf-view" title="${escape(name)}" src="data:application/pdf;base64,${data.toString("base64")}"></iframe>`;
  if (extension === ".xlsx") return `<div class="xlsx" data-name="${escape(name)}" data-content="${data.toString("base64")}">Spreadsheet preview loads locally when SheetJS is available.</div>`;
  return `<div class="binary-view"><p>This artifact has no inline preview.</p><a download="${escape(name)}" href="data:application/octet-stream;base64,${data.toString("base64")}">Download ${escape(name)}</a></div>`;
}

async function renderArtifacts(root: string, label: "A" | "B", caseId: string): Promise<string> {
  const paths = await files(root);
  if (paths.length === 0) return `<div class="empty">No artifacts were produced.</div>`;
  const tabs: string[] = [];
  const panels: string[] = [];
  for (const [index, path] of paths.entries()) {
    const name = path.slice(root.length + 1);
    const artifactId = `${caseId}-${label}-${index}`;
    tabs.push(`<button class="artifact-tab" data-artifact="${artifactId}" aria-selected="${index === 0}">${escape(name)}</button>`);
    panels.push(`<article class="artifact-panel" data-artifact-panel="${artifactId}"${index === 0 ? "" : " hidden"}>${await renderArtifact(path, name)}</article>`);
  }
  return `<nav class="artifact-tabs" aria-label="Output ${label} artifacts">${tabs.join("")}</nav><div class="artifact-stage">${panels.join("")}</div>`;
}

function displayedWinner(item: JudgeResult, reference: JudgeResult): "A" | "B" | "TIE" {
  if (item.preferred_version === "TIE") return "TIE";
  return reference.labels.A === item.preferred_version ? "A" : "B";
}

function hostLabel(host: HostName): string {
  return host === "claude" ? "Claude Code" : "Codex";
}

function displayReason(items: JudgeResult[], reference: JudgeResult, includeAll: boolean): ReviewCaseDescriptor["reason"] {
  if (items.some((item) => !item.valid)) return "invalid-judgment";
  if (new Set(items.map((item) => displayedWinner(item, reference))).size > 1) return "model-disagreement";
  return includeAll ? "requested" : "model-disagreement";
}

function renderSignals(items: JudgeResult[], reference: JudgeResult, label: "A" | "B", kind: "strengths" | "weaknesses"): string[] {
  const signals: string[] = [];
  for (const item of items) {
    const sourceLabel = item.labels.A === reference.labels[label] ? "A" : "B";
    const values = item[kind]?.[sourceLabel];
    if (Array.isArray(values)) signals.push(...values.filter((value): value is string => typeof value === "string"));
  }
  return [...new Set(signals)];
}

function renderSignalList(values: string[], fallback: string): string {
  return values.length > 0 ? `<ul>${values.map((value) => `<li>${escape(value)}</li>`).join("")}</ul>` : `<p class="muted">${fallback}</p>`;
}

function renderModelVotes(items: JudgeResult[], reference: JudgeResult, detailed = false): string {
  return items.map((item) => {
    const winner = displayedWinner(item, reference);
    const details = detailed ? `<details><summary>Structured rubric</summary><pre class="code compact">${escape(JSON.stringify({ rubric: item.rubric ?? {}, strengths: item.strengths ?? {}, weaknesses: item.weaknesses ?? {} }, null, 2))}</pre></details>` : "";
    return `<div class="model-vote"><div class="vote-head"><strong>${escape(hostLabel(item.judge_host))}</strong><span class="vote ${winner.toLowerCase()}">${item.valid ? `Prefers ${winner}` : "Invalid judgment"}</span></div><p>${escape(item.reasoning)}</p>${details}</div>`;
  }).join("");
}

function renderBenchmark(benchmark: any): string {
  if (!benchmark) return `<div class="evidence-note"><strong>No aggregate benchmark yet</strong>This review was generated before benchmark aggregation.</div>`;
  const gates = benchmark.gates?.passed === true ? "Passed" : benchmark.gates?.passed === false ? "Blocked" : "Not reported";
  const reasons = Array.isArray(benchmark.gates?.reasons) ? benchmark.gates.reasons : [];
  const notes = Array.isArray(benchmark.notes) ? benchmark.notes : [];
  return `<div class="metric-grid"><div class="metric"><span>Verdict</span><strong>${escape(benchmark.verdict ?? "Pending")}</strong></div><div class="metric"><span>Objective gates</span><strong>${escape(gates)}</strong></div></div><div class="evidence-note"><strong>Decision-relevant notes</strong>${renderSignalList([...reasons, ...notes], "No additional benchmark notes.")}</div>`;
}

function caseHeadline(reason: ReviewCaseDescriptor["reason"], votes: Array<"A" | "B" | "TIE">): string {
  if (reason === "invalid-judgment") return "One or more model judgments could not be validated.";
  if (reason === "requested") return "This comparison was opened for inspection.";
  const a = votes.filter((vote) => vote === "A").length;
  const b = votes.filter((vote) => vote === "B").length;
  const tie = votes.filter((vote) => vote === "TIE").length;
  const preference = (count: number, label: string) => `${count} ${count === 1 ? "prefers" : "prefer"} ${label}`;
  return `The models disagree: ${preference(a, "A")}, ${preference(b, "B")}${tie ? `, and ${preference(tie, "a tie")}` : ""}.`;
}

export async function generateReview(runDirInput: string, outputPath?: string, includeAll = false): Promise<{ path: string; cases: number; reviews: ReviewCaseDescriptor[] }> {
  const runDir = resolve(runDirInput);
  const judgments = await readJson<JudgeResult[]>(join(runDir, "judgments.json"));
  const groups = new Map<string, JudgeResult[]>();
  for (const judgment of judgments) {
    const key = groupKey(judgment);
    const group = groups.get(key);
    if (group) group.push(judgment);
    else groups.set(key, [judgment]);
  }
  const disputed = [...groups.values()].filter((items) => includeAll || items.some((item) => !item.valid) || new Set(items.map((item) => item.preferred_version)).size > 1);
  let benchmark: any = null;
  try { benchmark = await readJson(join(runDir, "benchmark.json")); } catch { /* review can run before aggregation */ }

  const descriptors: ReviewCaseDescriptor[] = [];
  const caseButtons: string[] = [];
  const caseShells: string[] = [];
  for (const [index, items] of disputed.entries()) {
    const first = items[0]!;
    const caseId = reviewCaseId(first);
    const reason = displayReason(items, first, includeAll);
    const votes = items.map((item) => displayedWinner(item, first));
    const descriptor: ReviewCaseDescriptor = {
      case_id: caseId,
      eval_id: first.eval_id,
      executor_host: first.executor_host,
      repetition: first.repetition,
      reason,
      model_votes: items.map((item) => ({ judge_host: item.judge_host, winner: displayedWinner(item, first), valid: item.valid })),
    };
    descriptors.push(descriptor);
    caseButtons.push(`<button class="case-tab" data-case="${caseId}" data-title="${escape(first.eval_id)}" data-meta="${escape(`${first.executor_host} executor / repetition ${first.repetition}`)}" aria-selected="${index === 0}"><span>Review case ${index + 1}</span><strong>${escape(first.eval_id)}</strong></button>`);

    const input = join(first.run_dir, "input");
    const [outputA, outputB] = await Promise.all([
      renderArtifacts(join(input, "A"), "A", caseId),
      renderArtifacts(join(input, "B"), "B", caseId),
    ]);
    const strengthsA = renderSignals(items, first, "A", "strengths");
    const strengthsB = renderSignals(items, first, "B", "strengths");
    const weaknessesA = renderSignals(items, first, "A", "weaknesses");
    const weaknessesB = renderSignals(items, first, "B", "weaknesses");
    const escalation = reason === "invalid-judgment" ? "At least one evaluator returned an invalid judgment." : reason === "requested" ? "This case was explicitly requested for human inspection." : "Anonymous evaluators disagree on the preferred output.";
    caseShells.push(`<div class="case-shell" data-case-shell="${caseId}"${index === 0 ? "" : " hidden"}>
      <div class="escalation"><span class="question-mark">?</span><div><strong>Why this needs you</strong><p>${escape(escalation)}</p></div><span class="gate-state">${escape(benchmark?.gates?.passed === true ? "Objective gates passed" : benchmark?.verdict ?? "Benchmark pending")}</span></div>
      <section class="screen" data-view-panel="judgment">
        <div class="judgment-layout">
          <section class="panel judgment-panel"><div class="panel-header"><h2>Cross-model judgment</h2><span>Analysis complete</span></div><div class="judgment-lead"><span>Unresolved comparison</span><h2>${escape(caseHeadline(reason, votes))}</h2><p>Review the model rationales and inspect either anonymous output when needed. Version identity remains hidden until the decision is recorded.</p></div>
            <div class="signals"><div><h3>Output A signals</h3><h4>Strengths</h4>${renderSignalList(strengthsA, "No distinct strengths reported.")}<h4>Weaknesses</h4>${renderSignalList(weaknessesA, "No distinct weaknesses reported.")}</div><div><h3>Output B signals</h3><h4>Strengths</h4>${renderSignalList(strengthsB, "No distinct strengths reported.")}<h4>Weaknesses</h4>${renderSignalList(weaknessesB, "No distinct weaknesses reported.")}</div></div>
          </section>
          <aside><section class="human-question"><span>Human question</span><h2>Which output better satisfies this case?</h2></section><section class="panel votes-panel"><div class="panel-header"><h2>Model votes</h2></div>${renderModelVotes(items, first)}</section></aside>
        </div>
      </section>
      <section class="screen" data-view-panel="a" hidden><div class="output-heading"><div><span class="output-badge">A</span><strong>Anonymous output A</strong></div><span>Identity hidden</span></div>${outputA}</section>
      <section class="screen" data-view-panel="b" hidden><div class="output-heading"><div><span class="output-badge">B</span><strong>Anonymous output B</strong></div><span>Identity hidden</span></div>${outputB}</section>
      <section class="screen" data-view-panel="evidence" hidden><div class="evidence-grid"><section class="panel"><div class="panel-header"><h2>Judgment evidence</h2><span>Blind evaluation</span></div>${renderModelVotes(items, first, true)}</section><section class="panel"><div class="panel-header"><h2>Benchmark evidence</h2></div>${renderBenchmark(benchmark)}</section></div></section>
    </div>`);
  }

  const empty = descriptors.length === 0;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Skill Eval Review</title>
<style>
:root{--canvas:#f3f5f7;--surface:#fff;--muted:#64717d;--ink:#17212b;--line:#d7dde3;--line-strong:#aab5bf;--accent:#087f71;--accent-soft:#e7f4f1;--blue:#416b9b;--blue-soft:#edf3f9;--warning:#9a5a04;--warning-soft:#fff4df;--radius:6px}*{box-sizing:border-box}html,body{margin:0;background:var(--canvas);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}button{font:inherit;color:inherit;letter-spacing:0}button:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid rgba(8,127,113,.22);outline-offset:2px}[hidden]{display:none!important}.topbar{position:sticky;top:0;z-index:20;border-bottom:1px solid var(--line);background:rgba(255,255,255,.97);backdrop-filter:blur(10px)}.topbar-inner,main{width:min(1200px,calc(100% - 40px));margin:0 auto}.identity{min-height:68px;display:flex;align-items:center;justify-content:space-between;gap:24px}.eyebrow{color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase}.identity h1{margin:2px 0 0;font-size:19px;line-height:1.25}.case-meta{color:var(--muted);font-size:12px}.review-state{display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid #e0b975;border-radius:var(--radius);color:#714400;background:var(--warning-soft);font-size:12px;font-weight:800}.review-state:before{width:7px;height:7px;border-radius:50%;background:#cf7700;content:""}.case-tabs{display:flex;overflow-x:auto;border-top:1px solid #edf0f2}.case-tab{min-width:220px;max-width:340px;padding:9px 14px 10px;border:0;border-right:1px solid #edf0f2;border-bottom:3px solid transparent;background:transparent;cursor:pointer;text-align:left}.case-tab[aria-selected=true]{border-bottom-color:var(--accent);background:#fbfcfc}.case-tab span{display:block;color:var(--muted);font-size:9px;font-weight:800;text-transform:uppercase}.case-tab strong{display:block;overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.view-tabs{display:flex;gap:4px;overflow-x:auto;border-top:1px solid #edf0f2}.view-tab{padding:11px 14px 10px;border:0;border-bottom:3px solid transparent;color:var(--muted);background:transparent;cursor:pointer;font-weight:750}.view-tab[aria-selected=true]{border-bottom-color:var(--ink);color:var(--ink)}main{padding:22px 0 44px}.escalation{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:13px;align-items:center;margin-bottom:18px;padding:12px 14px;border:1px solid #e2bd7d;border-radius:var(--radius);background:#fffaf1}.question-mark{display:grid;width:24px;height:24px;place-items:center;border-radius:50%;color:#fff;background:var(--warning);font-size:12px;font-weight:900}.escalation strong{font-size:12px}.escalation p{margin:1px 0 0;color:#624c2a}.gate-state{color:#075e55;font-size:12px;font-weight:800;white-space:nowrap}.judgment-layout{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:18px;align-items:start}.panel{border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);overflow:hidden}.panel-header{display:flex;justify-content:space-between;gap:16px;padding:13px 16px;border-bottom:1px solid var(--line)}.panel-header h2{margin:0;font-size:14px}.panel-header span{color:#075e55;font-size:11px;font-weight:800}.judgment-lead{padding:25px 26px 22px}.judgment-lead>span,.human-question>span{color:#075e55;font-size:10px;font-weight:850;text-transform:uppercase}.judgment-lead h2{margin:5px 0 10px;font-size:25px;line-height:1.25}.judgment-lead p{margin:0;color:#42505c;font-size:15px}.signals{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--line)}.signals>div{padding:17px 20px}.signals>div+div{border-left:1px solid var(--line)}.signals h3{margin:0 0 12px;font-size:13px}.signals h4{margin:12px 0 4px;color:var(--muted);font-size:10px;text-transform:uppercase}.signals ul,.evidence-note ul{margin:5px 0 0;padding-left:18px}.signals li{margin:5px 0}.muted{margin:4px 0;color:var(--muted)}.human-question{position:relative;padding:18px 18px 18px 21px;overflow:hidden;border:1px solid #d7b16d;border-radius:var(--radius);background:#fffbf3}.human-question:before{position:absolute;top:0;bottom:0;left:0;width:4px;background:var(--warning);content:""}.human-question>span{color:#805006}.human-question h2{margin:5px 0 9px;font-size:18px;line-height:1.3}.human-question p{margin:0;color:#5b4a2f}.votes-panel{margin-top:14px}.model-vote{padding:14px 16px}.model-vote+.model-vote{border-top:1px solid var(--line)}.vote-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:5px}.vote-head strong{font-size:12px}.vote{font-weight:850}.vote.a{color:var(--blue)}.vote.b{color:var(--accent)}.vote.tie{color:var(--warning)}.model-vote p{margin:0;color:#45535f;font-size:12px}.model-vote details{margin-top:10px}.model-vote summary{cursor:pointer;color:var(--muted);font-size:11px;font-weight:700}.output-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.output-heading>div{display:flex;align-items:center;gap:9px}.output-heading>span{color:var(--muted);font-size:12px}.output-badge{display:inline-grid;width:28px;height:28px;place-items:center;border:1px solid var(--line-strong);border-radius:4px;background:var(--surface);font-weight:850}.artifact-tabs{display:flex;gap:4px;overflow-x:auto;margin-bottom:10px}.artifact-tab{padding:7px 10px;border:1px solid transparent;border-radius:4px;color:var(--muted);background:transparent;cursor:pointer;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}.artifact-tab[aria-selected=true]{border-color:var(--line-strong);color:var(--ink);background:var(--surface)}.artifact-stage{border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);overflow:hidden}.document{min-height:480px}.markdown{width:min(820px,calc(100% - 48px));margin:0 auto;padding:44px 0 60px;color:#202b35;font-family:Charter,"Bitstream Charter",Georgia,serif;font-size:17px;line-height:1.72}.markdown h1,.markdown h2,.markdown h3,.markdown h4,.markdown h5,.markdown h6{color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.3}.markdown h1{font-size:28px}.markdown h2{margin-top:32px;font-size:21px}.markdown h3{margin-top:27px;font-size:16px}.markdown p{margin:0 0 18px}.markdown li{margin:7px 0}.markdown blockquote{margin:25px 0;padding:14px 17px;border-left:3px solid var(--accent);background:#f1f8f6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px}.code{margin:0;padding:22px;overflow:auto;color:#27333d;background:#f8f9fa;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.code.compact{margin-top:8px;padding:12px;font-size:11px}.media-view{display:grid;min-height:520px;padding:24px;place-items:center}.media-view img{max-width:100%;max-height:75vh}.pdf-view{width:100%;height:75vh;border:0}.xlsx{min-height:420px;padding:18px;overflow:auto}.xlsx table{border-collapse:collapse}.xlsx td,.xlsx th{padding:7px 9px;border:1px solid var(--line)}.binary-view,.empty{padding:48px;text-align:center}.binary-view a{color:var(--accent)}.evidence-grid{display:grid;grid-template-columns:1.08fr .92fr;gap:18px}.metric-grid{display:grid;grid-template-columns:1fr 1fr}.metric{padding:17px 16px}.metric+.metric{border-left:1px solid var(--line)}.metric span{display:block;color:var(--muted);font-size:10px;text-transform:uppercase}.metric strong{display:block;margin-top:3px;font-size:16px}.evidence-note{padding:16px;border-top:1px solid var(--line);color:#46545f}.evidence-note>strong{display:block;margin-bottom:6px;color:var(--ink)}.empty-review{padding:60px 0;text-align:center}.empty-review h2{margin-bottom:6px}.empty-review p{color:var(--muted)}@media(max-width:860px){.topbar-inner,main{width:min(100% - 24px,1200px)}.judgment-layout,.evidence-grid{grid-template-columns:1fr}.signals{grid-template-columns:1fr}.signals>div+div{border-top:1px solid var(--line);border-left:0}}@media(max-width:560px){.identity{gap:10px}.review-state span{display:none}.escalation{grid-template-columns:auto 1fr}.gate-state{grid-column:2}.judgment-lead{padding:20px}.judgment-lead h2{font-size:21px}.markdown{width:calc(100% - 30px);padding:28px 0 42px;font-size:16px}}
</style><script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" integrity="sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw" crossorigin="anonymous"></script></head>
<body><header class="topbar"><div class="topbar-inner"><div class="identity"><div><div class="eyebrow">Skill Eval / Human Review</div><h1 id="case-title">${escape(descriptors[0]?.eval_id ?? "No unresolved cases")}</h1><div class="case-meta" id="case-meta">${descriptors[0] ? escape(`${descriptors[0].executor_host} executor / repetition ${descriptors[0].repetition}`) : "Evaluation complete"}</div></div><div class="review-state"><span>${empty ? "No review needed" : "Human judgment needed"}</span></div></div>${empty ? "" : `<nav class="case-tabs" aria-label="Review cases">${caseButtons.join("")}</nav><nav class="view-tabs" aria-label="Review views"><button class="view-tab" data-view="judgment" aria-selected="true">Judgment</button><button class="view-tab" data-view="a" aria-selected="false">Output A</button><button class="view-tab" data-view="b" aria-selected="false">Output B</button><button class="view-tab" data-view="evidence" aria-selected="false">Evidence</button></nav>`}</div></header><main>${empty ? `<section class="empty-review"><h2>No unresolved judge disagreements</h2><p>The anonymous judgments do not currently require human adjudication.</p></section>` : caseShells.join("")}</main>
<script>
const caseTabs=[...document.querySelectorAll('.case-tab')],viewTabs=[...document.querySelectorAll('.view-tab')];let activeCase=caseTabs[0]?.dataset.case,activeView='judgment';
function render(){for(const tab of caseTabs)tab.setAttribute('aria-selected',String(tab.dataset.case===activeCase));for(const shell of document.querySelectorAll('[data-case-shell]'))shell.hidden=shell.dataset.caseShell!==activeCase;for(const tab of viewTabs)tab.setAttribute('aria-selected',String(tab.dataset.view===activeView));const shell=document.querySelector('[data-case-shell="'+activeCase+'"]');if(shell)for(const panel of shell.querySelectorAll('[data-view-panel]'))panel.hidden=panel.dataset.viewPanel!==activeView;const tab=caseTabs.find(item=>item.dataset.case===activeCase);if(tab){document.getElementById('case-title').textContent=tab.dataset.title;document.getElementById('case-meta').textContent=tab.dataset.meta}}
for(const tab of caseTabs)tab.addEventListener('click',()=>{activeCase=tab.dataset.case;activeView='judgment';render();window.scrollTo({top:0,behavior:'smooth'})});for(const tab of viewTabs)tab.addEventListener('click',()=>{activeView=tab.dataset.view;render();window.scrollTo({top:0,behavior:'smooth'})});
for(const tabs of document.querySelectorAll('.artifact-tabs'))for(const tab of tabs.querySelectorAll('.artifact-tab'))tab.addEventListener('click',()=>{const stage=tabs.nextElementSibling;for(const peer of tabs.querySelectorAll('.artifact-tab'))peer.setAttribute('aria-selected',String(peer===tab));for(const panel of stage.querySelectorAll('[data-artifact-panel]'))panel.hidden=panel.dataset.artifactPanel!==tab.dataset.artifact});
for(const node of document.querySelectorAll('.xlsx')){try{if(!window.XLSX)throw new Error('SheetJS unavailable');const bytes=Uint8Array.from(atob(node.dataset.content),c=>c.charCodeAt(0));const book=XLSX.read(bytes,{type:'array'});node.textContent='';for(const name of book.SheetNames){const heading=document.createElement('h3');heading.textContent=name;node.appendChild(heading);const table=document.createElement('div');table.innerHTML=XLSX.utils.sheet_to_html(book.Sheets[name]);node.appendChild(table)}}catch(error){node.textContent='Spreadsheet preview unavailable: '+error.message}}
render();
</script></body></html>`;
  const path = resolve(outputPath ?? join(runDir, "review.html"));
  await writeFile(path, html);
  return { path, cases: descriptors.length, reviews: descriptors };
}
