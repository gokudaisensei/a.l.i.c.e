import { Elysia } from "elysia";

export const authenticationController = new Elysia({ name: "module.authentication", prefix: "/authentication", tags: ["authentication"] }).get(
  "/",
  () => ({ module: "authentication", status: "not_implemented" as const }),
  { detail: { summary: "Passkeys, sessions, recovery" } },
);
