import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { env } from "./core/config/env";
import { AppError } from "./core/errors/errors";
import { checkSameSite } from "./core/http/csrf";
import { logger } from "./core/logging/logger";
import { buildModules } from "./modules";
import { realtimeController } from "./realtime/ws.controller";
import type { Services } from "./services";

export const buildApp = (services: Services) =>
  new Elysia({ name: "alice" })
    .use(cors({ origin: env.corsOrigins, credentials: true }))
    .use(openapi({ path: "/docs", documentation: { info: { title: "Alice API", version: "0.1.0" } } }))
    .onBeforeHandle({ as: "global" }, ({ request }) => { if (new URL(request.url).pathname.startsWith("/api/v1/")) checkSameSite(request, services.allowedOrigins); })
    .onError(({ error, code, set }) => {
      if (error instanceof AppError) {
        set.status = error.status;
        if (error.headers) Object.assign(set.headers, error.headers);
        return { error: { code: error.code, message: error.message } };
      }
      if (code === "NOT_FOUND") return { error: { code: "not_found", message: "Route not found" } };
      if (code === "VALIDATION") { set.status = 422; return { error: { code: "validation_error", message: error.message } }; }
      if (code === "PARSE") { set.status = 400; return { error: { code: "bad_request", message: "Could not read the request body" } }; }
      logger.error({ err: error }, "unhandled error");
      set.status = 500;
      return { error: { code: "internal_error", message: "Internal server error" } };
    })
    .get("/health", () => ({ status: "ok" as const, uptime: process.uptime() }), { tags: ["system"] })
    .use(realtimeController(services))
    .use(buildModules(services));

/** Import this type from the frontend for Eden Treaty. */
export type App = ReturnType<typeof buildApp>;
