import { Elysia } from "elysia";

export const administrationController = new Elysia({ name: "module.administration", prefix: "/administration", tags: ["administration"] }).get(
  "/",
  () => ({ module: "administration", status: "not_implemented" as const }),
  { detail: { summary: "System configuration and diagnostics" } },
);
