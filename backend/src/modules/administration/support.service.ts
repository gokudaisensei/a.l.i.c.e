import { and, desc, eq, isNull, like, or } from "drizzle-orm";
import type { Db } from "../../core/database/client";
import { auditLog, supportSessions, users } from "../../core/database/schema";
import { AppError, notFound } from "../../core/errors/errors";
import { newId } from "../../core/ids";
import { writeAudit } from "../../core/security/audit";
import type { NotificationsService } from "../notifications/notifications.service";

type Row = typeof supportSessions.$inferSelect;
export const SUPPORT_SCOPES = ["health", "devices", "cameras", "control"] as const;
const MAX_TOTAL_HOURS = 24;
const HOUR = 3_600_000;

export interface SupportView {
  id: string; scope: Record<string, boolean>; startsAt: number; endsAt: number; durationHours: number; active: boolean;
  endedAt: number | null; endedBy: "user" | "expiry" | null; grantedBy: string | null;
}

/**
 * Support access: an admin lets support in for a set time and chooses what they may see. The grant is recorded in plain
 * language for the household and ends on its own. Support can never unlock a door whatever the scope says.
 * The operator's side (signing in and acting within the scope) is not built; this records and expires the grant.
 */
export class SupportService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: Db, private readonly notifications: NotificationsService, private readonly now: () => number = Date.now) {}

  private view(r: Row, name: string | null = null): SupportView {
    return { id: r.id, scope: r.scope, startsAt: r.startsAt, endsAt: r.endsAt, durationHours: Math.round(((r.endsAt - r.startsAt) / HOUR) * 10) / 10, active: !r.endedAt && r.endsAt > this.now(), endedAt: r.endedAt, endedBy: r.endedBy, grantedBy: name };
  }
  private name(userId: string) { return this.db.select({ n: users.displayName }).from(users).where(eq(users.id, userId)).get()?.n ?? null; }

  /** Ends sessions whose time has run out. Safe to call often. */
  expire(): number {
    const t = this.now();
    const due = this.db.select().from(supportSessions).where(and(isNull(supportSessions.endedAt))).all().filter((r) => r.endsAt <= t);
    for (const r of due) {
      this.db.update(supportSessions).set({ endedAt: r.endsAt, endedBy: "expiry" }).where(eq(supportSessions.id, r.id)).run();
      writeAudit(this.db, { householdId: r.householdId, actorType: "system", action: "support.expired", resource: r.id }, t);
    }
    return due.length;
  }

  active(householdId: string): SupportView | null {
    this.expire();
    const r = this.db.select().from(supportSessions).where(and(eq(supportSessions.householdId, householdId), isNull(supportSessions.endedAt))).orderBy(desc(supportSessions.createdAt)).get();
    return r ? this.view(r, this.name(r.grantedBy)) : null;
  }

  history(householdId: string): SupportView[] {
    this.expire();
    return this.db.select().from(supportSessions).where(eq(supportSessions.householdId, householdId)).orderBy(desc(supportSessions.createdAt)).limit(20).all().map((r) => this.view(r, this.name(r.grantedBy)));
  }

  grant(householdId: string, userId: string, o: { hours: number; scope: Partial<Record<(typeof SUPPORT_SCOPES)[number], boolean>> }): SupportView {
    if (this.active(householdId)) throw new AppError(409, "support_active", "Support already has access. End it first or add time to it");
    if (!Number.isFinite(o.hours) || o.hours < 1 || o.hours > MAX_TOTAL_HOURS) throw new AppError(400, "validation_error", `Choose between 1 and ${MAX_TOTAL_HOURS} hours`);
    const scope = Object.fromEntries(SUPPORT_SCOPES.map((k) => [k, o.scope[k] === true])) as Record<string, boolean>;
    if (!Object.values(scope).some(Boolean)) throw new AppError(400, "validation_error", "Choose at least one thing support may see");
    const t = this.now(), id = newId("sup");
    this.db.insert(supportSessions).values({ id, householdId, grantedBy: userId, scope, startsAt: t, endsAt: t + o.hours * HOUR, createdAt: t }).run();
    writeAudit(this.db, { householdId, actorId: userId, action: "support.granted", resource: id, detail: { hours: o.hours, scope } }, t);
    this.notifications.notifyAdmins(householdId, { kind: "support_access", title: "Support access was given", body: `${this.name(userId) ?? "An admin"} gave support access for ${o.hours} hour${o.hours === 1 ? "" : "s"}. It ends on its own.` });
    return this.active(householdId)!;
  }

  private session(householdId: string, id: string): Row {
    const r = this.db.select().from(supportSessions).where(and(eq(supportSessions.id, id), eq(supportSessions.householdId, householdId))).get();
    if (!r) throw notFound("Support session");
    return r;
  }

  extend(householdId: string, userId: string, id: string, hours = 1): SupportView {
    this.expire();
    const r = this.session(householdId, id);
    if (r.endedAt) throw new AppError(409, "support_ended", "That access has already ended");
    if (r.endsAt + hours * HOUR - r.startsAt > MAX_TOTAL_HOURS * HOUR) throw new AppError(400, "validation_error", `Access can last at most ${MAX_TOTAL_HOURS} hours in total`);
    this.db.update(supportSessions).set({ endsAt: r.endsAt + hours * HOUR }).where(eq(supportSessions.id, id)).run();
    writeAudit(this.db, { householdId, actorId: userId, action: "support.extended", resource: id, detail: { hours } }, this.now());
    return this.view(this.session(householdId, id), this.name(r.grantedBy));
  }

  end(householdId: string, userId: string, id: string): SupportView {
    this.expire();
    const r = this.session(householdId, id);
    if (!r.endedAt) {
      this.db.update(supportSessions).set({ endedAt: this.now(), endedBy: "user" }).where(eq(supportSessions.id, id)).run();
      writeAudit(this.db, { householdId, actorId: userId, action: "support.ended", resource: id }, this.now());
    }
    return this.view(this.session(householdId, id), this.name(r.grantedBy));
  }

  /** What the household sees, in plain words, newest first. */
  householdLog(householdId: string, limit = 20): { at: number; text: string }[] {
    const rows = this.db.select({ a: auditLog, name: users.displayName }).from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId))
      .where(and(eq(auditLog.householdId, householdId), like(auditLog.action, "support.%"))).orderBy(desc(auditLog.createdAt), desc(auditLog.id)).limit(limit).all();
    return rows.map(({ a, name }) => {
      const who = name ?? "An admin", d = (a.detail ?? {}) as { hours?: number };
      const text = a.action === "support.granted" ? `${who} gave support access for ${d.hours} hour${d.hours === 1 ? "" : "s"}`
        : a.action === "support.extended" ? `${who} added ${d.hours ?? 1} hour of support access`
        : a.action === "support.ended" ? `${who} ended support access`
        : a.action === "support.expired" ? "Support access ended on its own"
        : a.action === "support.operator_action" ? "Support looked at something you allowed" : a.action;
      return { at: a.createdAt, text };
    });
  }

  /** Everything support itself did, stored apart from what the household sees. Empty until operators can sign in. */
  operatorTrail(householdId: string, limit = 20): { at: number; operator: string; action: string; target: string | null }[] {
    return this.db.select().from(auditLog).where(and(eq(auditLog.householdId, householdId), or(eq(auditLog.actorType, "support")))).orderBy(desc(auditLog.createdAt)).limit(limit).all()
      .map((a) => ({ at: a.createdAt, operator: a.actorId ?? "support", action: a.action, target: a.resource }));
  }

  start(everyMs = 30_000) {
    this.timer = setInterval(() => { try { this.expire(); } catch { /* next tick */ } }, everyMs);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
