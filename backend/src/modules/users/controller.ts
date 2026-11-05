import { Elysia } from "elysia";

export const usersController = new Elysia({ name: "module.users", prefix: "/users", tags: ["users"] }).get(
  "/",
  () => ({ module: "users", status: "not_implemented" as const }),
  { detail: { summary: "Profiles and preferences" } },
);
