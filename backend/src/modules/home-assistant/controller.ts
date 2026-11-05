import { Elysia } from "elysia";

export const homeAssistantController = new Elysia({ name: "module.home-assistant", prefix: "/home-assistant", tags: ["home-assistant"] }).get(
  "/",
  () => ({ module: "home-assistant", status: "not_implemented" as const }),
  { detail: { summary: "Connections and synchronization" } },
);
