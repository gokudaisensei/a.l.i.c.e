import { Elysia } from "elysia";

export const energyController = new Elysia({ name: "module.energy", prefix: "/energy", tags: ["energy"] }).get(
  "/",
  () => ({ module: "energy", status: "not_implemented" as const }),
  { detail: { summary: "Consumption analytics" } },
);
