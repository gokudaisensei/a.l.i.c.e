/**
 * Undoes ./setup.sh and ./run.sh. Run it with ./teardown.sh.
 * Always stops Alice's processes. Everything else is chosen by category, because some of it cannot be undone:
 *   ha       the test Home Assistant container and its volume (the disposable one setup created)
 *   build    frontend build cache and run logs (.logs, .next)
 *   config   env files and keys (backend/.env, .env.worker, .env.test, backups of them, frontend/.env.local, .env.alice)
 *   data     the database and local backups (backend/data). Deleting config WITHOUT data leaves a database nobody can decrypt.
 *   deps     node_modules
 * It never touches the demo Home Assistant (alice-ha-demo), your own Home Assistant, git history, or source files.
 */
import * as p from "@clack/prompts";
import { existsSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const BACKEND = join(ROOT, "backend");
const FRONTEND = join(ROOT, "frontend");
const CATS = ["ha", "build", "config", "data", "deps"] as const;
type Cat = (typeof CATS)[number];

const USAGE = `Usage: ./teardown.sh [options]
  (no category flag)   ask what to remove (non-interactive: only stop processes and clear build/logs)
      --all            everything below, including the database and node_modules
      --ha             remove the test Home Assistant container and its data
      --build          remove .logs and the frontend build cache
      --config         remove env files and keys (the setup code and sealed tokens go with them)
      --data           remove the database and local backups (backend/data)
      --deps           remove node_modules
      --keep-running   do not stop running Alice processes
  -n, --dry-run        show what would happen, change nothing
  -y, --yes            do not ask for confirmation
  -h, --help`;

const picked = new Set<Cat>();
let all = false, dry = false, yes = false, keepRunning = false;
for (const a of process.argv.slice(2)) {
  if (a === "--all") all = true;
  else if (a === "-n" || a === "--dry-run") dry = true;
  else if (a === "-y" || a === "--yes") yes = true;
  else if (a === "--keep-running") keepRunning = true;
  else if (a === "-h" || a === "--help") { console.log(USAGE); process.exit(0); }
  else if (CATS.includes(a.slice(2) as Cat) && a.startsWith("--")) picked.add(a.slice(2) as Cat);
  else { console.error(USAGE); console.error(`\nUnknown option: ${a}`); process.exit(1); }
}
if (all) CATS.forEach((c) => picked.add(c));
const interactive = !!process.stdin.isTTY && !yes;
const answer = <T>(v: T | symbol): T => { if (p.isCancel(v)) { p.cancel("Cancelled, nothing more was changed."); process.exit(130); } return v as T; };
const run = (cmd: string[], cwd = BACKEND, env: Record<string, string> = {}) =>
  Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });

// ---------- what exists ----------
const state = Object.fromEntries((existsSync(join(ROOT, ".env.alice")) ? readFileSync(join(ROOT, ".env.alice"), "utf8") : "").split("\n")
  .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2]]));
