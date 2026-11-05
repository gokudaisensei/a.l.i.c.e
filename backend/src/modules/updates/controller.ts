import { Elysia } from "elysia";

export const updatesController = new Elysia({ name: "module.updates", prefix: "/updates", tags: ["updates"] }).get(
  "/",
  () => ({ module: "updates", status: "not_implemented" as const }),
  { detail: { summary: "Application update management" } },
);
