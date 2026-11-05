import { Elysia, t } from "elysia";
import { requireMember } from "@/core/http/guards";
import { sessionPlugin } from "@/core/http/session-plugin";
import type { Services } from "@/services";

export const usersController = ({ auth, households, users }: Services) =>
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
    });
