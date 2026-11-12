// Tear down only what this harness created: recorded backend processes, then the alice-parity compose
// project (containers, network, volumes). Never touches the user's containers (R2/R4).
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../lib/proc.ts";
import { guardCompose } from "./guard.ts";
import { COMPOSE_FILE, PROJECT, RUNS_DIR } from "./constants.ts";import { stopAll, livePids } from "./stack.ts";
import { captureBaseline, compareBaselines, type Baseline } from "./preflight.ts";

interface Args {
  runDir?: string;
  keepVolumes: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  let runDir: string | undefined;
  let keepVolumes = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run-dir") runDir = argv[++i];
    else if (a === "--keep-volumes") keepVolumes = true;
    else if (a === "--help" || a === "-h") help = true;
  }
  return { runDir, keepVolumes, help };
}

/** Newest run directory, if any. */
export function latestRunDir(): string | undefined {
  if (!existsSync(RUNS_DIR)) return undefined;
  const dirs = readdirSync(RUNS_DIR)
    .filter((d) => existsSync(join(RUNS_DIR, d, "run.json")))
    .sort();
  const last = dirs.at(-1);
  return last ? join(RUNS_DIR, last) : undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("usage: bun env/down.ts [--run-dir <path>] [--keep-volumes]");
    return;
  }
  const runDir = args.runDir ?? latestRunDir();

  if (runDir) {
    await stopAll(runDir);
    console.log(`stopped recorded backend processes for ${runDir}`);
  } else {
    console.log("no run directory found; no backend processes to stop");
  }

  const composeArgs = [
    "compose",
    "-p",
    PROJECT,
    "-f",
    COMPOSE_FILE,
    "down",
    ...(args.keepVolumes ? [] : ["-v"]),
    "--remove-orphans",
  ];
  guardCompose("tear down HA pair", composeArgs);
  // PARITY_HA_CONFIG is only needed for config interpolation; `down` does not read the file but
  // compose still requires the variable to parse the file.
  const res = run("docker", composeArgs, {
    env: { ...process.env, PARITY_HA_CONFIG: join(runDir ?? RUNS_DIR, "ha-config", "configuration.yaml") },
    timeoutMs: 180_000,
  });
  if (res.code !== 0) {
    console.error(`docker compose down failed:\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
  if (res.stdout.trim()) console.log(res.stdout.trim());
  console.log(args.keepVolumes ? "HA containers removed, volumes kept" : "HA containers and volumes removed");

  if (runDir) writeTidyProof(runDir);
}

/**
 * T0.11 / ENV-05: after everything this run started is gone, prove the user's containers, ports
 * and `backend/.env.test` are exactly as they were, and that no stray process or file remains.
 */
function writeTidyProof(runDir: string): void {
  const beforeFile = join(runDir, "baseline.json");
  if (!existsSync(beforeFile)) {
    console.log(`ENV-05: no baseline at ${beforeFile}; tidy proof skipped`);
    return;
  }
  const before = JSON.parse(readFileSync(beforeFile, "utf8")) as Baseline;
  const now = captureBaseline();
  const cmp = compareBaselines(before, now);

  const pids = livePids(runDir);
  const alive = pids.filter((p) => p.alive);
  const parityContainers = run("docker", ["ps", "-a", "--filter", "name=alice-parity-", "--format", "{{.Names}}"])
    .stdout.split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const ok = cmp.ok && alive.length === 0 && parityContainers.length === 0;
  const evidenceDir = join(runDir, "evidence", "E2E-ENV-05");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, "tidy-baseline.json"), JSON.stringify(before, null, 2) + "\n");
  writeFileSync(join(evidenceDir, "tidy-now.json"), JSON.stringify(now, null, 2) + "\n");
  writeFileSync(
    join(evidenceDir, "tidy-diff.json"),
    JSON.stringify({ comparison: cmp, alivePids: alive, parityContainers }, null, 2) + "\n",
  );
  writeFileSync(
    join(evidenceDir, "tidy-result.json"),
    JSON.stringify({ ok, checkedAt: new Date().toISOString(), userContainers: now.containers.length }, null, 2) + "\n",
  );

  console.log(`ENV-05 tidy proof: ${ok ? "PASS" : "FAIL"} (${join(evidenceDir, "tidy-result.json")})`);
  if (!ok) {
    if (cmp.addedContainers.length) console.log(`  user containers added: ${cmp.addedContainers.join(", ")}`);
    if (cmp.removedContainers.length) console.log(`  user containers removed: ${cmp.removedContainers.join(", ")}`);
    for (const [port, d] of Object.entries(cmp.portDiffs)) console.log(`  port ${port}: ${d.before} -> ${d.now}`);
    if (!cmp.envTestSame) console.log(`  backend/.env.test changed`);
    for (const [key, d] of Object.entries(cmp.dataDirDiffs)) console.log(`  ${key}/data changed${d.note ? ` (${d.note})` : ""}`);
    if (alive.length) console.log(`  processes still alive: ${alive.map((p) => `${p.name}=${p.pid}`).join(", ")}`);
    if (parityContainers.length) console.log(`  parity containers remain: ${parityContainers.join(", ")}`);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`DOWN FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
