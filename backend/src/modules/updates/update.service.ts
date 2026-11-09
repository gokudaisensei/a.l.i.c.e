import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../core/database/client";
import { householdSettings, households as householdsTable, updateRecords } from "../../core/database/schema";
import { AppError, notFound } from "../../core/errors/errors";
import { newId } from "../../core/ids";
import { writeAudit } from "../../core/security/audit";
import type { BackupService } from "../backups/backup.service";
import { localTime } from "../backups/backup.service";
import type { NotificationsService } from "../notifications/notifications.service";
import { type AvailableUpdate, isNewer, type UpdateInstaller, type UpdateSource } from "./sources";

type Row = typeof updateRecords.$inferSelect;

export interface UpdateSettings {
  /** Install a newly available update by itself, inside the window. Off by default. */
  autoUpdate: boolean;
  /** Local "HH:MM" in the household's time zone. The window may cross midnight. */
  windowStart: string;
  windowEnd: string;
}
export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { autoUpdate: false, windowStart: "02:00", windowEnd: "04:00" };

interface Stored { settings?: Partial<UpdateSettings>; latest?: AvailableUpdate | null; checkedAt?: number | null; checkError?: string | null; notifiedVersion?: string | null }

export interface UpdateView {
  id: string; fromVersion: string; version: string; status: Row["status"]; trigger: Row["trigger"]; reason: string | null; backupId: string | null; haBackupId: string | null;
  scheduledFor: number | null; error: string | null; createdAt: number; startedAt: number | null; finishedAt: number | null;
}
const view = (r: Row): UpdateView => ({ id: r.id, fromVersion: r.fromVersion, version: r.version, status: r.status, trigger: r.trigger, reason: r.reason, backupId: r.backupId, haBackupId: r.haBackupId, scheduledFor: r.scheduledFor, error: r.error, createdAt: r.createdAt, startedAt: r.startedAt, finishedAt: r.finishedAt });

export interface UpdateServiceOptions {
  now?: () => number;
  currentVersion: string;
  source: UpdateSource;
  installer: UpdateInstaller;
  /** An install that has not finished after this long is marked failed. */
  installTimeoutMs?: number;
  /** Install a manifest that carries no valid signature. Off unless the operator says so. */
  allowUnsigned?: boolean;
  /** How long to wait for Home Assistant's safety backup before giving up (not waited for in an emergency). */
  haBackupWaitMs?: number;
  /** How often to ask the source for a new version. */
  checkEveryMs?: number;
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h! * 60 + m!; };
export const inWindow = (minutes: number, start: string, end: string) => {
  const s = toMin(start), e = toMin(end);
  return s === e ? false : s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
};
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Knowing when a newer Alice exists, and putting it in place at a quiet time. An install is: a safety backup of Alice's
 * database, then a request to whatever runs the server; it is done when the server starts as the new version.
 * Emergency deploys skip the window but need a reason, the word DEPLOY and a recent passkey, and are audited.
 */
export class UpdateService {
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(private readonly db: Db, private readonly backups: BackupService, private readonly notifications: NotificationsService, private readonly o: UpdateServiceOptions) {
    this.now = o.now ?? Date.now;
  }

  get currentVersion() { return this.o.currentVersion; }

  // ---- stored state ----

  private stored(householdId: string): Stored {
    const row = this.db.select().from(householdSettings).where(eq(householdSettings.householdId, householdId)).get();
    return (row?.settings?.updates as Stored | undefined) ?? {};
  }
  private patch(householdId: string, p: Partial<Stored>) {
    const row = this.db.select().from(householdSettings).where(eq(householdSettings.householdId, householdId)).get();
    this.db.update(householdSettings).set({ settings: { ...(row?.settings ?? {}), updates: { ...this.stored(householdId), ...p } } }).where(eq(householdSettings.householdId, householdId)).run();
  }
  settings(householdId: string): UpdateSettings { return { ...DEFAULT_UPDATE_SETTINGS, ...(this.stored(householdId).settings ?? {}) }; }

  updateSettings(householdId: string, userId: string, patch: Partial<UpdateSettings>) {
    const s = { ...this.settings(householdId), ...patch };
    if (!HHMM.test(s.windowStart) || !HHMM.test(s.windowEnd)) throw new AppError(400, "validation_error", "Times must look like 02:00");
    if (s.windowStart === s.windowEnd) throw new AppError(400, "validation_error", "The update window cannot be empty");
    this.patch(householdId, { settings: s });
    writeAudit(this.db, { householdId, actorId: userId, action: "update.settings", detail: { ...s } }, this.now());
    return this.settings(householdId);
  }

