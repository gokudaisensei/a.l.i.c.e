import { Elysia, t } from "elysia";
import { requireMember } from "../../core/http/guards";
import { sessionPlugin } from "../../core/http/session-plugin";
import type { Services } from "../../services";

export const usersController = ({ auth, households, users, push }: Services) =>
  new Elysia({ name: "module.users", prefix: "/users", tags: ["users"] })
    .use(sessionPlugin(auth, households))
    .get("/me", (ctx) => {
      const { session, membership } = requireMember(ctx);
      const u = users.get(session.userId);
      return { id: u.id, displayName: u.displayName, avatarColor: u.avatarColor, locale: u.locale, role: membership.role };
    })
    .patch("/me", (ctx) => {
      const { session } = requireMember(ctx);
      const u = users.update(session.userId, ctx.body);
      return { id: u.id, displayName: u.displayName, avatarColor: u.avatarColor, locale: u.locale };
    }, { body: t.Object({ displayName: t.Optional(t.String()), avatarColor: t.Optional(t.Integer({ minimum: 1, maximum: 12 })), locale: t.Optional(t.String({ maxLength: 16 })) }) })
    .get("/me/preferences", (ctx) => users.getPreferences(requireMember(ctx).session.userId))
    .patch("/me/preferences", (ctx) => users.updatePreferences(requireMember(ctx).session.userId, ctx.body), {
      body: t.Object({
        quietHours: t.Optional(t.Nullable(t.Object({ enabled: t.Boolean(), from: t.Optional(t.String()), to: t.Optional(t.String()) }))),
        pushEnabled: t.Optional(t.Boolean()),
        extra: t.Optional(t.Nullable(t.Record(t.String(), t.Unknown()))),
      }),
    })
    // ---- devices that receive push notifications ----
    .get("/me/push-subscriptions", (ctx) => ({
      platforms: push.platforms(),
      vapidPublicKey: push.vapidPublicKey(),
      devices: push.list(requireMember(ctx).session.userId).map((d) => ({ id: d.id, platform: d.platform, label: d.label, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt })),
    }), { detail: { summary: "Your devices that get push notifications, and which push channels this server supports" } })
    .post("/me/push-subscriptions", (ctx) => {
      const d = push.register(requireMember(ctx).session.userId, ctx.body as never);
      return { id: d.id, platform: d.platform, label: d.label, createdAt: d.createdAt };
    }, {
      body: t.Union([
        t.Object({ platform: t.Literal("webpush"), token: t.String({ maxLength: 2048 }), keys: t.Object({ p256dh: t.String(), auth: t.String() }), label: t.Optional(t.String({ maxLength: 80 })) }),
        t.Object({ platform: t.Literal("fcm"), token: t.String({ maxLength: 4096 }), label: t.Optional(t.String({ maxLength: 80 })) }),
      ]),
      detail: { summary: "Register this browser (Web Push) or app (Firebase token) for push notifications" },
    })
    .delete("/me/push-subscriptions/:id", (ctx) => { push.unregister(requireMember(ctx).session.userId, ctx.params.id); return { ok: true }; })
    .post("/me/push-subscriptions/test", async (ctx) => push.sendTest(requireMember(ctx).session.userId), { detail: { summary: "Send a test notification to your devices" } });
