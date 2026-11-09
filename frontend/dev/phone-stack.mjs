/**
 * An isolated copy of the whole product for trying on a phone: a backend and its worker on a fresh database, and the
 * front end in dev mode, each on its own port (BACK 3022, FRONT 3020) so your own dev servers and data are left alone.
 * It talks to the mock Home Assistant (bun run ha:up). Run: node dev/phone-stack.mjs  then, with the phone on USB:
 *   adb reverse tcp:3020 tcp:3020 && adb reverse tcp:3022 tcp:3022 && adb forward tcp:9333 localabstract:chrome_devtools_remote
 */
import { spawn, execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FRONT = 3020, BACK = 3022;
const here = new URL("..", import.meta.url).pathname, backend = join(here, "../backend");
const data = mkdtempSync(join(tmpdir(), "alice-phone-"));
const keys = Object.fromEntries(execSync("bun scripts/generate-keys.ts", { cwd: backend, encoding: "utf8" }).split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const env = {
  ...process.env, PORT: String(BACK), DATABASE_URL: join(data, "alice.db"), NODE_ENV: "development", LOG_LEVEL: "warn",
  WEBAUTHN_ORIGIN: `http://localhost:${FRONT}`, WEBAUTHN_RP_ID: "localhost", CORS_ORIGINS: `http://localhost:${FRONT}`,
  SECRETS_KEY: keys.SECRETS_KEY, ADMIN_SEAL_PUBLIC_KEY: keys.ADMIN_SEAL_PUBLIC_KEY, BACKUP_ENCRYPTION_KEY: keys.BACKUP_ENCRYPTION_KEY, BACKUP_DIR: join(data, "backups"),
  VAPID_PUBLIC_KEY: keys.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: keys.VAPID_PRIVATE_KEY, VAPID_SUBJECT: "mailto:phone@example.com", UPDATE_MANIFEST_URL: "", UPDATE_SIGNING_PUBLIC_KEY: "",
};
const run = (cmd, opts) => spawn("sh", ["-c", cmd], { stdio: "inherit", ...opts });
const kids = [
  run(`ADMIN_SEAL_PRIVATE_KEY=${keys.ADMIN_SEAL_PRIVATE_KEY} bun src/worker/index.ts & exec bun src/index.ts`, { cwd: backend, env }),
  run(`exec ./node_modules/.bin/next dev -p ${FRONT}`, { cwd: here, env: { ...process.env, BACKEND_URL: `http://localhost:${BACK}`, NEXT_PUBLIC_WS_URL: `ws://localhost:${BACK}/ws`, NEXT_DIST_DIR: ".next-phone" } }),
];
const stop = () => { kids.forEach((k) => k.kill("SIGTERM")); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
console.log(`phone stack: app http://localhost:${FRONT}, backend :${BACK}, data ${data}`);