  private tz(householdId: string) { return this.db.select().from(householdsTable).where(eq(householdsTable.id, householdId)).get()?.timezone ?? "UTC"; }
  private inWindowNow(householdId: string) { const s = this.settings(householdId); return inWindow(localTime(this.now(), this.tz(householdId)).minutes, s.windowStart, s.windowEnd); }
  /** When the next window opens (now, if one is open). */
  nextWindowStart(householdId: string): number {
    if (this.inWindowNow(householdId)) return this.now();
    const s = this.settings(householdId);
    const delta = (toMin(s.windowStart) - localTime(this.now(), this.tz(householdId)).minutes + 1440) % 1440;
    return Math.floor(this.now() / 60_000) * 60_000 + delta * 60_000;
  }

  // ---- status ----

  private active(householdId: string): Row | undefined {
    return this.db.select().from(updateRecords).where(and(eq(updateRecords.householdId, householdId), inArray(updateRecords.status, ["scheduled", "preparing", "installing"]))).orderBy(desc(updateRecords.createdAt)).get();
  }

  status(householdId: string) {
    const st = this.stored(householdId);
    const available = st.latest && isNewer(st.latest.version, this.o.currentVersion) ? st.latest : null;
    const act = this.active(householdId);
    const state = act ? act.status : available ? "ready" : "up_to_date";
    const installable = !!available && (available.signed || !!this.o.allowUnsigned);
    return {
      currentVersion: this.o.currentVersion, state, available, installable, settings: this.settings(householdId), inWindow: this.inWindowNow(householdId),
      nextWindowAt: this.nextWindowStart(householdId), checkedAt: st.checkedAt ?? null, checkError: st.checkError ?? null, active: act ? view(act) : null,
    };
  }

  history(householdId: string): UpdateView[] {
    return this.db.select().from(updateRecords).where(eq(updateRecords.householdId, householdId)).orderBy(desc(updateRecords.createdAt), desc(updateRecords.id)).limit(50).all().map(view);
  }

  /** Last update outcome, for health. */
  lastFailed(householdId: string): UpdateView | null {
    const r = this.db.select().from(updateRecords).where(eq(updateRecords.householdId, householdId)).orderBy(desc(updateRecords.createdAt)).get();
    return r?.status === "failed" ? view(r) : null;
  }

  // ---- checking ----

  async check(householdId: string) {
    try {
      const latest = await this.o.source.latest();
      this.patch(householdId, { latest, checkedAt: this.now(), checkError: null });
      if (latest && isNewer(latest.version, this.o.currentVersion) && this.stored(householdId).notifiedVersion !== latest.version) {
        this.patch(householdId, { notifiedVersion: latest.version });
        this.notifications.notifyAdmins(householdId, { kind: "update_available", title: `Alice ${latest.version} is available`, body: this.settings(householdId).autoUpdate ? "It will install tonight." : "Schedule it for tonight's window, or install it from Updates." });
      }
    } catch (e) {
      this.patch(householdId, { checkedAt: this.now(), checkError: (e instanceof Error ? e.message : "Could not check").slice(0, 200) });
    }
    return this.status(householdId);
  }

  // ---- installing ----

  private create(householdId: string, trigger: Row["trigger"], userId: string | null, reason: string | null, scheduledFor: number | null): Row {
    const available = this.status(householdId).available;
    if (!available) throw new AppError(409, "no_update", "There is no newer version to install");
    if (!available.signed && !this.o.allowUnsigned) throw new AppError(409, "unsigned_update", "This update is not signed by the publisher key, so Alice will not install it");
    if (this.active(householdId)) throw new AppError(409, "update_in_progress", "An update is already scheduled or installing");
    const id = newId("upd");
    this.db.insert(updateRecords).values({ id, householdId, fromVersion: this.o.currentVersion, version: available.version, status: "scheduled", trigger, reason, requestedBy: userId, scheduledFor, createdAt: this.now() }).run();
    writeAudit(this.db, { householdId, actorId: userId, actorType: userId ? "user" : "system", action: `update.${trigger === "auto" ? "auto_scheduled" : trigger === "emergency" ? "emergency" : "requested"}`, resource: id, detail: { from: this.o.currentVersion, to: available.version, reason } }, this.now());
    return this.db.select().from(updateRecords).where(eq(updateRecords.id, id)).get()!;
  }

  /** Puts the update into the next window (or the current one). */
  schedule(householdId: string, userId: string): UpdateView {
    return view(this.create(householdId, "manual", userId, null, this.nextWindowStart(householdId)));
  }

  /** Installs now. Only inside the window; outside it, schedule it or use the emergency deploy. */
  async installNow(householdId: string, userId: string): Promise<UpdateView> {
    if (!this.inWindowNow(householdId)) throw new AppError(409, "outside_window", "Updates install between the set hours. Schedule it, or use an emergency deploy");
    const r = this.create(householdId, "manual", userId, null, this.now());
    return this.start(r.id);
  }