const backendFiles = existsSync(BACKEND) ? readdirSync(BACKEND).filter((f) => /^\.env(\.worker|\.test|\.bak\..*)$|^\.env$/.test(f)) : [];
const paths: Record<Cat, string[]> = {
  ha: [],
  build: [join(ROOT, ".logs"), join(FRONTEND, ".next")],
  config: [...backendFiles.map((f) => join(BACKEND, f)), join(FRONTEND, ".env.local"), join(ROOT, ".env.alice")],
  data: [join(BACKEND, "data")],
  deps: [join(ROOT, "node_modules"), join(BACKEND, "node_modules"), join(FRONTEND, "node_modules")],
};
const size = (path: string): number => {
  try { const s = statSync(path); return s.isDirectory() ? readdirSync(path).reduce((n, f) => n + size(join(path, f)), 0) : s.size; } catch { return 0; }
};
const human = (n: number) => (n > 1 << 20 ? `${(n / (1 << 20)).toFixed(0)} MB` : n > 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`);
const existing = (c: Cat) => paths[c].filter(existsSync);
const mockHa = () => !!Bun.which("docker") && (run(["docker", "ps", "-a", "--format", "{{.Names}}"]).stdout.toString().split("\n").includes("alice-ha-mock")
  || run(["docker", "volume", "ls", "-q"]).stdout.toString().split("\n").some((v) => v.startsWith("alice-ha-mock_")));

// ---------- running processes ----------
interface Proc { pid: number; pgid: number; what: string }
function aliceProcesses(): Proc[] {
  const ports = [state.FE_PORT, state.BE_PORT].filter(Boolean);
  const byPort = new Set<number>();
  for (const port of ports) {
    const ss = run(["ss", "-ltnpH", `sport = :${port}`], ROOT).stdout.toString();
    for (const m of ss.matchAll(/pid=(\d+)/g)) byPort.add(+m[1]);
  }
  const found = new Map<number, Proc>();
  for (const d of readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    const pid = +d;
    if (pid === process.pid) continue;
    try {
      const cwd = readlinkSync(`/proc/${d}/cwd`);
      const cmd = readFileSync(`/proc/${d}/cmdline`, "utf8").replace(/\0/g, " ").trim();
      const inRepo = cwd === BACKEND || cwd === FRONTEND || cwd.startsWith(`${ROOT}/`);
      const worker = cwd === BACKEND && /worker\/index\.ts/.test(cmd);
      if (!(byPort.has(pid) || worker || (inRepo && /next (dev|start)|next-server|src\/index\.ts|bun run (start|dev)/.test(cmd)))) continue;
      const pgid = +readFileSync(`/proc/${d}/stat`, "utf8").replace(/^.*\) /, "").split(" ")[2];
      found.set(pid, { pid, pgid, what: cmd.slice(0, 90) });
    } catch { /* gone, or not ours to read */ }
  }
  return [...found.values()];
}
async function stopProcesses() {
  const procs = aliceProcesses();
  if (!procs.length) return p.log.info("No Alice processes are running.");
  for (const x of procs) p.log.step(`${dry ? "Would stop" : "Stopping"} ${x.pid}: ${x.what}`);
  if (dry) return;
  const kill = (sig: NodeJS.Signals) => { for (const x of procs) { try { process.kill(x.pgid === x.pid ? -x.pid : x.pid, sig); } catch { /* already gone */ } } };
  kill("SIGTERM");
  for (let i = 0; i < 20 && aliceProcesses().length; i++) await Bun.sleep(500);
  if (aliceProcesses().length) { p.log.warn("Some processes ignored SIGTERM for 10s; forcing them."); kill("SIGKILL"); await Bun.sleep(500); }
  p.log.success("Stopped.");
}

// ---------- choose ----------
p.intro("Alice teardown");
if (!keepRunning) await stopProcesses();

if (!picked.size) {
  if (interactive) {
    const opts = [
      { value: "ha" as Cat, label: "Test Home Assistant", hint: mockHa() ? "container + volume" : "none found" },
      { value: "build" as Cat, label: "Build cache and logs", hint: human(existing("build").reduce((n, f) => n + size(f), 0)) },
      { value: "config" as Cat, label: "Env files and keys", hint: `${existing("config").length} files; the setup code and sealed tokens go with them` },
      { value: "data" as Cat, label: "Database and local backups", hint: `${human(size(paths.data[0]))}; cannot be undone` },
      { value: "deps" as Cat, label: "node_modules", hint: "reinstalled by ./setup.sh" },
    ];
    answer<Cat[]>(await p.multiselect({ message: "What else should be removed?", options: opts, initialValues: ["ha", "build"] as Cat[], required: false })).forEach((c) => picked.add(c));
  } else { picked.add("build"); }
}
if (picked.has("config") && !picked.has("data") && existing("data").length) {
  p.log.warn("Removing the keys but keeping the database leaves data nobody can decrypt (passkeys stay, sealed tokens do not). Add --data to remove both.");
}

// ---------- confirm and do ----------
const plan: string[] = [];
if (picked.has("ha")) plan.push(mockHa() ? "test Home Assistant: container alice-ha-mock and its volume" : "test Home Assistant: nothing found");
for (const c of CATS.filter((x) => x !== "ha" && picked.has(x))) for (const f of existing(c)) plan.push(`${f.replace(`${ROOT}/`, "")}  (${human(size(f))})`);
if (!plan.length) { p.outro("Nothing to remove."); process.exit(0); }
p.note(plan.join("\n"), dry ? "Would remove" : "Will remove");
if (dry) { p.outro("Dry run: nothing changed."); process.exit(0); }
if (interactive && !answer<boolean>(await p.confirm({ message: `Remove all of this${picked.has("data") ? ", including the database" : ""}?`, initialValue: false }))) {
  p.outro("Cancelled, nothing was removed."); process.exit(0);
}
if (!interactive && !yes && (picked.has("data") || picked.has("config"))) {
  console.error("Removing config or data needs confirmation: run it in a terminal, or add --yes."); process.exit(1);
}

let failed = 0;
if (picked.has("ha") && mockHa()) {
  const r = run(["bun", "run", "ha:down"], BACKEND, { HA_PORT: state.HA_PORT ?? "8123" });
  if (r.exitCode === 0) p.log.success("Removed the test Home Assistant."); else { failed++; p.log.error(`Could not remove the test HA: ${r.stderr.toString().trim().split("\n").pop()}`); }
}
for (const c of CATS.filter((x) => x !== "ha" && picked.has(x))) {
  for (const f of existing(c)) {
    try { rmSync(f, { recursive: true, force: true }); p.log.success(`Removed ${f.replace(`${ROOT}/`, "")}`); }
    catch (e) { failed++; p.log.error(`Could not remove ${f}: ${(e as Error).message}`); }
  }
}
p.outro(failed ? `Done with ${failed} problem(s).` : picked.has("deps") || picked.has("config") ? "Done. Run ./setup.sh to set up again." : "Done.");
process.exit(failed ? 1 : 0);
