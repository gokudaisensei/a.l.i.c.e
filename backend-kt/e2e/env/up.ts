// Bring up the two throwaway Home Assistant instances, bootstrap them and seed the demo home.
// Runbook §7 T0.5. Only alice-parity-* resources are created (R2/R10).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "../lib/proc.ts";
import { makeRunDir, nowIso } from "../lib/ids.ts";
import { runPreflight } from "./preflight.ts";
import { guardCompose } from "./guard.ts";
import { saveSnapshot } from "./snapshot.ts";
import {
  BACKEND_DIR,
  COMPOSE_FILE,
  HA_URL,
  PROJECT,
  REPO_ROOT,
} from "./constants.ts";

const BASE_CONFIG = join(REPO_ROOT, "backend", "dev", "ha", "configuration.yaml");

interface Args {
  runDir?: string;
  allowExisting: boolean;
  skipPreflight: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  let runDir: string | undefined;
  let allowExisting = false;
  let skipPreflight = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run-dir") runDir = argv[++i];
    else if (a === "--allow-existing") allowExisting = true;
    else if (a === "--skip-preflight") skipPreflight = true;
    else if (a === "--help" || a === "-h") help = true;
  }
  return { runDir, allowExisting, skipPreflight, help };
}

/**
 * Copy backend/dev/ha/configuration.yaml and add the parity package under the existing
 * `homeassistant:` block (a second top-level key would be invalid YAML).
 */
export function writeHaConfigCopy(runDir: string): string {
  const dir = join(runDir, "ha-config");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "configuration.yaml");
  const lines = readFileSync(BASE_CONFIG, "utf8").split("\n");
  const idx = lines.findIndex((l) => l.trim() === "homeassistant:");
  if (idx === -1) throw new Error(`no top-level homeassistant: block in ${BASE_CONFIG}`);
  lines.splice(idx + 1, 0, "  packages:", "    parity: !include parity-pack.yaml");
  writeFileSync(out, lines.join("\n"));
  return out;
}

async function haReady(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/api/onboarding`, { signal: AbortSignal.timeout(3000) });
    return r.status < 500;
  } catch {
    return false;
  }
}

async function waitHa(url: string, timeoutMs = 240_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await haReady(url)) return;
    await Bun.sleep(2000);
  }
  throw new Error(`Home Assistant at ${url} did not become ready within ${timeoutMs}ms`);
}

function bootstrap(url: string, envFile: string): void {
  const r = run("bun", [join(BACKEND_DIR, "dev", "ha", "bootstrap.ts")], {
    cwd: BACKEND_DIR,
    env: { ...process.env, HA_URL: url, ENV_FILE: envFile },
    timeoutMs: 180_000,
  });
  if (r.code !== 0) throw new Error(`bootstrap ${url} failed:\n${r.stdout}\n${r.stderr}`);
  console.log(r.stdout.trim());
}

function seed(envFile: string): void {
  const r = run("bun", [join(BACKEND_DIR, "dev", "ha", "seed-home.ts")], {
    cwd: BACKEND_DIR,
    env: { ...process.env, ENV_FILE: envFile, DEMO: "1" },
    timeoutMs: 300_000,
  });
  if (r.code !== 0) throw new Error(`seed ${envFile} failed:\n${r.stdout}\n${r.stderr}`);
  console.log(r.stdout.trim());
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("usage: bun env/up.ts [--run-dir <path>] [--allow-existing] [--skip-preflight]");
    return;
  }
  const runDir = args.runDir ?? makeRunDir().dir;
  mkdirSync(runDir, { recursive: true });

  if (!args.skipPreflight) {
    const { ok, checks } = runPreflight({ runDir, allowExisting: args.allowExisting });
    for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(22)} ${c.detail}`);
    if (!ok) throw new Error("preflight failed; fix the FAIL lines above");
  }

  const configCopy = writeHaConfigCopy(runDir);
  console.log(`generated HA config: ${configCopy}`);

  const composeArgs = ["compose", "-p", PROJECT, "-f", COMPOSE_FILE, "up", "-d"];
  guardCompose("T0.5 bring up HA pair", composeArgs);
  const up = run("docker", composeArgs, {
    env: { ...process.env, PARITY_HA_CONFIG: configCopy },
    timeoutMs: 300_000,
  });
  if (up.code !== 0) throw new Error(`docker compose up failed:\n${up.stdout}\n${up.stderr}`);
  console.log(up.stdout.trim());

  await waitHa(HA_URL.a);
  await waitHa(HA_URL.b);
  console.log("both Home Assistant instances are answering");

  const envA = join(runDir, "ha-a.env");
  const envB = join(runDir, "ha-b.env");
  bootstrap(HA_URL.a, envA);
  bootstrap(HA_URL.b, envB);
  seed(envA);
  seed(envB);

  // T0.6: keep a known-good snapshot so later suites can reset HA to this state.
  saveSnapshot(runDir, "seeded");

  writeFileSync(
    join(runDir, "ha.json"),
    JSON.stringify({ broughtUpAt: nowIso(), haA: HA_URL.a, haB: HA_URL.b, envA, envB }, null, 2),
  );
  console.log(`\nHA pair up and seeded. env files: ${envA}, ${envB}`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`\nUP FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}

export { main as upMain };