  async emergency(householdId: string, userId: string, reason: string, confirm: string): Promise<UpdateView> {
    const why = reason.trim();
    if (why.length < 8) throw new AppError(400, "reason_required", "Give a reason of at least 8 characters");
    if (confirm !== "DEPLOY") throw new AppError(400, "confirmation_required", "Type DEPLOY to confirm");
    const r = this.create(householdId, "emergency", userId, why.slice(0, 300), this.now());
    this.notifications.notifyAdmins(householdId, { kind: "update_emergency", title: "Emergency update started", body: `Alice is updating outside the usual window: ${why.slice(0, 150)}`, urgent: true });
    return this.start(r.id);
  }

  cancel(householdId: string, userId: string, id: string): UpdateView {
    const r = this.db.select().from(updateRecords).where(and(eq(updateRecords.id, id), eq(updateRecords.householdId, householdId))).get();
    if (!r) throw notFound("Update");
    if (r.status !== "scheduled") throw new AppError(409, "not_cancellable", "Only a scheduled update can be cancelled");
    this.db.update(updateRecords).set({ status: "cancelled", finishedAt: this.now() }).where(eq(updateRecords.id, id)).run();
    writeAudit(this.db, { householdId, actorId: userId, action: "update.cancelled", resource: id }, this.now());
    return view(this.db.select().from(updateRecords).where(eq(updateRecords.id, id)).get()!);
  }

  private fail(r: Row, message: string): UpdateView {
    this.db.update(updateRecords).set({ status: "failed", error: message.slice(0, 300), finishedAt: this.now() }).where(eq(updateRecords.id, r.id)).run();
    writeAudit(this.db, { householdId: r.householdId, actorType: "system", action: "update.failed", resource: r.id, detail: { to: r.version, error: message.slice(0, 300) } }, this.now());
    this.notifications.notifyAdmins(r.householdId, { kind: "update_failed", title: "The update did not go through", body: message.slice(0, 200), urgent: true });
    return view(this.db.select().from(updateRecords).where(eq(updateRecords.id, r.id)).get()!);
  }

  /**
   * Safety backups first: Alice's database always, and Home Assistant's when it can be asked (waited for, except in an
   * emergency). Then the request to whatever runs the server.
   */
  private async start(id: string): Promise<UpdateView> {
    const r = this.db.select().from(updateRecords).where(eq(updateRecords.id, id)).get()!;
    this.db.update(updateRecords).set({ status: "preparing", startedAt: this.now() }).where(eq(updateRecords.id, id)).run();
    const b = await this.backups.createApp(r.householdId, { trigger: "manual", userId: r.requestedBy });
    if (b.status !== "ok") return this.fail(r, `The safety backup failed, so nothing was changed: ${b.error ?? "unknown error"}`);
    this.db.update(updateRecords).set({ backupId: b.id }).where(eq(updateRecords.id, id)).run();
    if (this.backups.haAvailable(r.householdId)) {
      try {
        const ha = this.backups.createHa(r.householdId, { trigger: "manual", userId: r.requestedBy });
        this.db.update(updateRecords).set({ haBackupId: ha.id }).where(eq(updateRecords.id, id)).run();
        if (r.trigger !== "emergency") return view(this.db.select().from(updateRecords).where(eq(updateRecords.id, id)).get()!);
      } catch { /* Home Assistant's backup is best effort when it cannot be started */ }
    }
    return this.finish(id);
  }

  private async finish(id: string): Promise<UpdateView> {
    const r = this.db.select().from(updateRecords).where(eq(updateRecords.id, id)).get()!;
    this.db.update(updateRecords).set({ status: "installing" }).where(eq(updateRecords.id, id)).run();
    try { await this.o.installer.request(r.version, "install", this.stored(r.householdId).latest?.artifactSha256 ?? null); } catch (e) { return this.fail(r, `The update could not be requested: ${e instanceof Error ? e.message : "unknown error"}`); }
    writeAudit(this.db, { householdId: r.householdId, actorId: r.requestedBy, actorType: r.requestedBy ? "user" : "system", action: "update.installing", resource: id, detail: { to: r.version, backupId: r.backupId, haBackupId: r.haBackupId } }, this.now());
    return view(this.db.select().from(updateRecords).where(eq(updateRecords.id, id)).get()!);
  }

