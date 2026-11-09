import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { Db } from "../../core/database/client";
import { activityEvents, activityReads, alerts, automations, users } from "../../core/database/schema";
import type { AppEvent } from "../../core/events/app-events";
import type { EventBus, Unsubscribe } from "../../core/events/event-bus";
import { newId } from "../../core/ids";
import { describeDoneAction } from "../devices/describe";
import type { Caller } from "../devices/devices.service";
import type { ThingsService } from "../home-assistant/things/things.service";
import type { HouseholdService } from "../households/household.service";
import { evaluateDeviceAccess } from "../permissions/device-access";
import type { PermissionService } from "../permissions/permission.service";
import { can } from "../permissions/permissions";

export type ActivityKind = (typeof activityEvents.$inferSelect)["kind"];

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  summary: string;
  tone: "info" | "warn";
  actor: { id: string; name: string } | null;
  thingId: string | null;
  at: number;
  /** Newer than the last time this person looked. */
  new: boolean;
}

const RETENTION_MS = 90 * 24 * 3_600_000;
const MAX_CONTEXTS = 500;

/**
 * The household timeline: who did what, what ran, who came and went, what was raised. Written as events happen and shown
 * only to people who may see the device an entry is about. It is a log for people, not an audit trail (see the audit log).
 */
