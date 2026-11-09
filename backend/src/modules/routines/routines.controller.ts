import { Elysia, t } from "elysia";
import { requirePermission, type RequestAuth } from "../../core/http/guards";
import { sessionPlugin } from "../../core/http/session-plugin";
import type { Caller } from "../devices/devices.service";
import type { Services } from "../../services";

type Perm = Parameters<typeof requirePermission>[1];
const caller = (a: RequestAuth, perm: Perm): Caller => {
  const { session, membership } = requirePermission(a, perm);
  return { householdId: membership.householdId, userId: session.userId, role: membership.role, steppedUp: session.steppedUp };
};

const step = t.Union([
  t.Object({ type: t.Literal("device"), entityId: t.String(), action: t.String({ minLength: 1 }), parameters: t.Optional(t.Record(t.String(), t.Unknown())) }),
  t.Object({ type: t.Literal("scene"), sceneId: t.String() }),
  t.Object({ type: t.Literal("mode"), mode: t.Union([t.Literal("home"), t.Literal("away"), t.Literal("night"), t.Literal("vacation")]) }),
  t.Object({ type: t.Literal("delay"), seconds: t.Number() }),
]);
const steps = t.Array(step, { minItems: 1, maxItems: 50 });
const onFailure = t.Union([t.Literal("continue"), t.Literal("stop")]);

export const routinesController = ({ auth, households, routines }: Services) =>
  new Elysia({ name: "module.routines", prefix: "/routines", tags: ["routines"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => ({ routines: routines.list(caller(ctx, "routine.run")) }))
    .post("/", async (ctx) => routines.create(caller(ctx, "routine.write"), ctx.body), {
      body: t.Object({ name: t.String(), icon: t.Optional(t.Nullable(t.String({ maxLength: 40 }))), steps, onFailure: t.Optional(onFailure) }),
    })
    // runs before /:id so "runs" is not read as an id
    .get("/runs", (ctx) => ({ runs: routines.listRuns(caller(ctx, "routine.run")) }))
    .get("/runs/:runId", (ctx) => routines.getRun(caller(ctx, "routine.run"), ctx.params.runId))
    .post("/runs/:runId/cancel", (ctx) => routines.cancel(caller(ctx, "routine.run"), ctx.params.runId))
    .get("/:id", (ctx) => routines.get(caller(ctx, "routine.run"), ctx.params.id))
    .patch("/:id", async (ctx) => routines.update(caller(ctx, "routine.write"), ctx.params.id, ctx.body), {
      body: t.Object({ name: t.Optional(t.String()), icon: t.Optional(t.Nullable(t.String({ maxLength: 40 }))), steps: t.Optional(steps), onFailure: t.Optional(onFailure) }),
    })
    .delete("/:id", (ctx) => { routines.remove(caller(ctx, "routine.write"), ctx.params.id); return { ok: true }; })
    .post("/:id/execute", (ctx) => {
      const run = routines.execute(caller(ctx, "routine.run"), ctx.params.id);
      ctx.set.status = 202;
      return run;
    }, { detail: { summary: "Run the routine's steps in order as you. Returns 202 with a run to follow at GET /routines/runs/:runId" } });
