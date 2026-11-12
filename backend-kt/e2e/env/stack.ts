// Start/stop the TS and Kotlin servers + config-workers for a run. Runbook §5.4 / T0.8.
// Kotlin processes run with cwd <run>/kt so BACKUP_DIR-less backups never land in backend-kt/data (F-002).
import { spawn } from "node:child_process";
import { openSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { run, waitFor } from "../lib/proc.ts";
import { makeRunDir, type RunContext } from "../lib/ids.ts";
import { pemEnvToPem } from "./common.ts";
import { BACKEND_DIR, BACKEND_URL, KOTLIN_BIN, PORTS, RUNS_DIR } from "./constants.ts";

export type Backend = "ts" | "kt" | "both" | "ts2";

export type Keys = Record<string, string>;

const KEY_NAMES = [
  "ADMIN_SEAL_PUBLIC_KEY",
  "SECRETS_KEY",
  "BACKUP_ENCRYPTION_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "ADMIN_SEAL_PRIVATE_KEY",
  "UPDATE_SIGNING_PUBLIC_KEY",
  "UPDATE_SIGNING_PRIVATE_KEY",
] as const;

/** Generate a fresh key set once per run and cache it in <run>/keys.env. */
export function generateKeys(runDir: string): Keys {
  const file = join(runDir, "keys.env");
  if (existsSync(file)) return parseEnvFile(readFileSync(file, "utf8"));
  const res = run("bun", [join(BACKEND_DIR, "scripts", "generate-keys.ts")], {
    cwd: BACKEND_DIR,
    timeoutMs: 120_000,
  });
  if (res.code !== 0) throw new Error(`key generation failed:\n${res.stdout}\n${res.stderr}`);
  const keys: Keys = {};
  for (const line of res.stdout.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    keys[t.slice(0, eq)] = t.slice(eq + 1);
  }
  const missing = KEY_NAMES.filter((k) => !keys[k]);
  if (missing.length) throw new Error(`key generator did not print: ${missing.join(", ")}`);
  writeFileSync(file, KEY_NAMES.map((k) => `${k}=${keys[k]}`).join("\n") + "\n");
  return keys;
}

export function parseEnvFile(text: string): Keys {
  const out: Keys = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return out;
}

export function loadKeys(runDir: string): Keys {
  const file = join(runDir, "keys.env");
  if (!existsSync(file)) return generateKeys(runDir);
  return parseEnvFile(readFileSync(file, "utf8"));
}

function cleanEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  // Start from the launcher's own environment (PATH, HOME, …) then apply the run's overrides.
  // A child started with only the overrides cannot even find `bun`/`java`.
  const out: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

export interface StackPaths {
  tsDir: string;
  ktDir: string;
  ts2Dir: string;
  logsDir: string;
  pidsDir: string;
}

export function stackPaths(runDir: string): StackPaths {
  return {
    tsDir: join(runDir, "ts"),
    ktDir: join(runDir, "kt"),
    ts2Dir: join(runDir, "ts2"),
    logsDir: join(runDir, "logs"),
    pidsDir: join(runDir, "pids"),
  };
}

interface PidRecord {
  name: string;
  pid: number;
  cmd: string;
  cwd: string;
  startedAt: string;
}

function pidFile(runDir: string): string {
  return join(runDir, "pids.json");
}

function readPids(runDir: string): PidRecord[] {
  const f = pidFile(runDir);
  if (!existsSync(f)) return [];
  return JSON.parse(readFileSync(f, "utf8")) as PidRecord[];
}

function writePids(runDir: string, records: PidRecord[]): void {
  writeFileSync(pidFile(runDir), JSON.stringify(records, null, 2));
}

// One parity stack pair owns ports 3101/3102 at a time, but runs live in different directories
// (`.runs/<stamp>` or an explicit `--run-dir`). A run-dir-local PID file cannot see the previous
// run's processes, so a second run would silently compare against a stale server on the old setup
// code. The registry records every process this harness ever started, whichever run dir it is in.
function registryFile(): string {
  mkdirSync(RUNS_DIR, { recursive: true });
  return join(RUNS_DIR, "stack-registry.json");
}

interface RegistryRecord extends PidRecord {
  runDir: string;
}

function readRegistry(): RegistryRecord[] {
  const f = registryFile();
  if (!existsSync(f)) return [];
  try {
    return JSON.parse(readFileSync(f, "utf8")) as RegistryRecord[];
  } catch {
    return [];
  }
}

function alivePid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeRegistry(records: RegistryRecord[]): void {
  writeFileSync(registryFile(), JSON.stringify(records.filter((r) => alivePid(r.pid)), null, 2));
}

/** True when something already accepts connections on 127.0.0.1:port (not necessarily ours). */
async function portInUse(port: number): Promise<boolean> {
  try {
    const socket = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {}, open() {}, close() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

/** Stop a harness process recorded by an earlier run before the port can be reused. */
async function freePort(port: number, name: string): Promise<void> {
  if (!(await portInUse(port))) return;
  const mine = readRegistry().filter((r) => alivePid(r.pid) && (r.name === name || r.cmd.includes(String(port)) || r.name.startsWith(name.split("-")[0]!)));
  for (const rec of mine) await stopPid(rec.name, rec.pid);
  writeRegistry(readRegistry());
  if (await portInUse(port)) {
    throw new Error(`port ${port} is already in use by a process this harness did not start; refusing to run against it`);
  }
}

function startProcess(
  runDir: string,
  name: string,
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): number {
  const paths = stackPaths(runDir);
  mkdirSync(paths.logsDir, { recursive: true });
  mkdirSync(paths.pidsDir, { recursive: true });
  const log = join(paths.logsDir, `${name}.log`);
  writeFileSync(log, "");
  const fd = openSync(log, "a");
  const child = spawn(cmd, args, {
    cwd,
    env: cleanEnv(env),
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  if (!child.pid) throw new Error(`could not start ${name}`);
  child.unref();
  writeFileSync(join(paths.pidsDir, `${name}.pid`), String(child.pid));
  const records = readPids(runDir).filter((r) => r.name !== name);
  records.push({ name, pid: child.pid, cmd: [cmd, ...args].join(" "), cwd, startedAt: new Date().toISOString() });
  writePids(runDir, records);
  const reg = readRegistry().filter((r) => alivePid(r.pid) && r.name !== name);
  reg.push({ name, pid: child.pid, cmd: [cmd, ...args].join(" "), cwd, startedAt: new Date().toISOString(), runDir });
  writeRegistry(reg);
  console.log(`started ${name} pid=${child.pid} cwd=${cwd}`);
  return child.pid;
}

async function waitHealth(url: string, label: string, timeoutMs = 60_000): Promise<void> {
  await waitFor(
    async () => {
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
        return r.status === 200;
      } catch {
        return false;
      }
    },
    timeoutMs,
    500,
    `${label} /health`,
  );
  console.log(`${label} /health ok`);
}

function commonEnv(ctx: RunContext, keys: Keys): Record<string, string | undefined> {
  return {
    SETUP_CODE: ctx.setupCode,
    SECRETS_KEY: keys.SECRETS_KEY,
    ADMIN_SEAL_PUBLIC_KEY: keys.ADMIN_SEAL_PUBLIC_KEY,
    BACKUP_ENCRYPTION_KEY: keys.BACKUP_ENCRYPTION_KEY,
    VAPID_PUBLIC_KEY: keys.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: keys.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: "mailto:e2e@example.com",
    UPDATE_MANIFEST_URL: `http://127.0.0.1:${PORTS.fakeManifest}/manifest.json`,
    UPDATE_SIGNING_PUBLIC_KEY: keys.UPDATE_SIGNING_PUBLIC_KEY,
  };
}

/** Start one backend's server + worker. */
export async function startBackend(ctx: RunContext, backend: "ts" | "kt" | "ts2"): Promise<void> {
  const keys = loadKeys(ctx.dir);
  const paths = stackPaths(ctx.dir);
  mkdirSync(paths.tsDir, { recursive: true });
  mkdirSync(paths.ktDir, { recursive: true });
  mkdirSync(paths.ts2Dir, { recursive: true });
  const base = commonEnv(ctx, keys);
  const port = backend === "ts" ? PORTS.tsServer : backend === "kt" ? PORTS.ktServer : PORTS.tsSlow;
  const origin = `http://localhost:${port}`;

  if (backend === "ts" || backend === "ts2") {
    const dir = backend === "ts2" ? paths.ts2Dir : paths.tsDir;
    const prefix = backend === "ts2" ? "ts2" : "ts";
    const db = join(dir, "alice.db");
    await freePort(port, `${prefix}-server`);
    const serverEnv = {
      ...base,
      PORT: String(port),
      DATABASE_URL: db,
      NODE_ENV: "development",
      LOG_LEVEL: "warn",
      WEBAUTHN_ORIGIN: origin,
      WEBAUTHN_RP_ID: "localhost",
      CORS_ORIGINS: origin,
      BACKUP_DIR: join(dir, "backups"),
      ADMIN_SEAL_PRIVATE_KEY: undefined,
      CONFIG_WORKER_PRIVATE_KEY: undefined,
    };
    startProcess(ctx.dir, `${prefix}-server`, "bun", [join(BACKEND_DIR, "src", "index.ts")], BACKEND_DIR, serverEnv);
    await waitHealth(origin, `${prefix}-server`);
    startProcess(
      ctx.dir,
      `${prefix}-worker`,
      "bun",
      [join(BACKEND_DIR, "src", "worker", "index.ts")],
      BACKEND_DIR,
      { ...base, DATABASE_URL: db, NODE_ENV: "development", LOG_LEVEL: "info", ADMIN_SEAL_PRIVATE_KEY: keys.ADMIN_SEAL_PRIVATE_KEY },
    );
  } else {
    const db = join(paths.ktDir, "alice.db");
    await freePort(port, "kt-server");
    // F-003: the TS generator prints base64(PEM). Kotlin's `normalizePublicKey`/`pemOrDerToB64`
    // accept raw PEM (or base64 DER), but not base64(PEM), so decode the envelope to raw PEM.
    // (The update verifier also requires raw PEM, so one form covers every Kotlin key.)
    const ktSealPub = pemEnvToPem(keys.ADMIN_SEAL_PUBLIC_KEY!);
    const ktSealPriv = pemEnvToPem(keys.ADMIN_SEAL_PRIVATE_KEY!);
    const ktUpdatePub = pemEnvToPem(keys.UPDATE_SIGNING_PUBLIC_KEY!);
    const serverEnv = {
      ...base,
      ADMIN_SEAL_PUBLIC_KEY: ktSealPub,
      UPDATE_SIGNING_PUBLIC_KEY: ktUpdatePub,
      SERVER_PORT: String(port),
      DATABASE_PATH: db,
      NODE_ENV: "development",
      WEBAUTHN_ORIGIN: origin,
      WEBAUTHN_RP_ID: "localhost",
      CORS_ORIGINS: origin,
      ADMIN_SEAL_PRIVATE_KEY: undefined,
      CONFIG_WORKER_PRIVATE_KEY: undefined,
    };
    startProcess(ctx.dir, "kt-server", KOTLIN_BIN.server, [], paths.ktDir, serverEnv);
    await waitHealth(BACKEND_URL.kt, "kt-server");
    startProcess(ctx.dir, "kt-worker", KOTLIN_BIN.worker, [], paths.ktDir, {
      ...base,
      ADMIN_SEAL_PUBLIC_KEY: ktSealPub,
      UPDATE_SIGNING_PUBLIC_KEY: ktUpdatePub,
      DATABASE_PATH: db,
      NODE_ENV: "development",
      CONFIG_WORKER_PRIVATE_KEY: ktSealPriv,
      CONFIG_WORKER_INTERVAL_MS: "1000",
    });
  }
}

/** Stop the run's backend processes, delete their harness-owned databases, and start them again.
 *  The setup code and key set are kept; `passkey.json` is removed because it points at a credential
 *  in the database that was just deleted (ENV-06 registers again on its next run). */
export async function resetBackends(ctx: RunContext, backend: Backend = "both"): Promise<void> {
  await stopAll(ctx.dir);
  const paths = stackPaths(ctx.dir);
  const targets: ("ts" | "kt" | "ts2")[] = backend === "both" ? ["ts", "kt"] : [backend];
  for (const b of targets) {
    const dir = b === "ts" ? paths.tsDir : b === "ts2" ? paths.ts2Dir : paths.ktDir;
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      rmSync(join(dir, `alice.db${suffix}`), { force: true });
    }
  }
  rmSync(join(ctx.dir, "passkey.json"), { force: true });
  if (backend === "ts" || backend === "both") await startBackend(ctx, "ts");
  if (backend === "ts2") await startBackend(ctx, "ts2");
  if (backend === "kt" || backend === "both") await startBackend(ctx, "kt");
  // Let the worker's first sweep finish before the card's bootstrap writes to the same SQLite file.
  await new Promise((r) => setTimeout(r, 500));
}

/** Reset the TS oracle and the second TS stack used by the TS-vs-TS noise run, then start both. */
export async function resetTsPair(ctx: RunContext): Promise<void> {
  await stopAll(ctx.dir);
  const paths = stackPaths(ctx.dir);
  for (const dir of [paths.tsDir, paths.ts2Dir]) {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      rmSync(join(dir, `alice.db${suffix}`), { force: true });
    }
  }
  rmSync(join(ctx.dir, "passkey.json"), { force: true });
  await startBackend(ctx, "ts");
  await startBackend(ctx, "ts2");
  await new Promise((r) => setTimeout(r, 500));
}

/** Stop only the PIDs this run recorded: SIGTERM, then SIGKILL after 10 s. */
export async function stopAll(runDir: string): Promise<void> {
  const seen = new Set<number>();
  for (const rec of readPids(runDir)) {
    seen.add(rec.pid);
    await stopPid(rec.name, rec.pid);
  }
  // Processes recorded by an earlier run (or another --run-dir) still hold the parity ports.
  for (const rec of readRegistry()) {
    if (seen.has(rec.pid)) continue;
    seen.add(rec.pid);
    if (alivePid(rec.pid)) await stopPid(rec.name, rec.pid);
  }
  writeRegistry([]);
  const f = pidFile(runDir);
  if (existsSync(f)) rmSync(f);
}

async function stopPid(name: string, pid: number): Promise<void> {
  const alive = (): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (!alive()) {
    console.log(`${name} pid=${pid} already gone`);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    if (!alive()) {
      console.log(`${name} pid=${pid} stopped`);
      return;
    }
    await Bun.sleep(200);
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
  await Bun.sleep(200);
  console.log(`${name} pid=${pid} killed`);
}

/** Return the recorded PIDs that are still alive. */
export function livePids(runDir: string): { name: string; pid: number; alive: boolean }[] {
  return readPids(runDir).map((r) => {
    let alive = false;
    try {
      process.kill(r.pid, 0);
      alive = true;
    } catch {}
    return { name: r.name, pid: r.pid, alive };
  });
}

interface Args {
  command?: "up" | "down" | "status" | "reset";
  runDir?: string;
  backend: Backend;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const command = ["up", "down", "status", "reset"].includes(argv[0] ?? "") ? (argv[0] as Args["command"]) : undefined;
  let runDir: string | undefined;
  let backend: Backend = "both";
  let help = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--run-dir") runDir = argv[++i];
    else if (a === "--backend") {
      const v = argv[++i];
      if (v === "ts" || v === "kt" || v === "both" || v === "ts2") backend = v;
      else throw new Error(`--backend must be ts|kt|both|ts2, got ${v}`);
    }
  }
  return { command, runDir, backend, help };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    console.log(
      [
        "usage:",
        "  bun env/stack.ts up   [--run-dir <path>] [--backend ts|kt|both|ts2]",
        "  bun env/stack.ts down [--run-dir <path>]",
        "  bun env/stack.ts reset [--run-dir <path>] [--backend ts|kt|both|ts2]   (fresh harness databases)",
        "  bun env/stack.ts status [--run-dir <path>]",
      ].join("\n"),
    );
    return;
  }
  const ctx = makeRunDir(args.runDir);
  if (args.command === "down") {
    await stopAll(ctx.dir);
    return;
  }
  if (args.command === "status") {
    for (const r of livePids(ctx.dir)) console.log(`${r.alive ? "UP" : "down"}  ${r.name} pid=${r.pid}`);
    return;
  }
  if (args.command === "reset") {
    await resetBackends(ctx, args.backend);
    console.log("stack reset");
    return;
  }
  if (args.backend === "ts" || args.backend === "both") await startBackend(ctx, "ts");
  if (args.backend === "ts2") await startBackend(ctx, "ts2");
  if (args.backend === "kt" || args.backend === "both") await startBackend(ctx, "kt");
  console.log("stack up");
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`STACK FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
