import { app } from "./app";
import { env } from "./core/config/env";
import { logger } from "./core/logging/logger";

app.listen(env.port);
logger.info({ port: env.port, env: env.nodeEnv }, "alice backend listening");
