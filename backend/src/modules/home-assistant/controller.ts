import { Elysia } from "elysia";
import { requirePermission } from "@/core/http/guards";
import { sessionPlugin } from "@/core/http/session-plugin";
import type { Services } from "@/services";
import { homeAssistantService } from "./service";

export const homeAssistantController = ({ auth, households }: Services) =>
  new Elysia({ name: "module.home-assistant", prefix: "/ha", tags: ["home-assistant"] })
    .use(sessionPlugin(auth, households))
    .get("/connection", (ctx) => {
      const { membership } = requirePermission(ctx, "ha.manage");
      return { connections: homeAssistantService.statuses().filter((c) => c.householdId === membership.householdId) };
    }, { detail: { summary: "Home Assistant connection status for this household" } });
