import { Elysia } from "elysia";

export const householdsController = new Elysia({ name: "module.households", prefix: "/households", tags: ["households"] }).get(
  "/",
  () => ({ module: "households", status: "not_implemented" as const }),
  { detail: { summary: "Household management" } },
);
