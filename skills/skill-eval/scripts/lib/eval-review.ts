import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { validateSuite } from "./suite.ts";

function escape(value: string): string {
  return value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!);
}

export async function generateEvalReview(suitePathInput: string, outputPath?: string): Promise<{ path: string }> {
  const suitePath = resolve(suitePathInput);
  const suite = validateSuite(JSON.parse(await readFile(suitePath, "utf8")));
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Evaluation Suite Review</title><style>body{font:15px system-ui;max-width:1000px;margin:32px auto;padding:0 20px}textarea{box-sizing:border-box;width:100%;height:70vh;font:13px ui-monospace,monospace;line-height:1.4}button{margin-top:12px;padding:8px 12px}.error{color:#b91c1c}</style></head><body><h1>Review frozen evaluation suite</h1><p>Check case purpose, severity, expectations, fixture references, trigger labels, and holdout coverage before freezing.</p><textarea id="suite">${escape(JSON.stringify(suite, null, 2))}</textarea><div id="error" class="error"></div><button id="export">Export suite</button><script>document.getElementById('export').addEventListener('click',()=>{try{const value=JSON.parse(document.getElementById('suite').value);document.getElementById('error').textContent='';const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='suite.json';a.click();URL.revokeObjectURL(a.href)}catch(error){document.getElementById('error').textContent=error.message}});</script></body></html>`;
  const path = resolve(outputPath ?? join(dirname(suitePath), "suite-review.html")); await writeFile(path, html);
  return { path };
}
