#!/usr/bin/env bun
/**
 * Entry point for the parity harness (RUNBOOK §5.5).
 *   bun e2e/run.ts --suite <all|capability|differential|noise|realtime|worker|resilience|slow|soak|self-test|env>
 *                  [--only E2E-CMD-03,E2E-AUTH-*] [--area AUTH] [--keep-env] [--no-ts-noise] [--run-dir <path>]
 *
 * M0/M1 wire the framework and the ENV self-checks; M2+ add scenario suites. Anything not yet
 * implemented is reported BLOCKED with a reason, never silently skipped.
 */
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeRunDir, expandCardFilter, matchesCardFilter } from "./lib/ids.ts";
import { run as sh } from "./lib/proc.ts";
import { E2E_DIR } from "./env/constants.ts";
import { buildRouteInventory, writeRouteInventory, type RouteInventory } from "./report/coverage.ts";
import { renderMarkdown } from "./report/write-md.ts";
import { renderHtml } from "./report/write-html.ts";
import { makeResult, type GateResult, type RunReport, type TestResult } from "./report/model.ts";

export interface CliArgs {
  suite: string;
  only: string | null;
  area: string | null;
  keepEnv: boolean;
  noTsNoise: boolean;
  runDir: string | null;
  help: boolean;
}

const USAGE = `usage: bun e2e/run.ts [options]
  --suite <name>      all|capability|differential|noise|realtime|worker|resilience|slow|soak|self-test|env
  --only <ids>        comma-separated card ids; E2E-AUTH-* wildcards allowed
  --area <AREA>       run one area (AUTH, HH, X, HA, DEV, FAV, CMD, WS, NOTE, HIST, AUT, AI, ADM, CH, ENV)
  --keep-env          do not tear down the parity environment after the run
  --no-ts-noise       skip the TS-vs-TS noise run
  --run-dir <path>    use this run directory instead of a fresh timestamp
  --help              show this help`;

export function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = { suite: "all", only: null, area: null, keepEnv: false, noTsNoise: false, runDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    switch (v) {
      case "--help":
      case "-h":
        a.help = true;
        break;
      case "--suite":
        a.suite = argv[++i]!;
        break;
      case "--only":
        a.only = argv[++i]!;
        break;
      case "--area":
        a.area = argv[++i]!;
        break;
      case "--keep-env":
        a.keepEnv = true;
        break;
      case "--no-ts-noise":
        a.noTsNoise = true;
        break;
      case "--run-dir":
        a.runDir = argv[++i]!;
        break;
      default:
        throw new Error(`unknown argument: ${v}\n${USAGE}`);
    }
  }
  return a;
}

export function environmentInfo(runDir: string): Record<string, unknown> {
  const bun = sh("bun", ["--version"]);
  const java = sh("java", ["-version"]);
  const docker = sh("docker", ["--version"]);
  return {
    runDir,
    bun: bun.stdout.trim(),
    java: (java.stderr || java.stdout).split("\n")[0]?.trim() ?? "",
    docker: docker.stdout.trim(),
    haImage: "ghcr.io/home-assistant/home-assistant:2026.10.4",
    platform: `${process.platform}-${process.arch}`,
  };
}

