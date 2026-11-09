import { Elysia, t } from "elysia";
import { requirePermission, type RequestAuth } from "../../core/http/guards";
import { sessionPlugin } from "../../core/http/session-plugin";
import { toPublicCommand } from "../devices/commands/public-command";
import type { Caller } from "../devices/devices.service";
import type { Services } from "../../services";

type Perm = Parameters<typeof requirePermission>[1];
const caller = (a: RequestAuth, perm: Perm): Caller => {
  const { session, membership } = requirePermission(a, perm);
  return { householdId: membership.householdId, userId: session.userId, role: membership.role, steppedUp: session.steppedUp };
};

export const groupsController = ({ auth, households, groups }: Services) =>
  new Elysia({ name: "module.groups", prefix: "/groups", tags: ["groups"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => ({ groups: groups.list(caller(ctx, "device.view")) }))
    .post("/", (ctx) => groups.create(caller(ctx, "group.write"), ctx.body), {
      body: t.Object({ name: t.String(), icon: t.Optional(t.Nullable(t.String({ maxLength: 40 }))), thingIds: t.Array(t.String(), { maxItems: 100 }) }),
    })
    .get("/:id", (ctx) => groups.get(caller(ctx, "device.view"), ctx.params.id))
    .patch("/:id", (ctx) => groups.update(caller(ctx, "group.write"), ctx.params.id, ctx.body), {
      body: t.Object({ name: t.Optional(t.String()), icon: t.Optional(t.Nullable(t.String({ maxLength: 40 }))), thingIds: t.Optional(t.Array(t.String(), { maxItems: 100 })) }),
    })
    .delete("/:id", (ctx) => { groups.remove(caller(ctx, "group.write"), ctx.params.id); return { ok: true }; })
    .post("/:id/commands", (ctx) => {
      const r = groups.command(caller(ctx, "device.control"), ctx.params.id, ctx.body);
      ctx.set.status = 202;
      return { commands: r.commands.map(toPublicCommand), skipped: r.skipped };
    }, {
      body: t.Object({ action: t.String({ minLength: 1 }), parameters: t.Optional(t.Record(t.String(), t.Unknown())), target: t.Optional(t.Union([t.Literal("first"), t.Literal("all")])) }),
      detail: { summary: "Run one operation on every device in the group that supports it (as you). Each device uses its first supporting entity; target \"all\" uses every supporting entity" },
    });
