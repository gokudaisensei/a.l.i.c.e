import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { env } from "@/config/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { modules } from "@/modules";

export const app = new Elysia({ name: "alice" })
  .use(cors({ origin: env.corsOrigins, credentials: true }))
  .use(openapi({ path: "/docs", documentation: { info: { title: "Alice API", version: "0.1.0" } } }))
  .onError(({ error, code, set }) => {
    if (error instanceof AppError) {
      set.status = error.status;
      return { error: { code: error.code, message: error.message } };
    }
    if (code === "NOT_FOUND") return { error: { code: "not_found", message: "Route not found" } };
    if (code === "VALIDATION") return { error: { code: "validation_error", message: error.message } };
    logger.error({ err: error }, "unhandled error");
    set.status = 500;
    return { error: { code: "internal_error", message: "Internal server error" } };
  })
  .get("/health", () => ({ status: "ok" as const, uptime: process.uptime() }), { tags: ["system"] })
  .use(modules);

/** Import this type from the frontend for Eden Treaty. */
export type App = typeof app;
