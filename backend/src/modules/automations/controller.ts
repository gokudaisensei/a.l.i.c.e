import { Elysia } from "elysia";

export const automationsController = new Elysia({ name: "module.automations", prefix: "/automations", tags: ["automations"] }).get(
  "/",
  () => ({ module: "automations", status: "not_implemented" as const }),
  { detail: { summary: "Trigger/condition/action builder" } },
);
