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

const action = t.Object({ entityId: t.String(), action: t.String({ minLength: 1 }), parameters: t.Optional(t.Record(t.String(), t.Unknown())) });
const actions = t.Array(action, { minItems: 1, maxItems: 50 });

export const scenesController = ({ auth, households, scenes }: Services) =>
  new Elysia({ name: "module.scenes", prefix: "/scenes", tags: ["scenes"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => ({ scenes: scenes.list(caller(ctx, "scene.run")) }))
    .post("/", async (ctx) => scenes.create(caller(ctx, "scene.write"), ctx.body), {
      body: t.Object({ name: t.String(), icon: t.Optional(t.Nullable(t.String({ maxLength: 40 }))), description: t.Optional(t.Nullable(t.String({ maxLength: 200 }))), actions }),
    })
    .get("/:id", (ctx) => scenes.get(caller(ctx, "scene.run"), ctx.params.id))
    .patch("/:id", async (ctx) => scenes.update(caller(ctx, "scene.write"), ctx.params.id, ctx.body), {
      body: t.Object({ name: t.Optional(t.String()), icon: t.Optional(t.Nullable(t.String({ maxLength: 40 }))), description: t.Optional(t.Nullable(t.String({ maxLength: 200 }))), actions: t.Optional(actions) }),
    })
    .delete("/:id", (ctx) => { scenes.remove(caller(ctx, "scene.write"), ctx.params.id); return { ok: true }; })
    .post("/:id/activate", (ctx) => {
      const r = scenes.activate(caller(ctx, "scene.run"), ctx.params.id);
      ctx.set.status = 202;
      return { commands: r.commands.map(toPublicCommand), skipped: r.skipped };
    }, { detail: { summary: "Start every action of the scene as you. Returns 202 with the commands" } });
