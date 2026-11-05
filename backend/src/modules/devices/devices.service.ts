import type { Role } from "@/core/database/schema";
import { AppError, notFound } from "@/core/errors/errors";
import type { PermissionService } from "../permissions/permission.service";
import { evaluateDeviceAccess } from "../permissions/device-access";
import type { ThingsService } from "../home-assistant/things/things.service";
import { matchesQuery, presentThing, type ThingView } from "../home-assistant/things/presentation";
import { resolveThingTarget } from "../home-assistant/things/target";
import type { CommandExecutor } from "./commands/command-executor";
import type { DeviceCommand } from "./commands/command-types";

export interface Caller {
  householdId: string;
  userId: string;
  role: Role;
  /** Did the caller pass a fresh passkey step-up on this session? */
  steppedUp: boolean;
}

export interface DeviceFilter {
  area?: string;
  /** The primary entity's domain, e.g. "light" or "lock". */
  type?: string;
  q?: string;
  includeHidden?: boolean;
}

/** What callers see of the home: Things, filtered by what each person may see, plus device commands. */
export class DevicesService {
  constructor(private readonly things: ThingsService, private readonly permissions: PermissionService, private readonly executor: CommandExecutor) {}

  private canSee(c: Caller, connectionId: string) {
    const policies = this.permissions.listPolicies(c.householdId);
    return (entityId: string) => evaluateDeviceAccess({ role: c.role, userId: c.userId, connectionId, entityId, policies }).allowed;
  }

  list(c: Caller, f: DeviceFilter = {}): ThingView[] {
    const out: ThingView[] = [];
    for (const { conn, things, overrides } of this.things.forHousehold(c.householdId)) {
      const canSee = this.canSee(c, conn.config.id);
      for (const t of things) {
        if (t.hidden && !(f.includeHidden && c.role === "admin")) continue;
        if (f.area && t.areaId !== f.area) continue;
        if (f.type && t.primary?.domain !== f.type) continue;
        if (f.q && !matchesQuery(t, f.q)) continue;
        const v = presentThing(t, { lookup: (id) => conn.cache.get(id), canSee, overrides });
        if (v) out.push(v);
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A Thing the caller cannot see does not exist for them (404, never 403). */
  private visible(c: Caller, thingId: string, includeDiagnostics = false) {
    const f = this.things.find(c.householdId, thingId);
    if (!f) throw notFound("Device");
    const canSee = this.canSee(c, f.conn.config.id);
    const view = presentThing(f.thing, { lookup: (id) => f.conn.cache.get(id), canSee, overrides: f.overrides, includeDiagnostics: includeDiagnostics && c.role !== "guest" });
    if (!view || (f.thing.hidden && c.role !== "admin")) throw notFound("Device");
    return { ...f, view, canSee };
  }

  get(c: Caller, thingId: string, includeDiagnostics = false) {
    return this.visible(c, thingId, includeDiagnostics).view;
  }

  capabilities(c: Caller, thingId: string) {
    const v = this.visible(c, thingId).view;
    const all = [v.primary, ...v.others, ...v.controls, ...v.sensors].filter((e) => e !== null);
    return { entities: all.map((e) => ({ entityId: e.entityId, name: e.name, role: e.role, capabilities: e.capabilities })) };
  }

  areas(c: Caller) {
    const counts = new Map<string, number>();
    for (const t of this.list(c)) if (t.areaId) counts.set(t.areaId, (counts.get(t.areaId) ?? 0) + 1);
    const out: { id: string; name: string; deviceCount: number }[] = [];
    for (const { conn } of this.things.forHousehold(c.householdId)) {
      for (const a of conn.inventory?.areas ?? []) out.push({ id: a.areaId, name: a.name, deviceCount: counts.get(a.areaId) ?? 0 });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---- commands ----

  /** Starts a command on a Thing (the primary unless an entity of the Thing is named). Returns at once; follow it with GET /commands/:id. */
  command(c: Caller, thingId: string, body: { entityId?: string; action: string; parameters?: Record<string, unknown> }) {
    const { thing, canSee } = this.visible(c, thingId);
    const target = resolveThingTarget([thing], thingId, body.entityId);
    if (!target.ok) throw new AppError(target.code === "no_primary" ? 409 : 400, target.code, target.message);
    if (!canSee(target.entityId)) throw notFound("Device"); // an entity the caller cannot see is not there for them
    return this.executor.submit({
      householdId: c.householdId, entityId: target.entityId, action: body.action, parameters: body.parameters,
      actor: { userId: c.userId, source: "user", steppedUp: c.steppedUp },
    });
  }

  /** Commands are visible to whoever sent them, and to admins. */
  getCommand(c: Caller, id: string) {
    const cmd = this.executor.get(id);
    if (!cmd || cmd.householdId !== c.householdId || (c.role !== "admin" && cmd.requestedBy !== c.userId)) throw notFound("Command");
    return cmd;
  }

  cancelCommand(c: Caller, id: string) {
    this.getCommand(c, id);
    try { return this.executor.cancel(id); } catch (e) { throw new AppError(409, "conflict", e instanceof Error ? e.message : "Cannot cancel"); }
  }

  listCommands(c: Caller, f: { state?: DeviceCommand["state"]; limit?: number } = {}) {
    return this.executor.list({ householdId: c.householdId, state: f.state, limit: f.limit });
  }
}
