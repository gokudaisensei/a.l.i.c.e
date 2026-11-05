import pino from "pino";
import { env } from "@/config/env";

export const logger = pino({
  level: env.logLevel,
  base: { service: "alice-backend" },
  timestamp: pino.stdTimeFunctions.isoTime,
});
