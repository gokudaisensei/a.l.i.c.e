import { and, eq, lt } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { entitySettings, idempotencyKeys, type Role } from "@/core/database/schema";
import { AppError, notFound } from "@/core/errors/errors";
import { writeAudit } from "@/core/security/audit";
import type { AppEvent } from "@/core/events/app-events";
import type { EventBus } from "@/core/events/event-bus";
import type { VoiceExposureService } from "./voice";
import type { FavoritesService } from "../favorites/favorites.service";
import type { PermissionService } from "../permissions/permission.service";
import { evaluateDeviceAccess } from "../permissions/device-access";
import type { ThingsService } from "../home-assistant/things/things.service";
import { matchesQuery, presentThing, type ThingView } from "../home-assistant/things/presentation";
import type { Thing } from "../home-assistant/things/types";
import { resolveThingTarget } from "../home-assistant/things/target";
import type { CommandExecutor } from "./commands/command-executor";
import type { DeviceCommand } from "./commands/command-types";
import { UNDO_WINDOW_MS, undoPlan } from "./commands/undo";
import { toPublicCommand } from "./commands/public-command";

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
  /** Only the caller's favorites, in their order. */
  favorite?: boolean;
}

/** What callers see of the home: Things, filtered by what each person may see, plus device commands. */
export class DevicesService {
  constructor(
    private readonly things: ThingsService,
    private readonly permissions: PermissionService,
    private readonly executor: CommandExecutor,
    private readonly db: Db,
    private readonly favorites: FavoritesService,
    private readonly now: () => number = Date.now,
    private readonly bus?: EventBus<AppEvent>,
    private readonly voice?: VoiceExposureService,
  ) {}

  private canSee(c: Caller, connectionId: string) {
    const policies = this.permissions.listPolicies(c.householdId);
    return (entityId: string) => evaluateDeviceAccess({ role: c.role, userId: c.userId, connectionId, entityId, policies }).allowed;
  }

  /** Favorite flag and application settings are per person / per entity, so they are added after the Thing is built. */
  private decorate(c: Caller, conn: { config: { id: string } }, thing: Thing, view: ThingView, favs: Set<string>): ThingView {
    const main = thing.primary ?? thing.others[0] ?? null;
    const row = main ? this.db.select().from(entitySettings).where(and(eq(entitySettings.connectionId, conn.config.id), eq(entitySettings.entityId, main.entityId))).get() : undefined;
    return { ...view, favorite: favs.has(thing.id), settings: { powerLimitW: row?.powerLimitW ?? null, voiceExposed: row?.voiceExposed ?? false, voiceSync: { status: row?.voiceSyncStatus ?? "none", error: row?.voiceSyncError ?? null } } };
  }

  list(c: Caller, f: DeviceFilter = {}): ThingView[] {
    const out: ThingView[] = [];
    const favIds = this.favorites.idsFor(c.householdId, c.userId);
    const favs = new Set(favIds);
    for (const { conn, things, overrides } of this.things.forHousehold(c.householdId)) {
      const canSee = this.canSee(c, conn.config.id);
      for (const t of things) {
        if (t.hidden && !(f.includeHidden && c.role === "admin")) continue;
        if (f.area && t.areaId !== f.area) continue;
        if (f.type && t.primary?.domain !== f.type) continue;
        if (f.q && !matchesQuery(t, f.q)) continue;
        if (f.favorite && !favs.has(t.id)) continue;
        const v = presentThing(t, { lookup: (id) => conn.cache.get(id), canSee, overrides });
        if (v) out.push(this.decorate(c, conn, t, v, favs));
      }
    }
    if (f.favorite) return out.sort((a, b) => favIds.indexOf(a.id) - favIds.indexOf(b.id));
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
    const v = this.visible(c, thingId, includeDiagnostics);
    return this.decorate(c, v.conn, v.thing, v.view, new Set(this.favorites.idsFor(c.householdId, c.userId)));
  }

  /** The caller's favorites, in their order (devices they can no longer see are left out). */
  favoriteList(c: Caller) {
    return this.list(c, { favorite: true });
  }

  /** Replaces the caller's favorites with these Things, in order. Every one must be visible to them. */
  setFavorites(c: Caller, thingIds: string[]) {
    const unique = [...new Set(thingIds)];
    if (unique.length > 50) throw new AppError(400, "validation_error", "At most 50 favorites");
    const items = unique.map((id) => {
      const { conn, thing } = this.visible(c, id);
      return { connectionId: conn.config.id, ref: thing.ref };
    });
    this.favorites.save(c.userId, items);
    return this.favoriteList(c);
  }

