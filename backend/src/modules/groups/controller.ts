import { Elysia } from "elysia";

export const groupsController = new Elysia({ name: "module.groups", prefix: "/groups", tags: ["groups"] }).get(
  "/",
  () => ({ module: "groups", status: "not_implemented" as const }),
  { detail: { summary: "Logical device groups" } },
);
