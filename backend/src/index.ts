import { buildApp } from "./app";
import { env } from "./core/config/env";
import { createDb, runMigrations } from "./core/database/client";
import { logger } from "./core/logging/logger";
import { createServices } from "./services";

const db = createDb(env.databaseUrl);
runMigrations(db);

const services = createServices(db, { background: true });
const interrupted = services.commands.recoverInterrupted();
if (interrupted) logger.warn({ interrupted }, "marked commands interrupted by the last shutdown as failed");
services.ha.startAll();
services.sync.reconcileAll(); // anything that was waiting for the worker or an admin token goes out now
const resumed = services.routines.resumeInterrupted();
if (resumed) logger.warn({ resumed }, "picked up routine runs that were in flight at the last shutdown"); // stored Home Assistant connections reconnect in the background

services.activity.prune();
setInterval(() => services.activity.prune(), 24 * 3_600_000).unref(); // the timeline keeps 90 days

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
