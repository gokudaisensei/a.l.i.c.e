import { Elysia } from "elysia";

export const activityController = new Elysia({ name: "module.activity", prefix: "/activity", tags: ["activity"] }).get(
  "/",
  () => ({ module: "activity", status: "not_implemented" as const }),
  { detail: { summary: "Household activity timeline" } },
);
