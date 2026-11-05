import { Elysia } from "elysia";

export const devicesController = new Elysia({ name: "module.devices", prefix: "/devices", tags: ["devices"] }).get(
  "/",
  () => ({ module: "devices", status: "not_implemented" as const }),
  { detail: { summary: "Device inventory and controls" } },
);
