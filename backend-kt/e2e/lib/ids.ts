// Run-directory, identifier and test-card-id helpers.
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR } from "../env/constants.ts";

export function nowIso(): string {
  return new Date().toISOString();
}

/** Filesystem- and sort-safe run id: 2026-11-12T08-15-00-000Z */
export function runStamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

export interface RunContext {
  dir: string;
  seed: number;
  setupCode: string;
  startedAt: string;
}

/** Create (or open) a run directory and its standard subfolders. */
export function makeRunDir(explicit?: string): RunContext {
  const dir = explicit ? explicit : join(RUNS_DIR, runStamp());
  for (const sub of ["logs", "evidence", "snap", "ts", "kt", "pids", "ha-config", "fake"]) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  const runJson = join(dir, "run.json");
  if (existsSync(runJson)) {
    return JSON.parse(readFileSync(runJson, "utf8")) as RunContext;
  }
  const seed = 1_760_000_000; // fixed; report §4 randomness
  const setupCode = randomCode(9);
  const ctx: RunContext = { dir, seed, setupCode, startedAt: nowIso() };
  writeFileSync(runJson, JSON.stringify(ctx, null, 2));
  return ctx;
}

/** Deterministic PRNG (mulberry32) so generated fixture names are reproducible per run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomCode(length = 9): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromBase64url(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

/** A card id such as E2E-CMD-02, and its area code. */
export function areaOf(id: string): string {
  const m = id.match(/^E2E-([A-Z]+)-\d+$/);
  return m ? m[1]! : id.split("-")[1] ?? "";
}

/** Expand `--only` patterns (comma separated, `*` wildcard) and `--area` into matching ids. */
export function matchesCardFilter(id: string, patterns: string[]): boolean {
  return patterns.some((p) => (p.endsWith("*") ? id.startsWith(p.slice(0, -1)) : id === p));
}

export function expandCardFilter(patterns: string[]): string[] {
  return patterns.flatMap((p) => p.split(",")).map((s) => s.trim()).filter(Boolean);
}
