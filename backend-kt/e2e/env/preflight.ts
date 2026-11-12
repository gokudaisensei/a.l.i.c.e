// Preflight per runbook §5.3. Refuses to start if any prerequisite is missing or a name/port conflicts.
// Prints one PASS/FAIL line per check and writes <run>/baseline.json for the ENV-05 tidy proof.
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { run } from "../lib/proc.ts";
import { makeRunDir } from "../lib/ids.ts";
import {
  BACKEND_DIR,
  BACKEND_KT_DIR,
  CONTAINERS,
  HA_IMAGE,
  HARNESS_PORTS,
  KOTLIN_BIN,
  USER_PORTS,
} from "./constants.ts";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** Parse `ss -ltnH` into a map port -> raw line. */
export function listeningPorts(): Map<number, string> {
  const out = run("ss", ["-ltnH"]);
  const map = new Map<number, string>();
  if (out.code !== 0) return map;
  for (const line of out.stdout.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const local = cols[3]!;
    const port = Number(local.slice(local.lastIndexOf(":") + 1));
    if (Number.isInteger(port)) map.set(port, line.trim());
  }
  return map;
}

function sha256FileOrNull(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

function javaMajor(): number | null {
  const r = run("java", ["-version"]);
  const text = `${r.stderr}\n${r.stdout}`;
  const m = text.match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  // "21.0.13" -> 21 ; "1.8.0" -> 8
  const first = Number(m[1]);
  return first === 1 && m[2] ? Number(m[2]) : first;
}

export interface Baseline {
  capturedAt: string;
  containers: string[];
  userPorts: Record<string, string>;
  envTest: { path: string; exists: boolean; sha256: string | null };
  /**
   * State of the user-owned `backend/data` and `backend-kt/data` trees. The harness must leave
   * them byte-for-byte and mtime-for-mtime untouched (R2); an empty tree still counts as existing.
   */
  dataDirs?: Record<string, DataDirState>;
}

export interface DataDirState {
  path: string;
  exists: boolean;
  /** Newest mtime of the directory or anything below it, in epoch ms (null when absent). */
  newestMtimeMs: number | null;
  /** Relative path, size and mtime of every entry, sorted; proves nothing was added or edited. */
  entries: string[];
}

function dataDirState(path: string): DataDirState {
  if (!existsSync(path)) return { path, exists: false, newestMtimeMs: null, entries: [] };
  const entries: string[] = [];
  let newest = 0;
  const visit = (abs: string, rel: string): void => {
    let st;
    try {
      st = statSync(abs);
    } catch {
      return;
    }
    newest = Math.max(newest, st.mtimeMs);
    if (st.isDirectory()) {
      entries.push(`${rel || "."}/`);
      for (const name of readdirSync(abs).sort()) visit(join(abs, name), rel ? `${rel}/${name}` : name);
    } else {
      entries.push(`${rel} ${st.size} ${Math.round(st.mtimeMs)}`);
    }
  };
  visit(path, "");
  return { path, exists: true, newestMtimeMs: newest, entries };
}

/** Snapshot the user's resources so ENV-05 can prove nothing of theirs changed. */
export function captureBaseline(): Baseline {
  const ps = run("docker", ["ps", "-a", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}"]);
  const containers = ps.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.split("\t")[0]!.startsWith("alice-parity"));

  const ports = listeningPorts();
  const userPorts: Record<string, string> = {};
  for (const p of USER_PORTS) userPorts[String(p)] = ports.get(p) ?? "free";

  const envPath = join(BACKEND_DIR, ".env.test");
  return {
    capturedAt: new Date().toISOString(),
    containers,
    userPorts,
    envTest: { path: envPath, exists: existsSync(envPath), sha256: sha256FileOrNull(envPath) },
    dataDirs: {
      backend: dataDirState(join(BACKEND_DIR, "data")),
      "backend-kt": dataDirState(join(BACKEND_KT_DIR, "data")),
    },
  };
}

export interface PreflightOptions {
  runDir: string;
  /** Allow containers named alice-parity-* to already exist (a resumed run owns them). */
  allowExisting?: boolean;
}

/** Container identity that must not change: name + image (status is expected to drift). */
function containerKey(line: string): string {
  return line.split("\t").slice(0, 2).join("\t");
}

export interface BaselineComparison {
  ok: boolean;
  addedContainers: string[];
  removedContainers: string[];
  portDiffs: Record<string, { before: string; now: string }>;
  envTestSame: boolean;
  dataDirDiffs: Record<string, { before: DataDirState | null; now: DataDirState; note?: string }>;
}

/** Compare two baselines the way ENV-05 requires: names+images, user ports, .env.test hash, data dirs. */
export function compareBaselines(before: Baseline, now: Baseline): BaselineComparison {
  const beforeSet = new Set(before.containers.map(containerKey));
  const nowSet = new Set(now.containers.map(containerKey));
  const addedContainers = [...nowSet].filter((x) => !beforeSet.has(x)).sort();
  const removedContainers = [...beforeSet].filter((x) => !nowSet.has(x)).sort();

  const portDiffs: Record<string, { before: string; now: string }> = {};
  for (const [port, holder] of Object.entries(before.userPorts)) {
    const current = now.userPorts[port] ?? "<missing>";
    if (current !== holder) portDiffs[port] = { before: holder, now: current };
  }

  const envTestSame = before.envTest.exists === now.envTest.exists && before.envTest.sha256 === now.envTest.sha256;

  const dataDirDiffs: BaselineComparison["dataDirDiffs"] = {};
  const beforeCapturedAt = Date.parse(before.capturedAt);
  for (const [key, after] of Object.entries(now.dataDirs ?? {})) {
    const prior = before.dataDirs?.[key];
    if (prior) {
      const same = prior.exists === after.exists && prior.entries.join("\n") === after.entries.join("\n");
      if (!same) dataDirDiffs[key] = { before: prior, now: after };
    } else if (after.exists && after.newestMtimeMs !== null && after.newestMtimeMs > beforeCapturedAt) {
      // The run's baseline predates data-dir tracking: a tree newer than the baseline could have
      // been written by this run, so it must be reported rather than assumed old.
      dataDirDiffs[key] = {
        before: null,
        now: after,
        note: "tracked after the baseline was captured; newest mtime is later than baseline.capturedAt",
      };
    }
  }

  return {
    ok:
      addedContainers.length === 0 &&
      removedContainers.length === 0 &&
      Object.keys(portDiffs).length === 0 &&
      envTestSame &&
      Object.keys(dataDirDiffs).length === 0,
    addedContainers,
    removedContainers,
    portDiffs,
    envTestSame,
    dataDirDiffs,
  };
}

export function runPreflight(opts: PreflightOptions): { ok: boolean; checks: Check[]; baseline: Baseline } {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // 1. Docker CLI and daemon.
  const dv = run("docker", ["--version"]);
  add("docker CLI", dv.code === 0, (dv.stdout || dv.stderr).trim() || String(dv.error));
  const di = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  add("docker daemon", di.code === 0, (di.stdout || di.stderr).trim());

  // 2. Pinned HA image present locally (no pull).
  const img = run("docker", ["image", "inspect", HA_IMAGE, "--format", "{{.Id}}"]);
  add(
    "HA image present",
    img.code === 0,
    img.code === 0 ? HA_IMAGE : `missing ${HA_IMAGE}: ${img.stderr.trim()} (ask the user; do not pull)`,
  );

  // 3. No parity container already running unless this run owns it.
  const ps = run("docker", ["ps", "-a", "--filter", "name=alice-parity-", "--format", "{{.Names}}"]);
  const existing = ps.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const ownershipOk = existing.length === 0 || Boolean(opts.allowExisting);
  add(
    "parity names free",
    ownershipOk,
    existing.length === 0
      ? "none"
      : ownershipOk
        ? `owned by this run: ${existing.join(", ")}`
        : `conflict: ${existing.join(", ")} (run env/down.ts first)`,
  );

  // 4. All harness ports free.
  const ports = listeningPorts();
  const taken = HARNESS_PORTS.filter((p) => ports.has(p));
  add(
    "harness ports free",
    taken.length === 0,
    taken.length === 0
      ? HARNESS_PORTS.join(", ") + " free"
      : taken.map((p) => `${p} held by: ${ports.get(p)}`).join("; "),
  );

  // 5. Toolchain versions.
  const jm = javaMajor();
  add("java 21", jm === 21, jm === null ? "java not found" : `major ${jm}`);
  const bun = run("bun", ["--version"]);
  add("bun present", bun.code === 0, (bun.stdout || bun.stderr).trim());

  // 6. Kotlin distributions built.
  const serverBin = existsSync(KOTLIN_BIN.server);
  const workerBin = existsSync(KOTLIN_BIN.worker);
  add(
    "kotlin installDist",
    serverBin && workerBin,
    serverBin && workerBin
      ? "server + worker present"
      : `missing: ${!serverBin ? KOTLIN_BIN.server : ""} ${!workerBin ? KOTLIN_BIN.worker : ""}`.trim() +
        " (run T0.7)",
  );

  // 7. Baseline for ENV-05.
  const baseline = captureBaseline();
  mkdirSync(opts.runDir, { recursive: true });
  writeFileSync(join(opts.runDir, "baseline.json"), JSON.stringify(baseline, null, 2));
  add("baseline captured", true, join(opts.runDir, "baseline.json"));

  return { ok: checks.every((c) => c.ok), checks, baseline };
}

function parseArgs(argv: string[]): { runDir?: string; allowExisting: boolean; help: boolean } {
  let runDir: string | undefined;
  let allowExisting = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run-dir") runDir = argv[++i];
    else if (a === "--allow-existing") allowExisting = true;
    else if (a === "--help" || a === "-h") help = true;
  }
  return { runDir, allowExisting, help };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("usage: bun env/preflight.ts [--run-dir <path>] [--allow-existing]");
    process.exit(0);
  }
  let runDir = args.runDir;
  if (!runDir) runDir = makeRunDir().dir;
  const { ok, checks, baseline } = runPreflight({ runDir, allowExisting: args.allowExisting });
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(22)} ${c.detail}`);
  console.log(`\nbaseline: ${join(runDir, "baseline.json")} (containers=${baseline.containers.length})`);
  console.log(ok ? "\nPREFLIGHT: PASS" : "\nPREFLIGHT: FAIL");
  process.exit(ok ? 0 : 1);
}
