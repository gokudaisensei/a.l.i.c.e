import { Elysia } from "elysia";

export const notificationsController = new Elysia({ name: "module.notifications", prefix: "/notifications", tags: ["notifications"] }).get(
  "/",
  () => ({ module: "notifications", status: "not_implemented" as const }),
  { detail: { summary: "Alerts and delivery" } },
);
