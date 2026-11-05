import { Elysia } from "elysia";

export const areasController = new Elysia({ name: "module.areas", prefix: "/areas", tags: ["areas"] }).get(
  "/",
  () => ({ module: "areas", status: "not_implemented" as const }),
  { detail: { summary: "Room and area management" } },
);
