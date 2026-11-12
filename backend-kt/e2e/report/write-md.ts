// Markdown report writer, following the section order in runbook §8.5.
import type { RunReport, TestResult } from "./model.ts";
import { countOutcomes } from "./model.ts";
import type { RouteInventory } from "./coverage.ts";

/** Plan §9, printed unchanged in every report. */
export const UNPROVABLE_HERE: string[] = [
  "Push delivery to real phones/browsers; FCM; iPhone — needs real services and devices (L69, L97)",
  "The real Anthropic model path — needs an API key and costs money; only a fake provider is used (L92)",
  "Real WebAuthn hardware (security keys, platform authenticators, attestation formats other than the software one's)",
  "Real update install/rollback on a host supervisor, arm64, native image, container packaging",
  "Restoring a Home Assistant backup into the shared instance — restarts HA (L81)",
  "Behaviour with real devices (Zigbee, Z-Wave, Matter) — the demo integration is fake (L54)",
  "Long-clock behaviour that has no knob (§6) — cannot be shortened on both stacks",
  "Production data migration — out of scope: the Kotlin database is fresh by design (PARITY.md §7)",
];

function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
  return `${head}\n${body}`;
}

function capabilityRows(results: TestResult[]): (string | number)[][] {
  const groups = new Map<string, TestResult[]>();
  for (const r of results) {
    // SELFTEST fixtures exist to prove the reporter, not a product capability; one of them must
    // fail by design, so including them would mark "harness self-test" FAILED in every report.
    if (r.area === "SELFTEST") continue;
    const list = groups.get(r.capability) ?? [];
    list.push(r);
    groups.set(r.capability, list);
  }
  return [...groups.entries()].map(([cap, list]) => {
    const outcome = list.some((r) => r.outcome === "FAIL")
      ? "FAILED"
      : list.some((r) => r.outcome === "PASS")
        ? "PROVEN"
        : "UNPROVEN";
    return [cap, list.map((r) => r.id).join(", "), outcome];
  });
}

function coverageSection(inv?: RouteInventory, results: TestResult[] = []): string {
  if (!inv) return "_No route inventory was produced for this run._";
  const covered = (method: string, path: string): string => {
    const hits = results.filter((r) => r.capability.includes(path) || r.capability.includes(`${method} ${path}`));
    return hits.length ? hits.map((r) => r.id).join(", ") : "uncovered";
  };
  const rows = inv.ts.map((r) => [r.method, r.path, r.module, covered(r.method, r.path), "—"]);
  let out = table(["Method", "Path (TS)", "Module", "Covered by", "Error case"], rows);
  out += `\n\n**Routes only on the Kotlin side (additive, listed separately):** ${inv.counts.onlyKt}\n`;
  if (inv.onlyKt.length) out += `\n${table(["Method", "Path (Kotlin only)", "Module"], inv.onlyKt.map((r) => [r.method, r.path, r.module]))}\n`;
  out += `\n**Routes only on the TS side (must be covered):** ${inv.counts.onlyTs}\n`;
  if (inv.onlyTs.length) out += `\n${table(["Method", "Path (TS only)", "Module"], inv.onlyTs.map((r) => [r.method, r.path, r.module]))}\n`;
  out += `\n**WebSocket message types (${inv.counts.ws}):** ${inv.wsTypes.map((w) => `\`${w.type}\``).join(", ") || "none parsed"}\n`;
  return out;
}

export function renderMarkdown(report: RunReport, inventory?: RouteInventory): string {
  const c = countOutcomes(report.results);
  const lines: string[] = [];
  lines.push(`# Alice backend parity report`);
  lines.push(`Run \`${report.runId}\` — started ${report.startedAt}, finished ${report.finishedAt}. Seed ${report.seed}.`);
  lines.push("");

  lines.push(`## 1. Verdict`);
  lines.push(table(["Gate", "Name", "Status", "Note"], report.gates.map((g) => [g.gate, g.name, g.status, g.note])));
  lines.push("");

  lines.push(`## 2. Headline counts`);
  lines.push(
    table(
      ["PASS", "FAIL", "BLOCKED", "FLAKY", "DIFF_ACCEPTED", "NA", "Noise diff"],
      [[c.PASS, c.FAIL, c.BLOCKED, c.FLAKY, c.DIFF_ACCEPTED, c.NA, report.noiseDiffCount]],
    ),
  );
  lines.push("");

  lines.push(`## 3. Failures (grouped by cause)`);
  const failures = report.results.filter((r) => r.outcome === "FAIL");
  if (failures.length === 0) lines.push("_None._");
  else {
    const causes = [...new Set(failures.map((r) => r.cause ?? "unclassified"))];
    for (const cause of causes) {
      lines.push(`### ${cause}`);
      lines.push(
        table(
          ["ID", "Title", "Reason", "Finding", "Evidence"],
          failures.filter((r) => (r.cause ?? "unclassified") === cause).map((r) => [r.id, r.title, r.reason, r.finding ?? "—", r.evidence || "—"]),
        ),
      );
      lines.push("");
    }
  }
  lines.push("");

  lines.push(`## 4. Blocked and unproven`);
  const blocked = report.results.filter((r) => r.outcome === "BLOCKED");
  if (blocked.length === 0) lines.push("_None._");
  else lines.push(table(["ID", "Title", "Cause", "Reason"], blocked.map((r) => [r.id, r.title, r.cause ?? "—", r.reason])));
  lines.push("");

  lines.push(`## 5. Capability table`);
  lines.push(table(["Capability", "Cards", "Result"], capabilityRows(report.results)));
  lines.push("");

  lines.push(`## 6. Route and message coverage matrix`);
  lines.push(coverageSection(inventory, report.results));
  lines.push("");

  lines.push(`## 7. Inventory diff and HA end-state diff`);
  lines.push("### T3.1 Inventory diff");
  if (!report.inventoryDiff) lines.push("_Pending M3 (T3.1)._");
  else if (typeof report.inventoryDiff === "string") lines.push(report.inventoryDiff);
  else lines.push("```json\n" + JSON.stringify(report.inventoryDiff, null, 2) + "\n```");
  lines.push("");
  lines.push("### HA end-state diff");
  lines.push("_Populated by the HA-truth scenarios (M3+)._");
  lines.push("");

  lines.push(`## 8. Accepted differences`);
  if (!report.acceptedDiffs.length) lines.push("_None. `expected-diffs.yaml` starts empty and grows only through user review._");
  else lines.push("```yaml\n" + report.acceptedDiffs.map((d) => JSON.stringify(d)).join("\n") + "\n```");
  lines.push("");

  lines.push(`## 9. Not provable here (plan §9, unchanged)`);
  for (const item of UNPROVABLE_HERE) lines.push(`- ${item}`);
  lines.push("");

  lines.push(`## 10. Environment`);
  lines.push(table(["Key", "Value"], Object.entries(report.environment).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])));
  lines.push("");
  return lines.join("\n");
}
