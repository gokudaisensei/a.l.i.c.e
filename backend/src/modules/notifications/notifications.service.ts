import { and, desc, eq, isNull, lt } from "drizzle-orm";
import type { Db } from "../../core/database/client";
import { notifications } from "../../core/database/schema";
import { notFound } from "../../core/errors/errors";
import type { AppEvent } from "../../core/events/app-events";
import type { EventBus, Unsubscribe } from "../../core/events/event-bus";
import { newId } from "../../core/ids";
import type { HouseholdService } from "../households/household.service";
import { can } from "../permissions/permissions";

export interface NotificationView {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  createdAt: number;
  readAt: number | null;
}

export interface NewNotification {
  kind: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  /** Pushed to phones even during quiet hours. */
  urgent?: boolean;
}

const view = (r: typeof notifications.$inferSelect): NotificationView => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, data: r.data, createdAt: r.createdAt, readAt: r.readAt });

/** In-app notifications. Delivery to a phone's push service is a later step; this stores them and pushes them over `/ws`. */
export class NotificationsService {
  private unsub: Unsubscribe | null = null;
  private pushHook: ((n: { id: string; householdId: string; userId: string; kind: string; title: string; body: string; urgent: boolean }) => void) | null = null;

  constructor(private readonly db: Db, private readonly bus: EventBus<AppEvent>, private readonly households: HouseholdService, private readonly now: () => number = Date.now) {}

  /** Called for every stored notification so it can also be pushed to the person's devices. */
  onCreated(fn: NonNullable<NotificationsService["pushHook"]>) {
    this.pushHook = fn;
  }

  /** Alice automations send notifications through Home Assistant (an `alice_notification` event); they arrive here. */
  start() {
    this.unsub = this.bus.subscribe("ha.notification", (e) => {
      const members = this.recipients(e.householdId);
      const wanted = e.userIds ? members.filter((m) => e.userIds!.includes(m)) : members;
      for (const userId of wanted) this.notify(e.householdId, userId, { kind: "automation", title: e.title, body: e.message });
    });
  }

  stop() {
    this.unsub?.();
    this.unsub = null;
  }

  /** People who currently belong to the household and may receive notifications (not guests, not expired). */
  recipients(householdId: string): string[] {
    return this.households.listMembers(householdId).filter((m) => !m.expired && can(m.role, "notification.receive")).map((m) => m.userId);
  }

  notify(householdId: string, userId: string, n: NewNotification): NotificationView {
    const row = { id: newId("ntf"), householdId, userId, kind: n.kind, title: n.title.slice(0, 100), body: n.body.slice(0, 500), data: n.data ?? null, urgent: n.urgent ?? false, pushStatus: "none" as const, createdAt: this.now(), readAt: null };
    this.db.insert(notifications).values(row).run();
    this.bus.publish({ type: "notification.created", householdId, userId, notificationId: row.id, timestamp: new Date(row.createdAt).toISOString() });
    this.pushHook?.({ id: row.id, householdId, userId, kind: row.kind, title: row.title, body: row.body, urgent: row.urgent });
    return view(row);
  }

  notifyHousehold(householdId: string, n: NewNotification) {
    return this.recipients(householdId).map((userId) => this.notify(householdId, userId, n));
  }

  /** Only the household's admins (e.g. something sensitive happened automatically). */
  notifyAdmins(householdId: string, n: NewNotification) {
    const admins = new Set(this.households.listMembers(householdId).filter((m) => !m.expired && m.role === "admin").map((m) => m.userId));
    return this.recipients(householdId).filter((u) => admins.has(u)).map((userId) => this.notify(householdId, userId, n));
  }

  get(userId: string, id: string): NotificationView | null {
    const r = this.db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId))).get();
    return r ? view(r) : null;
  }

  list(userId: string, o: { unread?: boolean; limit?: number; before?: number } = {}): NotificationView[] {
    const where = and(eq(notifications.userId, userId), o.unread ? isNull(notifications.readAt) : undefined, o.before ? lt(notifications.createdAt, o.before) : undefined);
    return this.db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(Math.min(o.limit ?? 50, 200)).all().map(view);
  }

  unreadCount(userId: string): number {
    return this.db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))).all().length;
  }

  markRead(userId: string, id: string) {
    const hit = this.db.update(notifications).set({ readAt: this.now() }).where(and(eq(notifications.id, id), eq(notifications.userId, userId))).returning({ id: notifications.id }).all();
    if (!hit.length) throw notFound("Notification");
  }

  markAllRead(userId: string): number {
    return this.db.update(notifications).set({ readAt: this.now() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))).returning({ id: notifications.id }).all().length;
  }
}
