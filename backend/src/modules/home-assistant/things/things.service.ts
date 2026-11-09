import { and, eq } from "drizzle-orm";
import type { Db } from "../../../core/database/client";
import type { AppEvent } from "../../../core/events/app-events";
import type { EventBus } from "../../../core/events/event-bus";
import { entityOverrides, thingLinks, thingOverrides } from "../../../core/database/schema";
import { AppError, notFound } from "../../../core/errors/errors";
import { newId } from "../../../core/ids";
import { writeAudit } from "../../../core/security/audit";
import type { ConnectionManager, ManagedConnection } from "..";
import { buildThings } from "./thing-builder";
import type { EntityRole, Thing, ThingOverrides } from "./types";

export interface ConnectionThings {
  conn: ManagedConnection;
  things: Thing[];
  overrides: ThingOverrides;
}

/** Builds Things for a household from the live inventory plus the user's saved overrides. */
export class ThingsService {
  private cache = new Map<string, { key: string; value: ConnectionThings }>();
  private version = new Map<string, number>();

  constructor(private readonly db: Db, private readonly manager: ConnectionManager, private readonly now: () => number = Date.now, private readonly bus?: EventBus<AppEvent>) {}

  /** Overrides as the pure builder wants them, read from the database. */
  loadOverrides(connectionId: string): ThingOverrides {
    const things: NonNullable<ThingOverrides["things"]> = {};
    for (const r of this.db.select().from(thingOverrides).where(eq(thingOverrides.connectionId, connectionId)).all()) {
      things[r.ref] = { displayName: r.displayName, ...(r.hidden !== null ? { hidden: r.hidden } : {}), ...(r.areaId !== null ? { areaId: r.areaId } : {}) };
    }
    const entities: NonNullable<ThingOverrides["entities"]> = {};
    for (const r of this.db.select().from(entityOverrides).where(eq(entityOverrides.connectionId, connectionId)).all()) {
      entities[r.entityId] = {
        ...(r.role ? { role: r.role } : {}), ...(r.displayName ? { displayName: r.displayName } : {}), ...(r.attachTo ? { attachTo: r.attachTo } : {}),
        ...(r.hidden !== null ? { hidden: r.hidden } : {}), ...(r.onMeans ? { onMeans: r.onMeans } : {}),
      };
    }
    const links = this.db.select().from(thingLinks).where(eq(thingLinks.connectionId, connectionId)).all();
    return {
      things, entities,
      merges: links.filter((l) => l.kind === "merge" && l.refs).map((l) => l.refs!),
      splits: links.filter((l) => l.kind === "split" && l.entityId).map((l) => l.entityId!),
    };
  }

  /** Things for every connection of the household. Rebuilt only when the inventory or the overrides changed. */
  forHousehold(householdId: string): ConnectionThings[] {
    const out: ConnectionThings[] = [];
    for (const conn of this.manager.forHousehold(householdId)) {
      if (!conn.inventory) continue;
      const id = conn.config.id;
      const key = `${conn.inventory.syncedAt}|${this.version.get(id) ?? 0}`;
      const hit = this.cache.get(id);
      if (hit && hit.key === key) { out.push(hit.value); continue; }
      const overrides = this.loadOverrides(id);
      const value = { conn, things: buildThings(conn.inventory, id, overrides), overrides };
      this.cache.set(id, { key, value });
      out.push(value);
    }
    return out;
  }

  /** A Thing by its stable reference, for things stored by reference (alerts, favorites). */
  findByRef(householdId: string, connectionId: string, ref: string) {
    for (const ct of this.forHousehold(householdId)) {
      if (ct.conn.config.id !== connectionId) continue;
      const thing = ct.things.find((t) => t.ref === ref);
      if (thing) return { ...ct, thing };
    }
    return null;
  }

  find(householdId: string, thingId: string) {
    for (const ct of this.forHousehold(householdId)) {
      const thing = ct.things.find((t) => t.id === thingId);
      if (thing) return { ...ct, thing };
    }
    return null;
  }

  /** An entity of this household, with the connection it lives on and the Thing it belongs to. */
  findEntity(householdId: string, entityId: string) {
    for (const ct of this.forHousehold(householdId)) {
      const ent = ct.conn.inventory?.entities.find((e) => e.entityId === entityId);
      if (ent) return { conn: ct.conn, entity: ent, thing: ct.things.find((t) => t.entityIds.includes(entityId)) ?? null };
    }
    return null;
  }

