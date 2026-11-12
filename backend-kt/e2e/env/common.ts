/**
 * Shared helpers for the e2e harness's environment scripts (env/*).
 * No dependency on backend/ or backend-kt/ product code (RUNBOOK §4).
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = resolve(fileURLToPath(import.meta.url), "../..");
export const REPO_ROOT = resolve(E2E_DIR, "../..");

/** Fixed ports and names (RUNBOOK §5.1). */
export const PORTS = {
  haA: 18123,
  haB: 18124,
  tsServer: 3101,
  ktServer: 3102,
  tsShortTtl: 3103,
  ktShortTtl: 3104,
  fakeManifest: 3190,
  fakePush: 3191,
  fakeLlm: 3192,
  fakeHaLatency: 3193,
} as const;

export const NAMES = {
  project: "alice-parity",
  haA: "alice-parity-ha-a",
  haB: "alice-parity-ha-b",
} as const;

export const HA_IMAGE = "ghcr.io/home-assistant/home-assistant:2026.10.4";

export function sh(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; input?: string } = {}): SpawnSyncReturns<string> {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    input: opts.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return r;
}

export function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): string {
  const r = sh(cmd, args, opts);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
  return r.stdout;
}

/** Resolve (and create) a run directory. A fresh timestamp unless --run-dir is given. */
export function resolveRunDir(flag?: string): string {
  const base = flag
    ? resolve(flag)
    : join(E2E_DIR, ".runs", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(base, { recursive: true });
  return base;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Read `ss -ltn` and report who holds a TCP port, if anyone. */
export function portHolder(port: number): string | null {
  const r = sh("ss", ["-ltnp"]);
  for (const line of (r.stdout || "").split("\n")) {
    if (line.includes(`:${port} `)) return line.trim();
  }
  return null;
}

export function isPortFree(port: number): boolean {
  return portHolder(port) === null;
}

export function dockerContainerNames(): string[] {
  const r = sh("docker", ["ps", "-a", "--format", "{{.Names}}"]);
  return (r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
}

/**
 * Convert a TS `generate-keys.ts` value (base64 of PEM) into base64 of DER, the
 * form Kotlin `Sealed` accepts (F-003). Idempotent for raw PEM / already-DER values.
 */
export function pemEnvToDerB64(value: string): string {
  const pem = Buffer.from(value.trim(), "base64").toString("utf8");
  if (pem.includes("-----BEGIN")) {
    return pem
      .split(/\r?\n/)
      .filter((l) => !l.startsWith("-----"))
      .join("")
      .replace(/\s/g, "");
  }
  return value.trim();
}

/** Decode a TS `generate-keys.ts` value (base64 of PEM) back to raw PEM text. */
export function pemEnvToPem(value: string): string {
  const pem = Buffer.from(value.trim(), "base64").toString("utf8");
  return pem.includes("-----BEGIN") ? pem : value.trim();
}

export async function waitForHttp(url: string, timeoutMs = 180_000, ok: (r: Response) => boolean = (r) => r.ok): Promise<Response> {
  const start = Date.now();
  let last: Response | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      last = r;
      if (ok(r)) return r;
    } catch {}
    await Bun.sleep(1000);
  }
  throw new Error(`timed out waiting for ${url} (last: ${last ? last.status : "unreachable"})`);
}

export function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function writeIfMissing(path: string, contents: string): void {
  if (!existsSync(path)) writeFileSync(path, contents);
}
