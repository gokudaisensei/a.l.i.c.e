import { Elysia } from "elysia";

export const routinesController = new Elysia({ name: "module.routines", prefix: "/routines", tags: ["routines"] }).get(
  "/",
  () => ({ module: "routines", status: "not_implemented" as const }),
  { detail: { summary: "Reusable action sequences" } },
);
