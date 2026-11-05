import { Elysia } from "elysia";

export const membershipsController = new Elysia({ name: "module.memberships", prefix: "/memberships", tags: ["memberships"] }).get(
  "/",
  () => ({ module: "memberships", status: "not_implemented" as const }),
  { detail: { summary: "Household relationships" } },
);
