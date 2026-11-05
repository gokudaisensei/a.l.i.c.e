import { Elysia } from "elysia";
import { requirePermission } from "@/core/http/guards";
import { sessionPlugin } from "@/core/http/session-plugin";
import type { Services } from "@/services";

export const administrationController = ({ auth, households, configJobs, sync }: Services) =>
  new Elysia({ name: "module.administration", prefix: "/admin", tags: ["administration"] })
    .use(sessionPlugin(auth, households))
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
    }, { detail: { summary: "Queue everything that is not in Home Assistant yet or failed to get there" } });
