// Shared constants for the parity harness. Every port/name here is fixed by runbook §5.1.
import { join, dirname } from "node:path";

/** Directory of this file's parent (backend-kt/e2e). */
export const E2E_DIR = dirname(import.meta.dir);
export const REPO_ROOT = join(E2E_DIR, "..", "..");
export const BACKEND_DIR = join(REPO_ROOT, "backend");
export const BACKEND_KT_DIR = join(REPO_ROOT, "backend-kt");
export const RUNS_DIR = join(E2E_DIR, ".runs");
export const COMPOSE_FILE = join(E2E_DIR, "env", "docker-compose.parity.yml");
export const PARITY_PACK_FILE = join(E2E_DIR, "env", "ha-parity-pack.yaml");

export const PROJECT = "alice-parity";

export const PORTS = {
  haA: 18123,
  haB: 18124,
  tsServer: 3101,
  ktServer: 3102,
  tsSlow: 3103,
  ktSlow: 3104,
  fakeManifest: 3190,
  fakePush: 3191,
  fakeLlm: 3192,
  fakeLatency: 3193,
} as const;

/** Ports the user owns and the harness must never bind. Baseline-checked by ENV-05. */
export const USER_PORTS = [3001, 3002, 3010, 3012, 8123];

/** Ports this run must have free before starting. */
export const HARNESS_PORTS = [
  PORTS.haA,
  PORTS.haB,
  PORTS.tsServer,
  PORTS.ktServer,
  PORTS.tsSlow,
  PORTS.ktSlow,
  PORTS.fakeManifest,
  PORTS.fakePush,
  PORTS.fakeLlm,
  PORTS.fakeLatency,
];

export const CONTAINERS = {
  haA: "alice-parity-ha-a",
  haB: "alice-parity-ha-b",
} as const;

/** Compose volume names (project-prefixed). */
export const VOLUMES = {
  haA: `${PROJECT}_ha-a`,
  haB: `${PROJECT}_ha-b`,
} as const;

export const HA_IMAGE = "ghcr.io/home-assistant/home-assistant:2026.10.4";
export const HA_VERSION = "2026.10.4";

export const HA_URL = {
  a: `http://127.0.0.1:${PORTS.haA}`,
  b: `http://127.0.0.1:${PORTS.haB}`,
} as const;

export const BACKEND_URL = {
  ts: `http://127.0.0.1:${PORTS.tsServer}`,
  kt: `http://127.0.0.1:${PORTS.ktServer}`,
  ts2: `http://127.0.0.1:${PORTS.tsSlow}`,
} as const;

/** Paths to the installed Kotlin distributions produced by `./gradlew installDist`. */
export const KOTLIN_BIN = {
  server: join(BACKEND_KT_DIR, "server", "build", "install", "server", "bin", "server"),
  worker: join(BACKEND_KT_DIR, "worker", "build", "install", "worker", "bin", "worker"),
} as const;
