import { Elysia } from "elysia";

export const scenesController = new Elysia({ name: "module.scenes", prefix: "/scenes", tags: ["scenes"] }).get(
  "/",
  () => ({ module: "scenes", status: "not_implemented" as const }),
  { detail: { summary: "Scene creation and activation" } },
);