export class ActivityService {
  private unsubs: Unsubscribe[] = [];
  /** Home Assistant context ids of commands Alice sent, so a lock that changed because of one is not logged twice. */
  private ours = new Map<string, true>();
  /** Commands on their way to a device. Home Assistant reports the change before it replies to the call, so the context id alone arrives too late. */
  private inFlight = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus<AppEvent>,
    private readonly things: ThingsService,
    private readonly households: HouseholdService,
    private readonly permissions: PermissionService,
    private readonly now: () => number = Date.now,
  ) {}

  start() {
    const b = this.bus;
    this.unsubs.push(
      b.subscribeAll((e) => {
        if (e.type === "command.dispatched") {
          this.inFlight.set(e.command.entityId, (this.inFlight.get(e.command.entityId) ?? 0) + 1);
        } else if (e.type === "command.failed" || e.type === "command.timed_out" || e.type === "command.cancelled") {
          this.endFlight(e.command.entityId);
        } else if (e.type === "command.accepted") {
          if (!e.command.haContextId) return;
          this.ours.set(e.command.haContextId, true);
          if (this.ours.size > MAX_CONTEXTS) this.ours.delete(this.ours.keys().next().value!);
        } else if (e.type === "command.confirmed") {
          const c = e.command;
          this.endFlight(c.entityId);
          if (c.confirmedBy === "already" || (c.source !== "user" && c.source !== "ai")) return;
          this.record(c.householdId, { kind: "device", actor: c.requestedBy, connectionId: c.connectionId, entityId: c.entityId, summary: describeDoneAction(c.action, c.parameters, this.deviceName(c.householdId, c.entityId)), data: { action: c.action } });
        } else if (e.type === "alert.created") {
          const a = this.db.select().from(alerts).where(eq(alerts.id, e.alertId)).get();
          if (a) this.record(e.householdId, { kind: "alert", actor: null, connectionId: a.connectionId, entityId: a.entityId, summary: a.title, tone: "warn" });
        }
      }),
      // A door that locked or unlocked by hand or from another app. (Ones Alice sent are in the entry above.)
      b.subscribe("entity.state_changed", (e) => {
        if (!e.entityId.startsWith("lock.") || e.previousState === null || e.previousState === e.currentState || this.ours.has(e.context.id) || (this.inFlight.get(e.entityId) ?? 0) > 0) return;
        if (e.currentState !== "locked" && e.currentState !== "unlocked") return;
        this.record(e.householdId, { kind: "lock", actor: null, connectionId: e.connectionId, entityId: e.entityId, summary: `${this.deviceName(e.householdId, e.entityId)} ${e.currentState}`, tone: e.currentState === "unlocked" ? "warn" : "info" });
      }),
      b.subscribe("scene.activated", (e) => this.record(e.householdId, { kind: "scene", actor: e.userId, summary: `ran the “${e.sceneName}” scene` })),
      b.subscribe("routine.finished", (e) => {
        if (e.state === "cancelled") return;
        this.record(e.householdId, { kind: "routine", actor: e.userId, summary: e.state === "completed" ? `ran the “${e.routineName}” routine` : `ran the “${e.routineName}” routine, but not everything worked`, tone: e.state === "completed" ? "info" : "warn" });
      }),
      b.subscribe("household.mode_changed", (e) => this.record(e.householdId, { kind: "mode", actor: e.changedBy, summary: `switched to ${e.mode[0]!.toUpperCase()}${e.mode.slice(1)} mode` })),
      b.subscribe("presence.changed", (e) => {
        if (!e.userId) return; // a person nobody has linked to a member is not announced
        this.record(e.householdId, { kind: "presence", actor: e.userId, summary: e.home ? "got home" : "left" });
      }),
      b.subscribe("ha.automation_triggered", (e) => {
        const a = this.db.select({ name: automations.name }).from(automations).where(and(eq(automations.householdId, e.householdId), eq(automations.haEntityId, e.entityId))).get();
        if (a) this.record(e.householdId, { kind: "automation", actor: null, summary: `The “${a.name}” automation ran` });
      }),
    );
  }

  stop() {
    for (const u of this.unsubs.splice(0)) u();
  }

  private endFlight(entityId: string) {
    const n = (this.inFlight.get(entityId) ?? 1) - 1;
    if (n <= 0) this.inFlight.delete(entityId); else this.inFlight.set(entityId, n);
  }

  private deviceName(householdId: string, entityId: string) {
    return this.things.findEntity(householdId, entityId)?.thing?.name ?? entityId;
  }

  private record(householdId: string, e: { kind: ActivityKind; actor: string | null; connectionId?: string | null; entityId?: string | null; summary: string; tone?: "info" | "warn"; data?: Record<string, unknown> }) {
    const id = newId("act");
    this.db.insert(activityEvents).values({
      id, householdId, kind: e.kind, actorUserId: e.actor, connectionId: e.connectionId ?? null, entityId: e.entityId ?? null,
      summary: e.summary, tone: e.tone ?? "info", data: e.data ?? null, createdAt: this.now(),
    }).run();
    this.bus.publish({ type: "activity.recorded", householdId, eventId: id, timestamp: new Date(this.now()).toISOString() });
  }

  // ---- reading ----

  private canSee(c: Caller, policies: ReturnType<PermissionService["listPolicies"]>) {
    return (r: typeof activityEvents.$inferSelect) => {
      if (!r.entityId || !r.connectionId) return true; // not about one device
      if (!evaluateDeviceAccess({ role: c.role, userId: c.userId, connectionId: r.connectionId, entityId: r.entityId, policies: policies.filter((p) => p.entityId === r.entityId) }).allowed) return false;
      const found = this.things.findEntity(c.householdId, r.entityId);
      return !(found?.thing?.hidden && c.role !== "admin"); // devices an admin hid from lists stay out of the timeline for others
    };
  }

  private lastSeen(c: Caller) {
    return this.db.select().from(activityReads).where(and(eq(activityReads.userId, c.userId), eq(activityReads.householdId, c.householdId))).get()?.lastSeenAt ?? 0;
  }

  private item(r: typeof activityEvents.$inferSelect, seen: number, names: Map<string, string>): ActivityItem {
    const thing = r.entityId ? this.things.findEntity(r.householdId, r.entityId)?.thing : null;
    return {
      id: r.id, kind: r.kind, summary: r.summary, tone: r.tone, thingId: thing?.id ?? null, at: r.createdAt, new: r.createdAt > seen,
      actor: r.actorUserId ? { id: r.actorUserId, name: names.get(r.actorUserId) ?? "Someone" } : null,
    };
  }

  private names(rows: { actorUserId: string | null }[]) {
    const ids = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
    if (!ids.length) return new Map<string, string>();
    return new Map(this.db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, ids)).all().map((u) => [u.id, u.n]));
  }

  /** Newest first. `before` is the cursor from the previous page. */
  list(c: Caller, o: { limit?: number; before?: string; kind?: ActivityKind; thingId?: string } = {}): { items: ActivityItem[]; nextCursor: string | null; newCount: number } {
    if (!can(c.role, "activity.view")) return { items: [], nextCursor: null, newCount: 0 };
    const limit = Math.min(Math.max(o.limit ?? 30, 1), 100);
    const policies = this.permissions.listPolicies(c.householdId);
    const visible = this.canSee(c, policies);
    const thing = o.thingId ? this.things.find(c.householdId, o.thingId)?.thing : null;
    const entityIds = thing ? new Set(thing.entityIds) : null;
    const seen = this.lastSeen(c);

    const out: (typeof activityEvents.$inferSelect)[] = [];
    let cursor = o.before;
    let more = false;
    // Entries are filtered after reading, so keep reading pages until there are enough that this person may see.
    for (let guard = 0; guard < 20 && out.length <= limit; guard++) {
      let cond: ReturnType<typeof and> | undefined;
      if (cursor) { const [t, id] = cursor.split(":"); if (t && id) cond = or(lt(activityEvents.createdAt, Number(t)), and(eq(activityEvents.createdAt, Number(t)), lt(activityEvents.id, id))); }
      const rows = this.db.select().from(activityEvents).where(and(eq(activityEvents.householdId, c.householdId), o.kind ? eq(activityEvents.kind, o.kind) : undefined, cond))
        .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id)).limit(100).all();
      if (!rows.length) break;
      for (const r of rows) if (visible(r) && (!entityIds || (r.entityId !== null && entityIds.has(r.entityId)))) out.push(r);
      cursor = `${rows.at(-1)!.createdAt}:${rows.at(-1)!.id}`;
      if (rows.length < 100) break;
      more = true;
    }
    const page = out.slice(0, limit);
    const names = this.names(page);
    const hasMore = out.length > limit || (more && out.length === limit);
    return {
      items: page.map((r) => this.item(r, seen, names)),
      nextCursor: hasMore && page.length ? `${page.at(-1)!.createdAt}:${page.at(-1)!.id}` : null,
      newCount: this.newCount(c, visible, seen),
    };
  }

  private newCount(c: Caller, visible: (r: typeof activityEvents.$inferSelect) => boolean, seen: number) {
    return this.db.select().from(activityEvents).where(and(eq(activityEvents.householdId, c.householdId), lt(activityEvents.createdAt, Number.MAX_SAFE_INTEGER)))
      .orderBy(desc(activityEvents.createdAt)).limit(500).all().filter((r) => r.createdAt > seen && visible(r)).length;
  }

  /** One entry as this person may see it, or null. */
  viewFor(c: Caller, eventId: string): ActivityItem | null {
    if (!can(c.role, "activity.view")) return null;
    const r = this.db.select().from(activityEvents).where(eq(activityEvents.id, eventId)).get();
    if (!r || r.householdId !== c.householdId || !this.canSee(c, this.permissions.listPolicies(c.householdId))(r)) return null;
    return this.item(r, this.lastSeen(c), this.names([r]));
  }

  /** "I have looked": clears the new count. */
  markSeen(c: Caller) {
    const t = this.now();
    this.db.insert(activityReads).values({ userId: c.userId, householdId: c.householdId, lastSeenAt: t }).onConflictDoUpdate({ target: [activityReads.userId, activityReads.householdId], set: { lastSeenAt: t } }).run();
  }

  /** Old entries are not kept forever. Call at startup and now and then. */
  prune(): number {
    return this.db.delete(activityEvents).where(lt(activityEvents.createdAt, this.now() - RETENTION_MS)).returning({ id: activityEvents.id }).all().length;
  }
}