  /**
   * Goes back to the version before a failed (or unwanted) update. `restoreData` also stages the restore of the safety
   * backup of Alice's database, which loses everything recorded since; without it only the old version is requested.
   * Home Assistant's safety backup, if one was taken, is named in the answer and restored from `/backups` if wanted.
   */
  async rollback(householdId: string, userId: string, id: string, restoreData: boolean) {
    const r = this.db.select().from(updateRecords).where(and(eq(updateRecords.id, id), eq(updateRecords.householdId, householdId))).get();
    if (!r) throw notFound("Update");
    if (!["failed", "done", "installing"].includes(r.status) || !r.startedAt) throw new AppError(409, "not_rollbackable", "Only an update that was started can be rolled back");
    if (restoreData && !r.backupId) throw new AppError(409, "no_backup", "This update has no safety backup to restore");
    if (restoreData) await this.backups.restoreApp(householdId, r.backupId!, userId);
    try { await this.o.installer.request(r.fromVersion, "rollback"); } catch (e) { throw new AppError(502, "rollback_failed", `The rollback could not be requested: ${e instanceof Error ? e.message : "unknown error"}`); }
    this.db.update(updateRecords).set({ status: "rolled_back", finishedAt: this.now() }).where(eq(updateRecords.id, id)).run();
    writeAudit(this.db, { householdId, actorId: userId, action: "update.rolled_back", resource: id, detail: { to: r.fromVersion, restoreData } }, this.now());
    this.notifications.notifyAdmins(householdId, { kind: "update_rolled_back", title: `Rolling back to ${r.fromVersion}`, body: restoreData ? "Restart Alice to finish; data since the update is replaced by the safety backup." : "Alice will go back to the previous version." });
    return { rolledBack: true, toVersion: r.fromVersion, dataRestoreStaged: restoreData, homeAssistantBackupId: r.haBackupId, update: view(this.db.select().from(updateRecords).where(eq(updateRecords.id, id)).get()!) };
  }

  /** An update that already failed or was rolled back is not retried by itself; an admin decides. */
  private triedBefore(householdId: string, version: string) {
    return !!this.db.select().from(updateRecords).where(and(eq(updateRecords.householdId, householdId), eq(updateRecords.version, version), inArray(updateRecords.status, ["failed", "rolled_back"]))).get();
  }

  /** The new version never came up: ask for the old one back (code only; data is left alone) and say so. */
  private failTimedOut(act: Row) {
    this.o.installer.request(act.fromVersion, "rollback").then(
      () => this.fail(act, `The server did not come back as the new version in time; a return to ${act.fromVersion} was requested`),
      () => this.fail(act, "The server did not come back as the new version in time, and the return to the old version could not be requested"),
    );
  }

  // ---- schedule ----

  /** Called at start and every minute: finishes installs, starts what is due, and (when allowed) queues the automatic update. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const h of this.db.select().from(householdsTable).all()) {
        const act = this.active(h.id);
        if (act?.status === "preparing") {
          const ha = act.haBackupId ? this.backups.get(h.id, act.haBackupId) : null;
          if (!ha || ha.status === "ok") await this.finish(act.id);
          else if (ha.status === "failed") this.fail(act, `Home Assistant's safety backup failed, so nothing was changed: ${ha.error ?? "unknown error"}`);
          else if (this.now() - (act.startedAt ?? act.createdAt) > (this.o.haBackupWaitMs ?? 10 * 60_000)) this.fail(act, "Home Assistant's safety backup did not finish in time, so nothing was changed");
          continue;
        }
        if (act?.status === "installing") {
          if (!isNewer(act.version, this.o.currentVersion)) {
            this.db.update(updateRecords).set({ status: "done", finishedAt: this.now() }).where(eq(updateRecords.id, act.id)).run();
            writeAudit(this.db, { householdId: h.id, actorType: "system", action: "update.done", resource: act.id, detail: { from: act.fromVersion, to: this.o.currentVersion } }, this.now());
            this.notifications.notifyAdmins(h.id, { kind: "update_done", title: `Alice is now ${this.o.currentVersion}`, body: "The update finished." });
          } else if (this.now() - (act.startedAt ?? act.createdAt) > (this.o.installTimeoutMs ?? 30 * 60_000)) this.failTimedOut(act);
          continue;
        }
        const st = this.stored(h.id);
        if (!st.checkedAt || this.now() - st.checkedAt > (this.o.checkEveryMs ?? 6 * 3_600_000)) await this.check(h.id);
        const s = this.settings(h.id);
        if (act?.status === "scheduled") {
          if ((act.scheduledFor ?? 0) <= this.now() && this.inWindowNow(h.id)) await this.start(act.id);
        } else if (s.autoUpdate && this.status(h.id).installable && this.inWindowNow(h.id) && !this.triedBefore(h.id, this.status(h.id).available!.version)) {
          const r = this.create(h.id, "auto", null, null, this.now());
          await this.start(r.id);
        }
      }
    } finally { this.busy = false; }
  }

  startTimer(intervalMs = 60_000) {
    void this.tick().catch(() => {});
    this.timer = setInterval(() => void this.tick().catch(() => {}), intervalMs);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
