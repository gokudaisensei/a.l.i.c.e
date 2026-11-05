import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";

app.listen(env.port);
logger.info({ port: env.port, env: env.nodeEnv }, "alice backend listening");
