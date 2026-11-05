import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { alerts } from "@/core/database/schema";
import { notFound } from "@/core/errors/errors";
import type { AppEvent } from "@/core/events/app-events";
import type { EventBus, Unsubscribe } from "@/core/events/event-bus";
import { newId } from "@/core/ids";
import type { Caller, DevicesService } from "../devices/devices.service";
import { powerLimitOf } from "../devices/settings";
import type { ThingsService } from "../home-assistant/things/things.service";
import type { NotificationsService } from "./notifications.service";

/** Raise at this share of the limit, clear below the lower one, so a device hovering at the limit does not flap. */
export const RAISE_AT = 0.9;
export const CLEAR_BELOW = 0.85;

export interface AlertView {
  id: string;
  kind: "power_limit";
  title: string;
  detail: string;
  thingId: string | null;
  thingName: string | null;
  data: Record<string, unknown> | null;
  createdAt: number;
  clearedAt: number | null;
  ackedAt: number | null;
}

const toWatts = (value: number, unit: unknown) => (unit === "kW" ? value * 1000 : unit === "mW" ? value / 1000 : value);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * Watches power readings against each device's power limit. A device at 90% of its limit raises an alert (and a
 * notification to the household's members); it clears when usage falls back under 85%.
 */
export class AlertsService {
  private unsubs: Unsubscribe[] = [];

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus<AppEvent>,
    private readonly things: ThingsService,
    private readonly notifications: NotificationsService,
    private readonly devices: DevicesService,
    private readonly now: () => number = Date.now,
  ) {}

  start() {
    this.unsubs.push(
      this.bus.subscribe("entity.state_changed", (e) => { if ((e.normalized.sensor as { deviceClass?: string } | undefined)?.deviceClass === "power") this.evaluate(e.householdId, e.connectionId, e.entityId); }),
      // A changed limit applies straight away, using the latest reading.
      this.bus.subscribe("settings.changed", (e) => this.evaluateThingOf(e.householdId, e.connectionId, e.entityId)),
    );
  }

  stop() {
    for (const u of this.unsubs.splice(0)) u();
  }

  private limitFor(connectionId: string, entityIds: string[]): number | null {
    return powerLimitOf(this.db, connectionId, entityIds);
  }

  /** Every power sensor of the device that `entityId` belongs to. */
  private evaluateThingOf(householdId: string, connectionId: string, entityId: string) {
    const found = this.things.findEntity(householdId, entityId);
    if (!found?.thing) return;
    let any = false;
    for (const id of found.thing.entityIds) {
      const p = found.conn.cache.get(id);
      if ((p?.normalized.sensor as { deviceClass?: string } | undefined)?.deviceClass === "power") { any = true; this.evaluate(householdId, connectionId, id); }
    }
    if (!any) this.clearFor(householdId, found.thing.ref, connectionId); // no power sensor to watch
  }

  private clearFor(householdId: string, thingRef: string, connectionId: string) {
    for (const a of this.db.select().from(alerts).where(and(eq(alerts.householdId, householdId), eq(alerts.connectionId, connectionId), eq(alerts.thingRef, thingRef), isNull(alerts.clearedAt))).all()) this.clear(a.id, householdId);
  }

  private clear(alertId: string, householdId: string) {
    this.db.update(alerts).set({ clearedAt: this.now() }).where(eq(alerts.id, alertId)).run();
    this.bus.publish({ type: "alert.cleared", householdId, alertId, timestamp: new Date(this.now()).toISOString() });
  }

  /** Compares one power sensor's latest reading with its device's limit. */
  evaluate(householdId: string, connectionId: string, entityId: string) {
    const found = this.things.findEntity(householdId, entityId);
    const proj = found?.conn.cache.get(entityId);
    const sensor = proj?.normalized.sensor as { value?: unknown; unit?: unknown; deviceClass?: string } | undefined;
    if (!found?.thing || sensor?.deviceClass !== "power") return;
    const thing = found.thing;
    const active = this.db.select().from(alerts).where(and(eq(alerts.householdId, householdId), eq(alerts.connectionId, connectionId), eq(alerts.thingRef, thing.ref), eq(alerts.kind, "power_limit"), isNull(alerts.clearedAt))).get();
    const limit = this.limitFor(connectionId, [...(thing.primary ? [thing.primary.entityId] : []), entityId]);
    if (!limit) { if (active) this.clear(active.id, householdId); return; }
    if (typeof sensor.value !== "number") return; // unknown or unavailable: say nothing
    const watts = toWatts(sensor.value, sensor.unit);
    const ratio = watts / limit;
    const data = { watts: Math.round(watts), limitW: limit, percent: Math.round(ratio * 100) };

    if (active) {
      if (ratio < CLEAR_BELOW) this.clear(active.id, householdId);
      else this.db.update(alerts).set({ data }).where(eq(alerts.id, active.id)).run();
      return;
    }
    if (ratio < RAISE_AT) return;
    const title = `${thing.name} is at ${data.percent}% of its ${fmt(limit)} W limit`;
    const detail = `${thing.name} is using ${fmt(watts)} W. You can raise its limit in the device's settings.`;
    const id = newId("alr");
    this.db.insert(alerts).values({ id, householdId, kind: "power_limit", connectionId, entityId, thingRef: thing.ref, title, detail, data, createdAt: this.now() }).run();
    this.bus.publish({ type: "alert.created", householdId, alertId: id, timestamp: new Date(this.now()).toISOString() });
    this.notifications.notifyHousehold(householdId, { kind: "power_limit", title, body: detail, data: { alertId: id, thingId: thing.id } });
  }

  /** The alert as this person may see it, or null if it is about a device they cannot see. */
  viewFor(c: Caller, alertId: string): AlertView | null {
    const a = this.db.select().from(alerts).where(eq(alerts.id, alertId)).get();
    if (!a || a.householdId !== c.householdId) return null;
    const found = this.things.findByRef(c.householdId, a.connectionId, a.thingRef);
    let name: string | null = null;
    let thingId: string | null = null;
    if (found) {
      try {
        const v = this.devices.get(c, found.thing.id);
        if (!v.primary) return null; // the limit belongs to the main entity: if that is hidden from them, so is the alert
        name = v.name;
        thingId = found.thing.id;
      } catch { return null; } // not theirs to see
    } else if (c.role !== "admin") return null; // the device is gone: only admins still see the leftover alert
    return { id: a.id, kind: a.kind, title: a.title, detail: a.detail, thingId, thingName: name, data: a.data, createdAt: a.createdAt, clearedAt: a.clearedAt, ackedAt: a.ackedAt };
  }

  list(c: Caller, o: { includeCleared?: boolean } = {}): AlertView[] {
    const rows = this.db.select().from(alerts).where(and(eq(alerts.householdId, c.householdId), o.includeCleared ? undefined : isNull(alerts.clearedAt))).orderBy(desc(alerts.createdAt)).limit(200).all();
    return rows.map((r) => this.viewFor(c, r.id)).filter((v): v is AlertView => v !== null);
  }

  /** "I have seen this." It stays until the device is back under its limit. */
  ack(c: Caller, alertId: string): AlertView {
    const v = this.viewFor(c, alertId);
    if (!v) throw notFound("Alert");
    this.db.update(alerts).set({ ackedBy: c.userId, ackedAt: this.now() }).where(eq(alerts.id, alertId)).run();
    return this.viewFor(c, alertId)!;
  }
}
