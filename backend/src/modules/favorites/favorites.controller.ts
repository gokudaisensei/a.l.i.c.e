import { Elysia, t } from "elysia";
import { requirePermission } from "../../core/http/guards";
import { sessionPlugin } from "../../core/http/session-plugin";
import type { Services } from "../../services";

export const favoritesController = ({ auth, households, devices }: Services) =>
  new Elysia({ name: "module.favorites", prefix: "/favorites", tags: ["favorites"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => {
      const { membership, session } = requirePermission(ctx, "device.view");
      return { devices: devices.favoriteList({ householdId: membership.householdId, userId: session.userId, role: membership.role, steppedUp: session.steppedUp }) };
    }, { detail: { summary: "Your favorite devices, in your order" } })
    .put("/", (ctx) => {
      const { membership, session } = requirePermission(ctx, "device.view");
      return { devices: devices.setFavorites({ householdId: membership.householdId, userId: session.userId, role: membership.role, steppedUp: session.steppedUp }, ctx.body.thingIds) };
    }, { body: t.Object({ thingIds: t.Array(t.String(), { maxItems: 50 }) }), detail: { summary: "Replace your favorites with these devices, in this order" } });
