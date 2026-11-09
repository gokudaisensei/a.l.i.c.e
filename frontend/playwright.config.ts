import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests: a real browser (Chrome, with a virtual passkey device), the real frontend, a real backend on a fresh
 * database with its config-worker, and the mock Home Assistant (bun run ha:up, ha:bootstrap, ha:seed in ../backend).
 * They use their own ports, so they can run beside the dev servers.
 */
const FRONT = 3010, BACK = 3012;
const backend = join(__dirname, "../backend");
const data = mkdtempSync(join(tmpdir(), "alice-e2e-"));

const keys = Object.fromEntries(execSync("bun scripts/generate-keys.ts", { cwd: backend, encoding: "utf8" }).split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const serverEnv = {
  PORT: String(BACK), DATABASE_URL: join(data, "alice.db"), NODE_ENV: "development", LOG_LEVEL: "warn",
  WEBAUTHN_ORIGIN: `http://localhost:${FRONT}`, WEBAUTHN_RP_ID: "localhost", CORS_ORIGINS: `http://localhost:${FRONT}`,
  SECRETS_KEY: keys.SECRETS_KEY!, ADMIN_SEAL_PUBLIC_KEY: keys.ADMIN_SEAL_PUBLIC_KEY!, BACKUP_ENCRYPTION_KEY: keys.BACKUP_ENCRYPTION_KEY!, BACKUP_DIR: join(data, "backups"),
  VAPID_PUBLIC_KEY: keys.VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY: keys.VAPID_PRIVATE_KEY!, VAPID_SUBJECT: "mailto:e2e@example.com",
  UPDATE_MANIFEST_URL: "", UPDATE_SIGNING_PUBLIC_KEY: "",
};

export default defineConfig({
  testDir: "./e2e",
  // screenshots for build-to-build comparison are taken only on request (SHOTS=dir)
  testIgnore: process.env.SHOTS ? undefined : /shots\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${FRONT}`, channel: "chrome", headless: true, trace: "retain-on-failure" },
  webServer: [
    // The config-worker runs beside the server, with the private key only in its own environment.
    { command: `sh -c 'ADMIN_SEAL_PRIVATE_KEY=${keys.ADMIN_SEAL_PRIVATE_KEY} bun src/worker/index.ts & exec bun src/index.ts'`, cwd: backend, env: serverEnv, url: `http://localhost:${BACK}/health`, reuseExistingServer: false, timeout: 60_000 },
    { command: `bunx next dev -p ${FRONT}`, cwd: __dirname, env: { BACKEND_URL: `http://localhost:${BACK}`, NEXT_PUBLIC_WS_URL: `ws://localhost:${BACK}/ws`, NEXT_DIST_DIR: ".next-e2e" }, url: `http://localhost:${FRONT}/library`, reuseExistingServer: false, timeout: 120_000 },
  ],
});
