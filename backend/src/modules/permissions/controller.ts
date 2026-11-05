import { Elysia } from "elysia";

export const permissionsController = new Elysia({ name: "module.permissions", prefix: "/permissions", tags: ["permissions"] }).get(
  "/",
  () => ({ module: "permissions", status: "not_implemented" as const }),
  { detail: { summary: "RBAC and device-level access" } },
);
