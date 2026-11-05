import { Elysia } from "elysia";

export const aiController = new Elysia({ name: "module.ai", prefix: "/ai", tags: ["ai"] }).get(
  "/",
  () => ({ module: "ai", status: "not_implemented" as const }),
  { detail: { summary: "Conversational control and planning" } },
);
