import { buildApp } from "./app";
import { env } from "./core/config/env";
import { createDb, runMigrations } from "./core/database/client";
import { logger } from "./core/logging/logger";
import { createServices } from "./services";

const db = createDb(env.databaseUrl);
runMigrations(db);

const app = buildApp(createServices(db));
app.listen(env.port);
logger.info({ port: env.port, env: env.nodeEnv }, "alice backend listening");
