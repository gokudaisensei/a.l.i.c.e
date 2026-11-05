import { Elysia, t } from "elysia";
import { requirePermission } from "@/core/http/guards";
import { sessionPlugin } from "@/core/http/session-plugin";
import type { Services } from "@/services";

export const historyController = ({ auth, households, history }: Services) =>
  new Elysia({ name: "module.history", prefix: "/history", tags: ["history"] })
    .use(sessionPlugin(auth, households))
    .get("/devices/:id", async (ctx) => {
      const { membership, session } = requirePermission(ctx, "history.view");
      return history.device({ householdId: membership.householdId, userId: session.userId, role: membership.role, steppedUp: session.steppedUp }, ctx.params.id, ctx.query);
    }, {
      query: t.Object({ from: t.Optional(t.String()), to: t.Optional(t.String()), entityId: t.Optional(t.String()), maxPoints: t.Optional(t.Numeric({ minimum: 10, maximum: 1000 })) }),
      detail: { summary: "How a device's state changed over time (default: its main entity, the last 24 hours, at most 31 days)" },
    });