  private invalidate(connectionId: string, householdId: string) {
    this.version.set(connectionId, (this.version.get(connectionId) ?? 0) + 1);
    this.bus?.publish({ type: "things.changed", householdId, connectionId, reason: "overrides", timestamp: new Date(this.now()).toISOString() });
  }

  private require(householdId: string, thingId: string) {
    const f = this.find(householdId, thingId);
    if (!f) throw notFound("Device");
    return f;
  }

  // ---- changes (each is an override that survives a resync) ----

  private upsertThing(householdId: string, userId: string, connectionId: string, ref: string, patch: { displayName?: string | null; hidden?: boolean | null }) {
    const t = this.now();
    this.db.insert(thingOverrides).values({ id: newId("tov"), householdId, connectionId, ref, updatedBy: userId, updatedAt: t, ...patch })
      .onConflictDoUpdate({ target: [thingOverrides.connectionId, thingOverrides.ref], set: { ...patch, updatedBy: userId, updatedAt: t } }).run();
    this.invalidate(connectionId, householdId);
  }

  rename(householdId: string, userId: string, thingId: string, name: string | null) {
    const f = this.require(householdId, thingId);
    const clean = name?.trim() || null;
    if (clean && clean.length > 80) throw new AppError(400, "validation_error", "Name is too long");
    this.upsertThing(householdId, userId, f.conn.config.id, f.thing.ref, { displayName: clean });
  }

  setHidden(householdId: string, userId: string, thingId: string, hidden: boolean) {
    const f = this.require(householdId, thingId);
    this.upsertThing(householdId, userId, f.conn.config.id, f.thing.ref, { hidden });
    writeAudit(this.db, { householdId, actorId: userId, action: hidden ? "devices.hidden" : "devices.unhidden", resource: thingId }, this.now());
  }

  merge(householdId: string, userId: string, thingIds: string[]) {
    const found = thingIds.map((id) => this.require(householdId, id));
    const connectionId = found[0]!.conn.config.id;
    if (found.some((f) => f.conn.config.id !== connectionId)) throw new AppError(400, "validation_error", "Devices from different Home Assistant connections cannot be merged");
    if (new Set(thingIds).size < 2) throw new AppError(400, "validation_error", "Pick at least two different devices");
    this.db.insert(thingLinks).values({ id: newId("lnk"), householdId, connectionId, kind: "merge", refs: found.map((f) => f.thing.ref), createdBy: userId, createdAt: this.now() }).run();
    this.invalidate(connectionId, householdId);
    writeAudit(this.db, { householdId, actorId: userId, action: "devices.merged", detail: { thingIds } }, this.now());
  }

  split(householdId: string, userId: string, thingId: string, entityIds: string[]) {
    const f = this.require(householdId, thingId);
    const bad = entityIds.find((e) => !f.thing.entityIds.includes(e));
    if (bad) throw new AppError(400, "validation_error", `${bad} is not part of ${f.thing.name}`);
    if (entityIds.length >= f.thing.entityIds.length) throw new AppError(400, "validation_error", "Leave at least one entity in the device");
    for (const entityId of entityIds) {
      this.db.insert(thingLinks).values({ id: newId("lnk"), householdId, connectionId: f.conn.config.id, kind: "split", entityId, createdBy: userId, createdAt: this.now() }).run();
    }
    this.invalidate(f.conn.config.id, householdId);
    writeAudit(this.db, { householdId, actorId: userId, action: "devices.split", resource: thingId, detail: { entityIds } }, this.now());
  }

  /** Force a role, attach a facet, say what a facet's "on" means, rename or hide an entity. */
  setEntity(householdId: string, userId: string, entityId: string, patch: { role?: EntityRole; attachTo?: string | null; onMeans?: string | null; displayName?: string | null; hidden?: boolean | null }) {
    let conn: ManagedConnection | undefined;
    for (const ct of this.forHousehold(householdId)) if (ct.things.some((t) => t.entityIds.includes(entityId))) conn = ct.conn;
    if (!conn) throw notFound("Entity");
    const t = this.now();
    const clean = { ...patch, ...(patch.onMeans !== undefined ? { onMeans: patch.onMeans?.trim().toLowerCase() || null } : {}) };
    this.db.insert(entityOverrides).values({ householdId, connectionId: conn.config.id, entityId, updatedBy: userId, updatedAt: t, ...clean })
      .onConflictDoUpdate({ target: [entityOverrides.connectionId, entityOverrides.entityId], set: { ...clean, updatedBy: userId, updatedAt: t } }).run();
    this.invalidate(conn.config.id, householdId);
    writeAudit(this.db, { householdId, actorId: userId, action: "devices.entity_overridden", resource: entityId, detail: clean }, t);
  }
}
