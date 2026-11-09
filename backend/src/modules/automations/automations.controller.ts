import { Elysia, t } from "elysia";
import { requirePermission, type RequestAuth } from "../../core/http/guards";
import { sessionPlugin } from "../../core/http/session-plugin";
import type { Caller } from "../devices/devices.service";
import type { Services } from "../../services";

const caller = (a: RequestAuth): Caller => {
  const { session, membership } = requirePermission(a, "automation.write");
  return { householdId: membership.householdId, userId: session.userId, role: membership.role, steppedUp: session.steppedUp };
};

const definition = t.Any();

export const automationsController = ({ auth, households, automations }: Services) =>
  new Elysia({ name: "module.automations", prefix: "/automations", tags: ["automations"] })
    .use(sessionPlugin(auth, households))
    .get("/", async (ctx) => ({ automations: await automations.list(caller(ctx)) }))
    .post("/", async (ctx) => automations.create(caller(ctx), ctx.body), {
      body: t.Object({ name: t.String(), enabled: t.Optional(t.Boolean()), definition }),
      detail: { summary: "Save an automation. It is checked, then compiled into a Home Assistant automation" },
    })
    // static paths before /:id
    .post("/preview", async (ctx) => automations.preview(caller(ctx), ctx.body.name ?? "Preview", ctx.body.definition), {
      body: t.Object({ name: t.Optional(t.String()), definition }),
      detail: { summary: "Dry run for an unsaved automation: the plain-language summary, what Home Assistant would get, and warnings. Changes nothing" },
    })
    .get("/:id", async (ctx) => automations.get(caller(ctx), ctx.params.id))
    .patch("/:id", async (ctx) => automations.update(caller(ctx), ctx.params.id, ctx.body), { body: t.Object({ name: t.Optional(t.String()), enabled: t.Optional(t.Boolean()), definition: t.Optional(definition) }) })
    .delete("/:id", (ctx) => { automations.remove(caller(ctx), ctx.params.id); return { ok: true }; })
    .post("/:id/enable", async (ctx) => automations.setEnabled(caller(ctx), ctx.params.id, true))
    .post("/:id/disable", async (ctx) => automations.setEnabled(caller(ctx), ctx.params.id, false))
    .post("/:id/test", async (ctx) => {
      const c = caller(ctx);
      const a = await automations.get(c, ctx.params.id);
      return automations.preview(c, a.name, a.definition);
    }, { detail: { summary: "Dry run for a saved automation. Changes nothing" } })
    .get("/:id/runs", (ctx) => ({ runs: automations.runs(caller(ctx), ctx.params.id) }));
