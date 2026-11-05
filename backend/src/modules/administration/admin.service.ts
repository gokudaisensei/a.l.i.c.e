import { statSync } from "node:fs";
import { and, desc, eq, like, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { env } from "@/core/config/env";
import { auditLog, automations, notifications, routines, scenes, users } from "@/core/database/schema";
import type { ConfigJobService } from "../home-assistant/config-jobs.service";
import type { UpdateService } from "../updates/update.service";
import type { BackupService } from "../backups/backup.service";
import type { HaConnectionService } from "../home-assistant/connection.service";
import type { HouseholdService } from "../households/household.service";
import type { PushService } from "../notifications/push/push.service";
import type { ThingsService } from "../home-assistant/things/things.service";
import pkg from "../../../package.json" with { type: "json" };

export type CheckStatus = "ok" | "warn" | "down";

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface AuditItem {
  id: string;
  at: number;
  actor: { type: string; id: string | null; name: string | null };
  action: string;
  resource: string | null;
  detail: Record<string, unknown> | null;
}

const startedAt = Date.now();

/** Health, diagnostics and the audit log for admins. Nothing here ever includes a token, key or password. */
export class AdminService {
  constructor(
    private readonly db: Db,
    private readonly ha: HaConnectionService,
    private readonly jobs: ConfigJobService,
    private readonly push: PushService,
    private readonly things: ThingsService,
    private readonly households: HouseholdService,
    private readonly now: () => number = Date.now,
    private readonly backups?: BackupService,
    private readonly updates?: UpdateService,
  ) {}

  health(householdId: string) {
    const checks: HealthCheck[] = [];
    try { this.db.run(sql`select 1`); checks.push({ name: "database", status: "ok", detail: "Responding" }); } catch { checks.push({ name: "database", status: "down", detail: "The database did not answer" }); }

    const conn = this.ha.get(householdId);
    if (!conn.configured) checks.push({ name: "homeAssistant", status: "warn", detail: "Home Assistant is not connected yet" });
    else if (conn.status === "connected") checks.push({ name: "homeAssistant", status: "ok", detail: `Connected to Home Assistant ${conn.haVersion ?? ""}, ${conn.entities ?? 0} entities`.replace("  ", " ") });
    else checks.push({ name: "homeAssistant", status: "down", detail: conn.lastError ? `${conn.status}: ${conn.lastError}` : `${conn.status}` });

    const s = this.jobs.status(householdId);
    if (!s.connected) checks.push({ name: "configWorker", status: "ok", detail: "Not needed until Home Assistant is connected" });
    else if (!s.adminTokenSet) checks.push({ name: "configWorker", status: "warn", detail: "No admin token: scenes, routines and automations cannot be added to Home Assistant" });
    else if (!s.workerOnline) checks.push({ name: "configWorker", status: "warn", detail: s.pendingJobs ? `The worker is not running and ${s.pendingJobs} change(s) are waiting` : "The worker is not running" });
    else checks.push({ name: "configWorker", status: "ok", detail: s.pendingJobs ? `Running, ${s.pendingJobs} change(s) in progress` : "Running" });
    if (s.failedJobs) checks.push({ name: "configJobs", status: "warn", detail: `${s.failedJobs} change(s) could not be applied to Home Assistant` });

    const platforms = this.push.platforms();
    checks.push({ name: "push", status: platforms.length ? "ok" : "warn", detail: platforms.length ? `Push is set up for ${platforms.join(" and ")}` : "Push notifications are not set up; notifications only appear in the app" });

    if (this.backups) {
      const b = this.backups.summary(householdId);
      const age = b.lastOkAt === null ? null : this.now() - b.lastOkAt;
      if (b.failedVerify) checks.push({ name: "backups", status: "warn", detail: "The latest backup did not pass its restore test" });
      else if (age === null) checks.push({ name: "backups", status: b.enabled ? "warn" : "warn", detail: b.enabled ? "No backup has been made yet" : "No backup has been made and scheduled backups are off" });
      else if (age > 36 * 3_600_000) checks.push({ name: "backups", status: "warn", detail: `The last good backup is ${Math.floor(age / 3_600_000)} hours old` });
      else checks.push({ name: "backups", status: "ok", detail: b.lastVerifyStatus === "passed" ? "Recent and restore-tested" : "Recent backup available" });
    }

    if (this.updates) {
      const f = this.updates.lastFailed(householdId);
      if (f) checks.push({ name: "updates", status: "warn", detail: `The update to ${f.version} failed: ${f.error ?? "unknown error"}` });
    }

    const status: CheckStatus = checks.some((c) => c.status === "down") ? "down" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
    return { status, version: pkg.version, uptimeSeconds: Math.round(process.uptime()), checks };
  }

  diagnostics(householdId: string) {
    const conn = this.ha.get(householdId);
    let dbBytes: number | null = null;
    try { if (env.databaseUrl !== ":memory:") dbBytes = statSync(env.databaseUrl).size; } catch { /* not a file we can see */ }
    const count = (table: typeof scenes | typeof routines | typeof automations) => this.db.select({ id: table.id }).from(table).where(eq(table.householdId, householdId)).all().length;
    const things = this.things.forHousehold(householdId).flatMap((c) => c.things);
    return {
      app: { name: pkg.name, version: pkg.version, runtime: `bun ${Bun.version}`, environment: env.nodeEnv, startedAt },
      features: {
        pushChannels: this.push.platforms(),
        adminTokenSealing: !!env.adminSealPublicKey,
        operationalTokenEncryption: !!env.secretsKey,
        trustProxy: env.trustProxy,
        passkeyRelyingParty: env.webauthn.rpId,
      },
      homeAssistant: { configured: conn.configured, version: conn.haVersion ?? null, status: conn.status ?? null, host: conn.baseUrl ? new URL(conn.baseUrl).host : null, entities: conn.entities ?? 0, lastSyncAt: conn.syncedAt ?? null },
      counts: {
        members: this.households.listMembers(householdId).length,
        devices: things.filter((t) => !t.hidden).length,
        hiddenDevices: things.filter((t) => t.hidden).length,
        scenes: count(scenes), routines: count(routines), automations: count(automations),
        unreadNotifications: this.db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.householdId, householdId), sql`${notifications.readAt} is null`)).all().length,
      },
      database: { sizeBytes: dbBytes },
    };
  }

  /** Newest first. `before` is the cursor from the previous page; `action` matches the start of the action name ("auth." or "devices.merged"). */
  audit(householdId: string, o: { limit?: number; before?: string; action?: string } = {}): { items: AuditItem[]; nextCursor: string | null } {
    const limit = Math.min(Math.max(o.limit ?? 50, 1), 200);
    let cursor: ReturnType<typeof and> | undefined;
    if (o.before) {
      const [t, id] = o.before.split(":");
      if (t && id) cursor = or(lt(auditLog.createdAt, Number(t)), and(eq(auditLog.createdAt, Number(t)), lt(auditLog.id, id)));
    }
    const rows = this.db.select({ a: auditLog, name: users.displayName }).from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId))
      .where(and(eq(auditLog.householdId, householdId), o.action ? like(auditLog.action, `${o.action.replace(/[%_]/g, "")}%`) : undefined, cursor))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id)).limit(limit + 1).all();
    const page = rows.slice(0, limit);
    return {
      items: page.map(({ a, name }) => ({ id: a.id, at: a.createdAt, actor: { type: a.actorType, id: a.actorId, name }, action: a.action, resource: a.resource, detail: a.detail })),
      nextCursor: rows.length > limit ? `${page.at(-1)!.a.createdAt}:${page.at(-1)!.a.id}` : null,
    };
  }
}
