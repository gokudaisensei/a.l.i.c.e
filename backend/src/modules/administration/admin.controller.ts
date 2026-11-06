import { Elysia, t } from "elysia";
import { requirePermission, requireStepUp } from "@/core/http/guards";
import { sessionPlugin } from "@/core/http/session-plugin";
import type { Services } from "@/services";

export const administrationController = ({ auth, households, configJobs, sync, admin, support }: Services) =>
  new Elysia({ name: "module.administration", prefix: "/admin", tags: ["administration"] })
    .use(sessionPlugin(auth, households))
    .get("/health", (ctx) => admin.health(requirePermission(ctx, "admin.view").membership.householdId), { detail: { summary: "Is everything Alice depends on working? Database, Home Assistant, the config-worker, push" } })
    .get("/diagnostics", (ctx) => admin.diagnostics(requirePermission(ctx, "admin.view").membership.householdId), { detail: { summary: "Versions, what is configured and basic counts. Never includes secrets" } })
    .get("/audit", (ctx) => admin.audit(requirePermission(ctx, "admin.view").membership.householdId, ctx.query), {
      query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })), before: t.Optional(t.String()), action: t.Optional(t.String({ maxLength: 60 })) }),
      detail: { summary: "The security audit log, newest first, with a cursor for the next page" },
    })
    .get("/config-sync", (ctx) => {
      const { membership } = requirePermission(ctx, "admin.view");
      const s = configJobs.status(membership.householdId);
      return { ...s, canApply: s.connected && s.adminTokenSet && s.workerOnline, drifted: sync.driftedCount(membership.householdId) };
    }, { detail: { summary: "Whether scenes, routines and automations can be applied to Home Assistant, and what is waiting" } })
    .post("/config-sync/verify", (ctx) => {
      const { membership } = requirePermission(ctx, "ha.manage");
      return { queued: sync.verify(membership.householdId) };
    }, { detail: { summary: "Read back what Alice put in Home Assistant and mark anything that was edited or removed there as drifted" } })
    .post("/config-sync/resync", (ctx) => {
      const { membership, session } = requirePermission(ctx, "ha.manage");
      return { queued: sync.reconcile(membership.householdId, session.userId) };
    }, { detail: { summary: "Queue everything that is not in Home Assistant yet or failed to get there" } })
    // ---- support access ----
    .get("/support", (ctx) => {
      const { membership } = requirePermission(ctx, "security.manage");
      return { active: support.active(membership.householdId), history: support.history(membership.householdId), householdLog: support.householdLog(membership.householdId), operatorTrail: support.operatorTrail(membership.householdId) };
    }, { detail: { summary: "Whether support has access now, past grants, what the household sees in plain language, and what support itself did" } })
    .post("/support", (ctx) => {
      const { membership, session } = requirePermission(ctx, "security.manage");
      requireStepUp(session);
      return support.grant(membership.householdId, session.userId, ctx.body);
    }, {
      body: t.Object({ hours: t.Number({ minimum: 1, maximum: 24 }), scope: t.Object({ health: t.Optional(t.Boolean()), devices: t.Optional(t.Boolean()), cameras: t.Optional(t.Boolean()), control: t.Optional(t.Boolean()) }) }),
      detail: { summary: "Let support in for a set time and choose what they may see. Needs a recent passkey confirmation. Support can never unlock a door" },
    })
    .post("/support/:id/extend", (ctx) => {
      const { membership, session } = requirePermission(ctx, "security.manage");
      requireStepUp(session);
      return support.extend(membership.householdId, session.userId, ctx.params.id);
    }, { params: t.Object({ id: t.String() }), detail: { summary: "Add an hour (24 hours in total at most)" } })
    .post("/support/:id/end", (ctx) => {
      const { membership, session } = requirePermission(ctx, "security.manage");
      return support.end(membership.householdId, session.userId, ctx.params.id);
    }, { params: t.Object({ id: t.String() }), detail: { summary: "End support access now" } });
