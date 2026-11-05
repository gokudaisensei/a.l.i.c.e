import { Elysia } from "elysia";

export const backupsController = new Elysia({ name: "module.backups", prefix: "/backups", tags: ["backups"] }).get(
  "/",
  () => ({ module: "backups", status: "not_implemented" as const }),
  { detail: { summary: "Application and HA backups" } },
);