  /** Power limit and voice exposure for a device's main entity (or a named one). Admin-only, checked by the route. */
  updateSettings(c: Caller, thingId: string, body: { entityId?: string; powerLimitW?: number | null; voiceExposed?: boolean }) {
    const { thing, conn } = this.visible(c, thingId);
    const target = resolveThingTarget([thing], thingId, body.entityId);
    if (!target.ok) throw new AppError(target.code === "no_primary" ? 409 : 400, target.code, target.message);
    if (body.powerLimitW !== undefined && body.powerLimitW !== null && (!Number.isInteger(body.powerLimitW) || body.powerLimitW < 1 || body.powerLimitW > 100_000)) {
      throw new AppError(400, "validation_error", "Power limit must be a whole number of watts between 1 and 100000");
    }
    const patch = { ...(body.powerLimitW !== undefined ? { powerLimitW: body.powerLimitW } : {}), ...(body.voiceExposed !== undefined ? { voiceExposed: body.voiceExposed } : {}) };
    if (!Object.keys(patch).length) throw new AppError(400, "validation_error", "Nothing to change");
    const t = this.now();
    this.db.insert(entitySettings).values({ connectionId: conn.config.id, entityId: target.entityId, householdId: c.householdId, updatedAt: t, ...patch })
      .onConflictDoUpdate({ target: [entitySettings.connectionId, entitySettings.entityId], set: { ...patch, updatedAt: t } }).run();
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "devices.settings_changed", resource: target.entityId, detail: patch }, t);
    if (body.voiceExposed !== undefined) this.voice?.push(c.householdId, conn.config.id, target.entityId, body.voiceExposed, c.userId);
    this.bus?.publish({ type: "settings.changed", householdId: c.householdId, connectionId: conn.config.id, entityId: target.entityId, timestamp: new Date(t).toISOString() });
    return this.get(c, thingId);
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

  /**
   * Sends a command, once per `key`. The same person using the same key again for the same request gets the command they
   * already made (so a double tap or a retry does nothing twice); the same key for something different is refused.
   */
  commandOnce(c: Caller, thingId: string, body: { entityId?: string; action: string; parameters?: Record<string, unknown> }, key: string | null): { cmd: DeviceCommand; replay: boolean } {
    if (!key) return { cmd: this.command(c, thingId, body), replay: false };
    if (!/^[A-Za-z0-9_\-:.]{8,80}$/.test(key)) throw new AppError(400, "validation_error", "The idempotency key must be 8 to 80 letters, digits or - _ : .");
    const fingerprint = JSON.stringify([thingId, body.entityId ?? null, body.action, body.parameters ?? {}]);
    const hit = this.db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.userId, c.userId), eq(idempotencyKeys.key, key))).get();
    if (hit) {
      if (hit.fingerprint !== fingerprint) throw new AppError(422, "idempotency_key_reuse", "That key was already used for a different request");
      const cmd = this.executor.get(hit.commandId);
      if (cmd) return { cmd, replay: true };
    }
    const cmd = this.command(c, thingId, body);
    const t = this.now();
    this.db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, t - 24 * 3_600_000)).run();
    this.db.insert(idempotencyKeys).values({ userId: c.userId, key, fingerprint, commandId: cmd.id, createdAt: t }).onConflictDoUpdate({ target: [idempotencyKeys.userId, idempotencyKeys.key], set: { fingerprint, commandId: cmd.id, createdAt: t } }).run();
    return { cmd, replay: false };
  }

  /** Puts back what a finished command changed: once, within ten minutes, by whoever sent it (or an admin). */
  undoCommand(c: Caller, id: string): DeviceCommand {
    const cmd = this.getCommand(c, id);
    if (cmd.undoneBy) throw new AppError(409, "already_undone", "That was already put back");
    if (cmd.undoOf) throw new AppError(409, "not_undoable", "An undo cannot be undone; just do it again");
    if (cmd.finishedAt === null || this.now() - cmd.finishedAt > UNDO_WINDOW_MS) throw new AppError(409, "undo_expired", "It is too late to undo that");
    const plan = undoPlan(cmd);
    if (!plan) throw new AppError(409, "not_undoable", "That can't be put back automatically");
    const found = this.things.findEntity(c.householdId, cmd.entityId);
    if (!found?.thing) throw new AppError(409, "not_undoable", "That device is not there any more");
    const back = this.executor.submit({
      householdId: c.householdId, entityId: cmd.entityId, action: plan.action, parameters: plan.parameters, undoOf: cmd.id,
      actor: { userId: c.userId, source: "user", steppedUp: c.steppedUp },
    });
    this.executor.setUndoneBy(cmd.id, back.id);
    return back;
  }

  /** A command as clients see it, judged by this server's clock. */
  publicCommand(c: DeviceCommand) { return toPublicCommand(c, this.now()); }

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
