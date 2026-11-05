import { Elysia } from "elysia";

export const insightsController = new Elysia({ name: "module.insights", prefix: "/insights", tags: ["insights"] }).get(
  "/",
  () => ({ module: "insights", status: "not_implemented" as const }),
  { detail: { summary: "Deterministic household intelligence" } },
);
