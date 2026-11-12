// T3.1 inventory diff: compare every Thing from `GET /devices?include=diagnostics` on both stacks.
// Both stacks sync the same throwaway HA-A, so any field difference is a real backend difference.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { HttpClient } from "../lib/http.ts";
import { Recorder } from "../lib/record.ts";
import { makeRunDir } from "../lib/ids.ts";
import { diff } from "../lib/diff.ts";
import type { Side, World } from "../lib/scenario.ts";
import { BACKEND_URL } from "../env/constants.ts";
import { prepareWorlds } from "./scenario-support.ts";

export interface InventoryDiff {
  tsCount: number;
  ktCount: number;
  compared: number;
  differing: number;
  onlyTs: string[];
  onlyKt: string[];
  rows: { key: string; name: string; fields: string[] }[];
  detail: unknown;
  markdown: string;
}

function keyOf(t: any): string {
  return String(t?.primary?.entityId ?? t?.id ?? t?.name ?? "<unknown>");
}

/** Identity/live-state fields are not inventory: each backend mints its own ids and the two
 *  samples are taken a moment apart. T3.1 compares names, areas, kinds, capabilities, facets,
 *  controls and sensors, as the runbook specifies. */
const VOLATILE = new Set(["id", "hubThingId", "availability", "values", "available", "settings", "favorite", "lastChanged", "lastUpdated"]);

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !VOLATILE.has(k))
      .map(([k, v]) => [k, stripVolatile(v)]),
  );
}

/** Compare the two inventory views field by field and keep only the paths that differ. */
function differingFields(ts: any, kt: any): string[] {
  const d = diff(stripVolatile(ts), stripVolatile(kt), { normalized: false });
  return [...new Set(d.differences.map((x) => x.path.replace(/^\$\.?/, "")))];
}

export async function runInventoryDiff(runDir: string): Promise<InventoryDiff> {
  const ctx = makeRunDir(runDir);
  const recorder = new Recorder(join(runDir, "evidence", "E2E-INV-01"));
  const ts: Side = {
    backend: "ts",
    runDir,
    baseUrl: BACKEND_URL.ts,
    origin: "http://localhost:3101",
    setupCode: ctx.setupCode,
    http: new HttpClient(BACKEND_URL.ts, "ts", recorder),
    recorder,
    exchanges: [],
    world: { kind: "fresh", actors: {} },
  };
  const kt: Side = {
    backend: "kt",
    runDir,
    baseUrl: BACKEND_URL.kt,
    origin: "http://localhost:3102",
    setupCode: ctx.setupCode,
    http: new HttpClient(BACKEND_URL.kt, "kt", recorder),
    exchanges: [],
    world: { kind: "fresh", actors: {} },
  };

  let worlds: { ts: World; kt: World };
  try {
    worlds = await prepareWorlds(ctx, "ha", { ts, kt });
  } catch (e) {
    throw new Error(`inventory diff could not build the HA world: ${e instanceof Error ? e.message : String(e)}`);
  }
  const tsAdmin = worlds.ts.actors.admin;
  const ktAdmin = worlds.kt.actors.admin;
  if (!tsAdmin || !ktAdmin) throw new Error("inventory diff has no admin actor");

  const tsRes = await tsAdmin.call("inventory.ts", "GET", "/api/v1/devices?include=diagnostics");
  const ktRes = await ktAdmin.call("inventory.kt", "GET", "/api/v1/devices?include=diagnostics");
  const tsDevices = ((tsRes.body as any)?.devices ?? []) as any[];
  const ktDevices = ((ktRes.body as any)?.devices ?? []) as any[];

  const tsByKey = new Map(tsDevices.map((d) => [keyOf(d), d]));
  const ktByKey = new Map(ktDevices.map((d) => [keyOf(d), d]));
  const allKeys = [...new Set([...tsByKey.keys(), ...ktByKey.keys()])].sort();

  const rows: { key: string; name: string; fields: string[] }[] = [];
  const detail: Record<string, unknown> = {};
  const onlyTs: string[] = [];
  const onlyKt: string[] = [];
  let compared = 0;
  let differing = 0;

  for (const key of allKeys) {
    const a = tsByKey.get(key);
    const b = ktByKey.get(key);
    if (!a) {
      onlyKt.push(key);
      rows.push({ key, name: String(b?.name ?? ""), fields: ["<only on Kotlin>"] });
      continue;
    }
    if (!b) {
      onlyTs.push(key);
      rows.push({ key, name: String(a.name ?? ""), fields: ["<only on TS>"] });
      continue;
    }
    compared++;
    const fields = differingFields(a, b);
    if (fields.length) {
      differing++;
      detail[key] = { ts: a, kt: b, diff: diff(a, b, { normalized: false }).differences };
      rows.push({ key, name: String(a.name ?? b.name ?? ""), fields });
    } else {
      rows.push({ key, name: String(a.name ?? ""), fields: [] });
    }
  }

  const markdown = [
    "# T3.1 inventory diff — `GET /api/v1/devices?include=diagnostics`",
    "",
    `TS Things: **${tsDevices.length}** · Kotlin Things: **${ktDevices.length}** · compared: **${compared}** · differing: **${differing}** · only-TS: **${onlyTs.length}** · only-Kotlin: **${onlyKt.length}**`,
    "",
    "| Thing (primary entity) | Name | Differing fields |",
    "| --- | --- | --- |",
    ...rows.map((r) => `| \`${r.key}\` | ${r.name.replace(/\|/g, "\\|")} | ${r.fields.length ? r.fields.join(", ") : "—"} |`),
    "",
  ].join("\n");

  const out: InventoryDiff = { tsCount: tsDevices.length, ktCount: ktDevices.length, compared, differing, onlyTs, onlyKt, rows, detail, markdown };
  writeFileSync(join(runDir, "inventory-diff.json"), JSON.stringify(out, null, 2) + "\n");
  writeFileSync(join(runDir, "inventory-diff.md"), markdown);
  return out;
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: bun suites/inventory-diff.ts <run-dir>");
    process.exit(1);
  }
  runInventoryDiff(dir)
    .then((r) => {
      console.log(r.markdown);
      console.log(`wrote ${join(dir, "inventory-diff.json")} and ${join(dir, "inventory-diff.md")}`);
    })
    .catch((e) => {
      console.error(`INVENTORY DIFF FAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      process.exit(1);
    });
}
