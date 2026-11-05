import { Elysia, t } from "elysia";
import { requirePermission, type RequestAuth } from "@/core/http/guards";
import { sessionPlugin } from "@/core/http/session-plugin";
import type { Caller } from "../devices/devices.service";
import type { Services } from "@/services";

const caller = (a: RequestAuth): Caller & { session: NonNullable<RequestAuth["session"]> } => {
  const { session, membership } = requirePermission(a, "notification.receive");
  return { householdId: membership.householdId, userId: session.userId, role: membership.role, steppedUp: session.steppedUp, session };
};

export const notificationsController = ({ auth, households, notifications }: Services) =>
  new Elysia({ name: "module.notifications", prefix: "/notifications", tags: ["notifications"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => {
      const c = caller(ctx);
      return { notifications: notifications.list(c.userId, { unread: ctx.query.unread === "true", limit: ctx.query.limit, before: ctx.query.before }), unread: notifications.unreadCount(c.userId) };
    }, { query: t.Object({ unread: t.Optional(t.String()), limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })), before: t.Optional(t.Numeric()) }) })
    .post("/read-all", (ctx) => ({ marked: notifications.markAllRead(caller(ctx).userId) }))
    .post("/:id/read", (ctx) => { notifications.markRead(caller(ctx).userId, ctx.params.id); return { ok: true }; });

export const alertsController = ({ auth, households, alerts }: Services) =>
  new Elysia({ name: "module.alerts", prefix: "/alerts", tags: ["notifications"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => ({ alerts: alerts.list(caller(ctx), { includeCleared: ctx.query.includeCleared === "true" }) }), { query: t.Object({ includeCleared: t.Optional(t.String()) }) })
    .post("/:id/ack", (ctx) => alerts.ack(caller(ctx), ctx.params.id));
