import { Elysia, t } from "elysia";
import { requirePermission, requireStepUp } from "../../core/http/guards";
import { sessionPlugin } from "../../core/http/session-plugin";
import type { Services } from "../../services";

export const updatesController = ({ auth, households, updates }: Services) =>
  new Elysia({ name: "module.updates", prefix: "/updates", tags: ["updates"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => updates.status(requirePermission(ctx, "update.manage").membership.householdId), {
      detail: { summary: "Current and available version, state (up_to_date, ready, scheduled, installing), the window and settings" },
    })
    .post("/check", (ctx) => updates.check(requirePermission(ctx, "update.manage").membership.householdId), { detail: { summary: "Ask the update source now" } })
    .get("/history", (ctx) => ({ items: updates.history(requirePermission(ctx, "update.manage").membership.householdId) }), { detail: { summary: "Past updates and how they ended" } })
    .put("/settings", (ctx) => {
      const { membership, session } = requirePermission(ctx, "update.manage");
      requireStepUp(session);
      return updates.updateSettings(membership.householdId, session.userId, ctx.body);
    }, {
      body: t.Object({ autoUpdate: t.Optional(t.Boolean()), windowStart: t.Optional(t.String({ maxLength: 5 })), windowEnd: t.Optional(t.String({ maxLength: 5 })) }),
      detail: { summary: "Switch automatic updates on or off and set the nightly window (default 02:00 to 04:00). Needs a recent passkey confirmation" },
    })
    .post("/schedule", (ctx) => {
      const { membership, session } = requirePermission(ctx, "update.manage");
      requireStepUp(session);
      return updates.schedule(membership.householdId, session.userId);
    }, { detail: { summary: "Install the available update in the next window" } })
    .post("/install", (ctx) => {
      const { membership, session } = requirePermission(ctx, "update.manage");
      requireStepUp(session);
      return updates.installNow(membership.householdId, session.userId);
    }, { detail: { summary: "Install now. Only inside the window; takes a safety backup first" } })
    .post("/emergency", (ctx) => {
      const { membership, session } = requirePermission(ctx, "update.manage");
      requireStepUp(session);
      return updates.emergency(membership.householdId, session.userId, ctx.body.reason, ctx.body.confirmation);
    }, {
      body: t.Object({ reason: t.String({ maxLength: 300 }), confirmation: t.String({ maxLength: 20 }) }),
      detail: { summary: "Install now, outside the window. Needs a reason (8+ characters), the word DEPLOY and a passkey confirmation; audited" },
    })
    .post("/:id/rollback", (ctx) => {
      const { membership, session } = requirePermission(ctx, "update.manage");
      requireStepUp(session);
      return updates.rollback(membership.householdId, session.userId, ctx.params.id, ctx.body.restoreData ?? false);
    }, {
      params: t.Object({ id: t.String({ maxLength: 60 }) }), body: t.Object({ restoreData: t.Optional(t.Boolean()) }),
      detail: { summary: "Go back to the version before a started update. restoreData also stages the safety backup of Alice's database (data since is lost). Needs a passkey confirmation" },
    })
    .post("/:id/cancel", (ctx) => {
      const { membership, session } = requirePermission(ctx, "update.manage");
      return updates.cancel(membership.householdId, session.userId, ctx.params.id);
    }, { params: t.Object({ id: t.String({ maxLength: 60 }) }), detail: { summary: "Cancel a scheduled update" } });
