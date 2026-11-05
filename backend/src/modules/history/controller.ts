import { Elysia } from "elysia";

export const historyController = new Elysia({ name: "module.history", prefix: "/history", tags: ["history"] }).get(
  "/",
  () => ({ module: "history", status: "not_implemented" as const }),
  { detail: { summary: "Historical data access" } },
);
