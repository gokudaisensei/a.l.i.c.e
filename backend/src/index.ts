import { buildApp } from "./app";
import { env } from "./core/config/env";
import { createDb, runMigrations } from "./core/database/client";
import { logger } from "./core/logging/logger";
import { createServices } from "./services";

const db = createDb(env.databaseUrl);
runMigrations(db);

const services = createServices(db);
const interrupted = services.commands.recoverInterrupted();
if (interrupted) logger.warn({ interrupted }, "marked commands interrupted by the last shutdown as failed");
services.ha.startAll(); // stored Home Assistant connections reconnect in the background

const app = buildApp(services);
app.listen(env.port);
logger.info({ port: env.port, env: env.nodeEnv }, "alice backend listening");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    logger.info({ sig }, "shutting down");
    await services.manager.stopAll();
    process.exit(0);
  });
}
