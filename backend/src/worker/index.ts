/**
 * The config-worker: a separate process that holds the Home Assistant admin token and applies Alice's scenes, routines,
 * automations, mode helper and voice exposure to Home Assistant. Run it with `bun run worker`.
 * It needs DATABASE_URL (same file as the server) and ADMIN_SEAL_PRIVATE_KEY, and it must not share the server's environment.
 */
import { env } from "../core/config/env";
import { createDb } from "../core/database/client";
import { logger } from "../core/logging/logger";
import { pemFromEnv } from "../core/security/sealed";
import { ConfigWorker } from "./config-worker";
import { HaAdminApi } from "./ha-admin-api";

if (!env.adminSealPrivateKey) {
  console.error("ADMIN_SEAL_PRIVATE_KEY is not set. Generate keys with: bun run keys:generate");
  process.exit(1);
}

const worker = new ConfigWorker({
  db: createDb(env.databaseUrl),
  privateKeyPem: pemFromEnv(env.adminSealPrivateKey),
  apiFactory: (baseUrl, token) => new HaAdminApi(baseUrl, token),
  log: logger.child({ module: "config-worker" }),
});
worker.start();
logger.info("config-worker running");

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { worker.stop(); process.exit(0); });