export function gatesFor(results: TestResult[]): GateResult[] {
  const env = results.filter((r) => r.area === "ENV");
  const envPassed = env.length >= 5 && env.filter((r) => r.outcome === "PASS").length >= env.length;
  const honesty = results
    .filter((r) => r.outcome === "BLOCKED" || r.outcome === "NA")
    .every((r) => r.reason.trim().length > 0);
  const differential = results.filter((r) => r.kind === "differential");
  const capability = results.filter((r) => r.kind === "capability");
  const acceptable = (r: TestResult) => r.outcome === "PASS" || r.outcome === "DIFF_ACCEPTED";
  const diffOk = differential.length > 0 && differential.every(acceptable);
  const capOk = capability.length > 0 && capability.every(acceptable);
  const sec = results.filter((r) => r.oracles.includes("SEC") && r.kind);
  const secOk = sec.length > 0 && sec.every(acceptable);
  return [
    { gate: "G1", name: "Environment", status: env.length ? (envPassed ? "MET" : "UNPROVEN") : "UNPROVEN", note: env.length ? `${env.filter((r) => r.outcome === "PASS").length}/${env.length} ENV checks passed` : "no ENV checks in this run" },
    { gate: "G2", name: "Route coverage", status: "UNPROVEN", note: "evaluated in M9 from the coverage matrix" },
    { gate: "G3", name: "Contract", status: differential.length ? (diffOk ? "MET" : "NOT MET") : "UNPROVEN", note: differential.length ? `${differential.filter(acceptable).length}/${differential.length} differential cards identical or accepted` : "no differential cards in this run" },
    { gate: "G4", name: "Truth", status: "UNPROVEN", note: "HA-truth scenarios land in M3+" },
    { gate: "G5", name: "Security", status: sec.length ? (secOk ? "MET" : "NOT MET") : "UNPROVEN", note: sec.length ? `${sec.filter(acceptable).length}/${sec.length} SEC-oracle cards passed in this run` : "no SEC-oracle cards in this run" },
    { gate: "G6", name: "Capabilities", status: capability.length ? (capOk ? "MET" : "NOT MET") : "UNPROVEN", note: capability.length ? `${capability.filter(acceptable).length}/${capability.length} capability cards passed` : "no capability cards in this run" },
    { gate: "G7", name: "Resilience", status: "UNPROVEN", note: "chaos suite lands in M8" },
    { gate: "G8", name: "Honesty", status: honesty ? "MET" : "NOT MET", note: honesty ? "every BLOCKED/NA has a reason" : "a BLOCKED/NA item has no reason" },
  ];
}


