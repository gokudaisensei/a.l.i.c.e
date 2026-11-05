import { Elysia } from "elysia";
import { homeAssistantService } from "./service";

export const homeAssistantController = new Elysia({ name: "module.home-assistant", prefix: "/home-assistant", tags: ["home-assistant"] }).get(
  "/connections",
  () => ({ connections: homeAssistantService.statuses() }),
  { detail: { summary: "Connection status for each Home Assistant instance (temporary; will move behind admin auth)" } },
);
