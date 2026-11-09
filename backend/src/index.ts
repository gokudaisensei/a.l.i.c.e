import { buildApp } from "./app";
import { env } from "./core/config/env";
import { createDb, runMigrations } from "./core/database/client";
import { logger } from "./core/logging/logger";
import { applyPendingRestore } from "./modules/backups/restore-apply";
import { users } from "./core/database/schema";
import { randomToken } from "./core/security/tokens";
import { createServices, defaultAuthConfig } from "./services";

if (env.databaseUrl !== ":memory:") {
  const r = applyPendingRestore(env.databaseUrl);
  if (r.applied) logger.warn({ detail: r.detail }, "applied a staged backup restore");
  else if (r.detail !== "nothing staged") logger.error({ detail: r.detail }, "staged backup restore was not applied");
}
const db = createDb(env.databaseUrl);
runMigrations(db);

// A new production install must not let the first visitor become admin: it needs a setup code, logged here if none is configured.
const auth = defaultAuthConfig();
if (env.nodeEnv === "production" && !auth.setupCode && !db.select({ id: users.id }).from(users).limit(1).get()) {
  auth.setupCode = randomToken(9);
  logger.warn({ setupCode: auth.setupCode }, "this install has no users yet: the first person to register needs this setup code");
}
const services = createServices(db, { background: true, auth });
const interrupted = services.commands.recoverInterrupted();
if (interrupted) logger.warn({ interrupted }, "marked commands interrupted by the last shutdown as failed");
services.ha.startAll();
services.sync.reconcileAll(); // anything that was waiting for the worker or an admin token goes out now
const resumed = services.routines.resumeInterrupted();
if (resumed) logger.warn({ resumed }, "picked up routine runs that were in flight at the last shutdown"); // stored Home Assistant connections reconnect in the background

services.activity.prune();
services.configJobs.prune();
setInterval(() => { services.activity.prune(); services.configJobs.prune(); }, 24 * 3_600_000).unref(); // the timeline keeps 90 days, applied config jobs 7

const app = buildApp(services);
setInterval(() => services.realtime.sweep(), 15_000).unref(); // end sockets whose session expired or was revoked
app.listen(env.port);
logger.info({ port: env.port, env: env.nodeEnv }, "alice backend listening");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    logger.info({ sig }, "shutting down");
    services.realtime.closeAll();
    await services.manager.stopAll();
    process.exit(0);
  });
}
