import { Elysia } from "elysia";

export const householdModesController = new Elysia({ name: "module.household-modes", prefix: "/household-modes", tags: ["household-modes"] }).get(
  "/",
  () => ({ module: "household-modes", status: "not_implemented" as const }),
  { detail: { summary: "Home, Away, Night, Vacation" } },
);