export function attachFindings(results: TestResult[]): void {
  const findingsPath = join(E2E_DIR, "FINDINGS.md");
  if (!existsSync(findingsPath)) return;
  const text = readFileSync(findingsPath, "utf8");
  const blocks = text.split(/\n(?=## F-\d+)/g);
  const map = new Map<string, string>();
  for (const block of blocks) {
    const m = block.match(/^## (F-\d+)/);
    if (!m) continue;
    const fid = m[1];
    for (const id of block.match(/E2E-[A-Z0-9-]+/g) ?? []) {
      if (!map.has(id)) map.set(id, fid);
    }
  }
  for (const r of results) {
    // Only a failure needs an explanation; a PASS that shares a card id with a finding stays clean.
    if (r.outcome !== "FAIL" && r.outcome !== "BLOCKED") continue;
    if (!r.finding) {
      const fid = map.get(r.id);
      if (fid) r.finding = fid;
    }
  }
}

function coverageMarkdown(inv: RouteInventory): string {
  const rows = (list: { method: string; path: string; module: string }[]) =>
    list.map((r) => `| ${r.method} | ${r.path} | ${r.module} |`).join("\n");
  return `# Route and message coverage\n\nGenerated ${inv.generatedAt}.\n\n` +
    `TS routes: ${inv.counts.ts} · Kotlin routes: ${inv.counts.kt} · WS message types: ${inv.counts.ws} · only-TS: ${inv.counts.onlyTs} · only-Kotlin: ${inv.counts.onlyKt}\n\n` +
    `## TS routes\n\n| Method | Path | Module |\n|---|---|---|\n${rows(inv.ts)}\n\n` +
    `## Only on the Kotlin side\n\n| Method | Path | Module |\n|---|---|---|\n${rows(inv.onlyKt) || "| — | — | — |"}\n\n` +
    `## Only on the TS side (must be covered)\n\n| Method | Path | Module |\n|---|---|---|\n${rows(inv.onlyTs) || "| — | — | — |"}\n\n` +
    `## WebSocket message types\n\n${inv.wsTypes.map((w) => `- \`${w.type}\``).join("\n") || "_none parsed_"}\n`;
}

async function resultsForSuite(args: CliArgs, runDir: string): Promise<TestResult[]> {
  if (args.suite === "self-test") return (await import("./suites/self-test.ts")).runSelfTest();
  if (args.suite === "env") return (await import("./suites/env.ts")).runEnvSuite(runDir);
  const only = args.only ? expandCardFilter([args.only]) : null;
  const filter = { area: args.area, only };
  if (args.suite === "capability") return (await import("./suites/capability.ts")).runCapabilitySuite(runDir, filter);
  if (args.suite === "differential") return (await import("./suites/differential.ts")).runDifferentialSuite(runDir, filter);
  if (args.suite === "noise") return (await import("./suites/noise.ts")).runNoiseSuite(runDir, filter);
  if (args.suite === "all") {
    const capability = await (await import("./suites/capability.ts")).runCapabilitySuite(runDir, filter);
    const differential = await (await import("./suites/differential.ts")).runDifferentialSuite(runDir, filter);
    return [...capability, ...differential];
  }
  // Suites not implemented yet (M3+). Report a single honest BLOCKED item.
  return [
    makeResult({
      id: `E2E-SUITE-${args.suite.toUpperCase()}`,
      area: args.suite.toUpperCase(),
      title: `Suite ${args.suite}`,
      capability: `suite ${args.suite}`,
      oracles: ["SPEC"],
      outcome: "BLOCKED",
      cause: "unprovable_here",
      reason: `the ${args.suite} scenario suite is not implemented yet (M3+); capability/differential/env/self-test exist`,
    }),
  ];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const startedAt = new Date().toISOString();
  const ctx = makeRunDir(args.runDir ?? undefined);
  const runDir = ctx.dir;

  const inventoryPath = join(E2E_DIR, "route-inventory.json");
  const inventory = writeRouteInventory(inventoryPath);
  const invCopy = join(runDir, "route-inventory.json");
  writeFileSync(invCopy, JSON.stringify(inventory, null, 2) + "\n");

  const allResults = await resultsForSuite(args, runDir);
  const patterns = args.only ? expandCardFilter([args.only]) : null;
  const results = patterns ? allResults.filter((r) => matchesCardFilter(r.id, patterns)) : allResults;
  if (patterns && results.length === 0) {
    console.error(`--only ${args.only} matched no results (${allResults.length} ran)`);
    process.exit(1);
  }
  attachFindings(results);
  const finishedAt = new Date().toISOString();

  const report: RunReport = {
    runId: runDir.split("/").pop() ?? runDir,
    startedAt,
    finishedAt,
    seed: ctx.seed,
    results,
    gates: gatesFor(results),
    noiseDiffCount: args.suite === "noise" ? results.filter((r) => r.outcome === "FAIL").length : 0,
    environment: environmentInfo(runDir),
    acceptedDiffs: [],
  };

  writeFileSync(join(runDir, "results.json"), JSON.stringify(results, null, 2) + "\n");
  writeFileSync(join(runDir, "report.md"), renderMarkdown(report, inventory));
  writeFileSync(join(runDir, "report.html"), renderHtml(report));
  writeFileSync(join(runDir, "coverage.md"), coverageMarkdown(inventory));
  writeFileSync(
    join(runDir, "harness.log"),
    `started ${startedAt}\nfinished ${finishedAt}\nsuite ${args.suite}\nresults ${results.length}\n`,
  );

  const counts = results.reduce<Record<string, number>>((acc, r) => ((acc[r.outcome] = (acc[r.outcome] ?? 0) + 1), acc), {});
  console.log(`report: ${join(runDir, "report.md")}`);
  console.log(`outcomes: ${JSON.stringify(counts)}`);
  console.log(
    `inventory: TS ${inventory.counts.ts}, Kotlin ${inventory.counts.kt}, WS ${inventory.counts.ws} ` +
      `(only-TS ${inventory.counts.onlyTs}, only-Kotlin ${inventory.counts.onlyKt})`,
  );

  if (args.suite === "self-test") {
    const have = new Set(results.map((r) => r.outcome));
    const ok = ["PASS", "FAIL", "BLOCKED", "FLAKY", "NA", "DIFF_ACCEPTED"].every((o) => have.has(o as any));
    process.exit(ok ? 0 : 1);
  }
  // SELFTEST fixtures deliberately include a FAIL and a BLOCKED; they must not decide the exit code.
  const judged = results.filter((r) => r.area !== "SELFTEST");
  if (judged.some((r) => r.outcome === "FAIL")) process.exit(1);
  if (judged.some((r) => r.outcome === "BLOCKED")) process.exit(2);
  process.exit(0);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`RUN FAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    process.exit(1);
  });
}
