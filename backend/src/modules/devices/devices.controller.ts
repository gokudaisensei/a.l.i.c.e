import { Elysia, t } from "elysia";
import { AppError } from "@/core/errors/errors";
import { requireMember, requirePermission, requireStepUp, type RequestAuth } from "@/core/http/guards";
import { sessionPlugin } from "@/core/http/session-plugin";
import { COMMAND_STATES } from "./command-lifecycle";
import type { Services } from "@/services";
import { toPublicCommand } from "./commands/public-command";
import type { Caller } from "./devices.service";

const caller = (a: RequestAuth, perm: Parameters<typeof requirePermission>[1]): Caller & { session: NonNullable<RequestAuth["session"]> } => {
  const { session, membership } = requirePermission(a, perm);
  return { householdId: membership.householdId, userId: session.userId, role: membership.role, steppedUp: session.steppedUp, session };
};

const stateUnion = t.Union(COMMAND_STATES.map((s) => t.Literal(s)));

export const devicesController = ({ auth, households, devices, things, activity }: Services) =>
  new Elysia({ name: "module.devices", prefix: "/devices", tags: ["devices"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => ({ devices: devices.list(caller(ctx, "device.view"), { ...ctx.query, includeHidden: ctx.query.includeHidden === "true", favorite: ctx.query.favorite === "true" }) }), {
      query: t.Object({ area: t.Optional(t.String()), type: t.Optional(t.String()), q: t.Optional(t.String()), includeHidden: t.Optional(t.String()), favorite: t.Optional(t.String()) }),
      detail: { summary: "Things (one per physical device) with live values, filtered by what you may see" },
    })
    // static paths first
    .post("/merge", (ctx) => {
      const c = caller(ctx, "device.manage");
      requireStepUp(c.session);
      things.merge(c.householdId, c.userId, ctx.body.ids);
      return { ok: true };
    }, { body: t.Object({ ids: t.Array(t.String(), { minItems: 2 }) }) })
    .get("/:id", (ctx) => devices.get(caller(ctx, "device.view"), ctx.params.id, ctx.query.include === "diagnostics"), {
      query: t.Object({ include: t.Optional(t.String()) }),
    })
    .get("/:id/activity", (ctx) => {
      const c = caller(ctx, "device.view");
      devices.get(c, ctx.params.id); // 404 if the caller cannot see the device
      return activity.list(c, { ...ctx.query, thingId: ctx.params.id });
    }, { query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })), before: t.Optional(t.String()) }), detail: { summary: "What has happened to this device, newest first" } })
    .get("/:id/capabilities", (ctx) => devices.capabilities(caller(ctx, "device.view"), ctx.params.id))
    .patch("/:id/name", (ctx) => {
      const c = caller(ctx, "device.rename");
      devices.get(c, ctx.params.id); // 404 if the caller cannot see it
      things.rename(c.householdId, c.userId, ctx.params.id, ctx.body.name);
      return devices.get(c, ctx.params.id);
    }, { body: t.Object({ name: t.Nullable(t.String()) }) })
    .patch("/:id/settings", (ctx) => devices.updateSettings(caller(ctx, "device.manage"), ctx.params.id, ctx.body), {
      body: t.Object({ entityId: t.Optional(t.String()), powerLimitW: t.Optional(t.Nullable(t.Integer())), voiceExposed: t.Optional(t.Boolean()) }),
      detail: { summary: "Power limit (W) and voice exposure for a device's main entity. Admins only" },
    })
    .post("/:id/hide", (ctx) => { const c = caller(ctx, "device.manage"); things.setHidden(c.householdId, c.userId, ctx.params.id, true); return { ok: true }; })
    .post("/:id/unhide", (ctx) => { const c = caller(ctx, "device.manage"); things.setHidden(c.householdId, c.userId, ctx.params.id, false); return { ok: true }; })
    .post("/:id/split", (ctx) => {
      const c = caller(ctx, "device.manage");
      requireStepUp(c.session);
      things.split(c.householdId, c.userId, ctx.params.id, ctx.body.entityIds);
      return { ok: true };
    }, { body: t.Object({ entityIds: t.Array(t.String(), { minItems: 1 }) }) })
    .post("/:id/commands", (ctx) => {
      const c = caller(ctx, "device.control");
      const cmd = devices.command(c, ctx.params.id, ctx.body);
      ctx.set.status = 202;
      return toPublicCommand(cmd);
    }, {
      body: t.Object({ entityId: t.Optional(t.String()), action: t.String({ minLength: 1 }), parameters: t.Optional(t.Record(t.String(), t.Unknown())) }),
      detail: { summary: "Run an operation on a device. Returns 202 with the command; follow it with GET /commands/:id" },
    });

export const entitiesController = ({ auth, households, things }: Services) =>
  new Elysia({ name: "module.entities", prefix: "/entities", tags: ["devices"] })
    .use(sessionPlugin(auth, households))
    .put("/:entityId/role", (ctx) => {
      const c = caller(ctx, "device.manage");
      if (ctx.body.attachTo === undefined && ctx.body.role === undefined && ctx.body.onMeans === undefined && ctx.body.displayName === undefined && ctx.body.hidden === undefined) {
        throw new AppError(400, "validation_error", "Nothing to change");
      }
      things.setEntity(c.householdId, c.userId, ctx.params.entityId, ctx.body);
      return { ok: true };
    }, {
      body: t.Object({
        role: t.Optional(t.Union([t.Literal("primary"), t.Literal("control"), t.Literal("facet"), t.Literal("sensor"), t.Literal("diagnostic"), t.Literal("config")])),
        attachTo: t.Optional(t.Nullable(t.String())), onMeans: t.Optional(t.Nullable(t.String())),
        displayName: t.Optional(t.Nullable(t.String())), hidden: t.Optional(t.Nullable(t.Boolean())),
      }),
      detail: { summary: "Force an entity's role, attach a facet, or say what a facet means when \"on\" (e.g. closed)" },
    });

export const commandsController = ({ auth, households, devices }: Services) =>
  new Elysia({ name: "module.commands", prefix: "/commands", tags: ["devices"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => {
      const { membership, session } = requireMember(ctx);
      if (membership.role !== "admin") throw new AppError(403, "forbidden", "Admins only");
      return { commands: devices.listCommands({ householdId: membership.householdId, userId: session.userId, role: membership.role, steppedUp: session.steppedUp }, { state: ctx.query.state, limit: ctx.query.limit }).map(toPublicCommand) };
    }, { query: t.Object({ state: t.Optional(stateUnion), limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })) }) })
    .get("/:id", (ctx) => toPublicCommand(devices.getCommand(caller(ctx, "device.view"), ctx.params.id)))
    .post("/:id/cancel", (ctx) => toPublicCommand(devices.cancelCommand(caller(ctx, "device.control"), ctx.params.id)));

export const areasController = ({ auth, households, devices }: Services) =>
  new Elysia({ name: "module.areas", prefix: "/areas", tags: ["areas"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => ({ areas: devices.areas(caller(ctx, "device.view")) }))
    .get("/:id/devices", (ctx) => ({ devices: devices.list(caller(ctx, "device.view"), { area: ctx.params.id }) }));
