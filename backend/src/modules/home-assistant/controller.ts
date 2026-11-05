import { Elysia, t } from "elysia";
import { requirePermission, requireStepUp } from "@/core/http/guards";
import { sessionPlugin } from "@/core/http/session-plugin";
import type { Services } from "@/services";

export const homeAssistantController = ({ auth, households, ha }: Services) =>
  new Elysia({ name: "module.home-assistant", prefix: "/ha", tags: ["home-assistant"] })
    .use(sessionPlugin(auth, households))
    .get("/connection", (ctx) => ha.get(requirePermission(ctx, "ha.manage").membership.householdId), {
      detail: { summary: "Connection status for this household (the token is never returned)" },
    })
    .put("/connection", async (ctx) => {
      const { membership, session } = requirePermission(ctx, "ha.manage");
      requireStepUp(session);
      return ha.save(membership.householdId, session.userId, ctx.body);
    }, {
      body: t.Object({ baseUrl: t.String(), token: t.String({ minLength: 10 }), name: t.Optional(t.String({ maxLength: 80 })) }),
      detail: { summary: "Set the Home Assistant URL and long-lived token. Tested first, stored encrypted" },
    })
    .put("/connection/admin-token", async (ctx) => {
      const { membership, session } = requirePermission(ctx, "ha.manage");
      requireStepUp(session);
      await ha.setAdminToken(membership.householdId, session.userId, ctx.body.token);
      return { ok: true };
    }, { body: t.Object({ token: t.String({ minLength: 10 }) }), detail: { summary: "Store the admin token used only by the config-worker" } })
    .post("/connection/test", async (ctx) => {
      requirePermission(ctx, "ha.manage");
      return ha.test(ctx.body);
    }, { body: t.Object({ baseUrl: t.String(), token: t.String({ minLength: 10 }) }), detail: { summary: "Try credentials without saving" } })
    .post("/connection/resync", async (ctx) => {
      await ha.resync(requirePermission(ctx, "ha.manage").membership.householdId);
      return ha.get(ctx.membership!.householdId);
    })
    .delete("/connection", async (ctx) => {
      const { membership, session } = requirePermission(ctx, "ha.manage");
      requireStepUp(session);
      await ha.remove(membership.householdId, session.userId);
      return { ok: true };
    });
