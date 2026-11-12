// Standalone HTML report (runbook §7.3). Kept dependency-free and readable.
import type { RunReport } from "./model.ts";
import { countOutcomes } from "./model.ts";
import { renderMarkdown } from "./write-md.ts";

function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rows(headers: string[], data: (string | number)[][]): string {
  return (
    `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
    data.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") +
    `</tbody></table>`
  );
}

export function renderHtml(report: RunReport): string {
  const c = countOutcomes(report.results);
  const verdict = rows(
    ["Gate", "Name", "Status", "Note"],
    report.gates.map((g) => [g.gate, g.name, g.status, g.note]),
  );
  const counts = rows(
    ["PASS", "FAIL", "BLOCKED", "FLAKY", "DIFF_ACCEPTED", "NA", "Noise diff"],
    [[c.PASS, c.FAIL, c.BLOCKED, c.FLAKY, c.DIFF_ACCEPTED, c.NA, report.noiseDiffCount]],
  );
  const results = rows(
    ["ID", "Title", "Outcome", "Cause", "Reason", "Evidence"],
    report.results.map((r) => [r.id, r.title, r.outcome, r.cause ?? "—", r.reason, r.evidence || "—"]),
  );
  const md = renderMarkdown(report);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Alice parity report ${esc(report.runId)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:2rem;max-width:1200px;color:#1b1b1b}
h1{font-size:1.6rem}h2{margin-top:2rem;border-bottom:1px solid #ddd;padding-bottom:.25rem}
table{border-collapse:collapse;margin:.5rem 0 1rem;width:100%}
th,td{border:1px solid #ccc;padding:.3rem .5rem;text-align:left;vertical-align:top}
th{background:#f4f4f4}code{background:#f4f4f4;padding:0 .2rem}
pre{background:#f7f7f7;padding:1rem;overflow:auto}
</style></head><body>
<h1>Alice backend parity report</h1>
<p>Run <code>${esc(report.runId)}</code> — ${esc(report.startedAt)} → ${esc(report.finishedAt)}. Seed ${report.seed}.</p>
<h2>Verdict</h2>${verdict}
<h2>Counts</h2>${counts}
<h2>Results</h2>${results}
<h2>Full report</h2><pre>${esc(md)}</pre>
</body></html>`;
}
