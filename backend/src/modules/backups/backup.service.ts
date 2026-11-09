import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../core/database/client";
import { backupRecords, householdSettings, households as householdsTable } from "../../core/database/schema";
import { AppError, notFound } from "../../core/errors/errors";
import { newId } from "../../core/ids";
import { writeAudit } from "../../core/security/audit";
import type { ConfigJob, ConfigJobService } from "../home-assistant/config-jobs.service";
import type { NotificationsService } from "../notifications/notifications.service";
import { BackupFormatError, packBackup, unpackBackup } from "./crypto";
import { type BackupDestination, DirectoryDestination, UploadDestination, validateNasPath } from "./destinations";
import { pendingRestorePath } from "./restore-apply";
import { currentSchemaVersion, inspectDatabase, snapshotDatabase, userTableNames } from "./sqlite-backup";

type Row = typeof backupRecords.$inferSelect;

export interface BackupSettings {
  enabled: boolean;
  /** Local time of day in the household's time zone, "HH:MM". */
  time: string;
  /** How many backups of each kind to keep. */
  keep: number;
  includeHa: boolean;
  destination: "local" | "nas" | "upload";
  nasPath: string | null;
  lastScheduledDay: string | null;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { enabled: true, time: "02:30", keep: 14, includeHa: true, destination: "local", nasPath: null, lastScheduledDay: null };

export interface BackupView {
  id: string;
  kind: "app" | "ha";
  destination: Row["destination"];
  name: string;
  sizeBytes: number | null;
  encrypted: boolean;
  status: Row["status"];
  error: string | null;
  trigger: Row["trigger"];
  createdAt: number;
  finishedAt: number | null;
  verify: { status: Row["verifyStatus"]; at: number | null; note: string | null };
  downloadable: boolean;
}

const view = (r: Row): BackupView => ({
  id: r.id, kind: r.kind, destination: r.destination, name: r.name, sizeBytes: r.sizeBytes, encrypted: r.encrypted, status: r.status, error: r.error,
  trigger: r.trigger, createdAt: r.createdAt, finishedAt: r.finishedAt, verify: { status: r.verifyStatus, at: r.verifiedAt, note: r.verifyNote },
  downloadable: r.kind === "app" && r.status === "ok",
});

export interface BackupServiceOptions {
  now?: () => number;
  /** Folder for local backups. */
  dir: string;
  /** Path of the live database file, or null for in-memory (restore cannot be staged). */
  dbPath: string | null;
  key: Buffer | null;
}

/** Local time pieces in a time zone. Falls back to UTC for an unknown zone. */
export function localTime(ms: number, tz: string): { day: string; minutes: number } {
  let zone = tz;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: zone }); } catch { zone = "UTC"; }
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ms).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/**
 * Backups of Alice's own database (written to a folder or a NAS share) and of Home Assistant (made by Home Assistant,
 * through the config-worker, and kept on the Home Assistant host). Every backup can be test-restored without touching
 * live data ("verify"). Restoring Alice's database is staged and applied at the next start.
 */
export class BackupService {
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly db: Db, private readonly jobs: ConfigJobService, private readonly notifications: NotificationsService, private readonly o: BackupServiceOptions) {
    this.now = o.now ?? Date.now;
    jobs.onResult("backup.", (job) => this.onJob(job));
  }

  /** Can Home Assistant be asked for a backup right now? Needs a connection, its admin token and a running worker. */
  haAvailable(householdId: string): boolean {
    const st = this.jobs.status(householdId);
    return st.connected && st.adminTokenSet && st.workerOnline;
  }

  get encryptionEnabled() { return !!this.o.key; }

  // ---- settings ----

  settings(householdId: string): BackupSettings {
    const row = this.db.select().from(householdSettings).where(eq(householdSettings.householdId, householdId)).get();
    return { ...DEFAULT_BACKUP_SETTINGS, ...((row?.settings?.backups as Partial<BackupSettings> | undefined) ?? {}) };
  }

  private save(householdId: string, s: BackupSettings) {
    const row = this.db.select().from(householdSettings).where(eq(householdSettings.householdId, householdId)).get();
    this.db.update(householdSettings).set({ settings: { ...(row?.settings ?? {}), backups: s } }).where(eq(householdSettings.householdId, householdId)).run();
  }

  async updateSettings(householdId: string, userId: string, patch: Partial<Omit<BackupSettings, "lastScheduledDay">>) {
    const s = { ...this.settings(householdId), ...patch };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) throw new AppError(400, "validation_error", "Time must look like 02:30");
    if (!Number.isInteger(s.keep) || s.keep < 1 || s.keep > 90) throw new AppError(400, "validation_error", "Keep between 1 and 90 backups");
    if (s.destination === "nas") {
      if (!s.nasPath) throw new AppError(400, "validation_error", "Give the folder of the NAS share");
      s.nasPath = validateNasPath(s.nasPath);
      const c = await new DirectoryDestination("nas", s.nasPath).check();
      if (!c.ok) throw new AppError(400, "destination_unavailable", c.reason);
    }
    if (s.destination === "upload") throw new AppError(501, "not_implemented", "Uploading backups to a remote store is not available yet");
    if (s.destination !== "nas") s.nasPath = null;
    this.save(householdId, s);
    writeAudit(this.db, { householdId, actorId: userId, action: "backup.settings", detail: { enabled: s.enabled, time: s.time, keep: s.keep, destination: s.destination, includeHa: s.includeHa } }, this.now());
    return this.settings(householdId);
  }

  // ---- destinations ----

  private destination(kind: "local" | "nas" | "upload", householdId: string): BackupDestination {
    if (kind === "local") return new DirectoryDestination("local", this.o.dir);
    if (kind === "nas") {
      const p = this.settings(householdId).nasPath;
      if (!p) throw new AppError(400, "destination_unavailable", "No NAS folder is set");
      return new DirectoryDestination("nas", p);
    }
    return new UploadDestination();
  }

  // ---- reading ----

  list(householdId: string): BackupView[] {
    return this.db.select().from(backupRecords).where(eq(backupRecords.householdId, householdId)).orderBy(desc(backupRecords.createdAt), desc(backupRecords.id)).all().map(view);
  }

  private row(householdId: string, id: string): Row {
    const r = this.db.select().from(backupRecords).where(and(eq(backupRecords.id, id), eq(backupRecords.householdId, householdId))).get();
    if (!r) throw notFound("Backup");
    return r;
  }

  get(householdId: string, id: string) { return view(this.row(householdId, id)); }

  /** For the health check: when the last good backup was made and whether it was proven restorable. */
  summary(householdId: string) {
    const ok = this.db.select().from(backupRecords).where(and(eq(backupRecords.householdId, householdId), eq(backupRecords.kind, "app"), eq(backupRecords.status, "ok"))).orderBy(desc(backupRecords.createdAt)).get();
    const failedVerify = ok ? ok.verifyStatus === "failed" : false;
    return { lastOkAt: ok?.finishedAt ?? null, lastVerifyStatus: ok?.verifyStatus ?? null, failedVerify, enabled: this.settings(householdId).enabled };
  }

  private fail(r: Row, message: string, householdId: string) {
    this.db.update(backupRecords).set({ status: "failed", error: message.slice(0, 300), finishedAt: this.now() }).where(eq(backupRecords.id, r.id)).run();
    this.notifications.notifyAdmins(householdId, { kind: "backup_failed", title: "A backup failed", body: message.slice(0, 200), urgent: true });
  }

  // ---- Alice's own backup ----

  async createApp(householdId: string, o: { trigger: "manual" | "scheduled"; userId?: string | null }): Promise<BackupView> {
    const s = this.settings(householdId);
    const t = this.now();
    const id = newId("bkp");
    const name = `alice-${new Date(t).toISOString().replace(/[:.]/g, "-")}-${id.slice(-6).toLowerCase()}.db${this.o.key ? ".enc" : ".gz"}`;
    this.db.insert(backupRecords).values({ id, householdId, kind: "app", destination: s.destination, destinationRef: null, name, status: "running", trigger: o.trigger, createdBy: o.userId ?? null, createdAt: t, encrypted: !!this.o.key, schemaVersion: currentSchemaVersion(this.db) }).run();
    const rec = this.row(householdId, id);
    try {
      const raw = snapshotDatabase(this.db);
      const { bytes, encrypted } = packBackup(raw, this.o.key);
      const ref = await this.destination(s.destination, householdId).put(name, bytes);
      this.db.update(backupRecords).set({ status: "ok", destinationRef: ref, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), encrypted, finishedAt: this.now() }).where(eq(backupRecords.id, id)).run();
      writeAudit(this.db, { householdId, actorId: o.userId ?? null, actorType: o.userId ? "user" : "system", action: "backup.created", resource: id, detail: { kind: "app", trigger: o.trigger, destination: s.destination } }, this.now());
    } catch (e) {
      this.fail(rec, e instanceof Error ? e.message : "The backup could not be written", householdId);
    }
    return this.get(householdId, id);
  }

  private async load(householdId: string, r: Row): Promise<Buffer> {
    if (r.kind !== "app" || r.status !== "ok" || !r.destinationRef) throw new AppError(409, "not_available", "That backup has no file to read");
    const bytes = await this.destination(r.destination as "local" | "nas" | "upload", householdId).get(r.destinationRef);
    if (r.sha256 && createHash("sha256").update(bytes).digest("hex") !== r.sha256) throw new BackupFormatError("The file does not match the checksum recorded when it was made");
    return unpackBackup(bytes, this.o.key);
  }

  /** A test restore: reads the backup, checks its checksum, decrypts it and opens it as a database. Live data is never touched. */
  async verify(householdId: string, id: string): Promise<BackupView> {
    const r = this.row(householdId, id);
    if (r.kind === "ha") {
      if (r.status !== "ok" || !r.destinationRef) throw new AppError(409, "not_available", "That backup is not finished");
      this.setVerify(id, "running", null);
      if (this.jobs.enqueue(householdId, { op: "backup.info", recordId: id, backupId: r.destinationRef }, { dedupeKey: `backup.info:${id}` }) === null) this.setVerify(id, "failed", "Home Assistant is not connected");
      return this.get(householdId, id);
    }
    if (r.status !== "ok") throw new AppError(409, "not_available", "That backup is not finished");
    this.setVerify(id, "running", null);
    try {
      const raw = await this.load(householdId, r);
      const res = inspectDatabase(raw, userTableNames(this.db));
      const note = res.ok ? `Opened cleanly: ${res.users} user(s), ${res.households} household(s), ${res.tables.length} tables, schema ${res.schemaVersion ?? "?"}` : res.problems.join("; ");
      this.setVerify(id, res.ok ? "passed" : "failed", note);
    } catch (e) {
      this.setVerify(id, "failed", e instanceof Error ? e.message : "Could not be read");
    }
    const after = this.row(householdId, id);
    if (after.verifyStatus === "failed") this.notifications.notifyAdmins(householdId, { kind: "backup_failed", title: "A backup did not pass its restore test", body: (after.verifyNote ?? "").slice(0, 200), urgent: true });
    return view(after);
  }

  private setVerify(id: string, status: Row["verifyStatus"], note: string | null) {
    this.db.update(backupRecords).set({ verifyStatus: status, verifiedAt: status === "running" ? null : this.now(), verifyNote: note?.slice(0, 300) ?? null }).where(eq(backupRecords.id, id)).run();
  }

  async download(householdId: string, id: string, userId: string): Promise<{ name: string; bytes: Uint8Array }> {
    const r = this.row(householdId, id);
    if (r.kind !== "app" || r.status !== "ok" || !r.destinationRef) throw new AppError(409, "not_available", "Only Alice's own finished backups can be downloaded");
    const bytes = await this.destination(r.destination as "local" | "nas" | "upload", householdId).get(r.destinationRef);
    writeAudit(this.db, { householdId, actorId: userId, action: "backup.downloaded", resource: id }, this.now());
    return { name: r.name, bytes };
  }

  /** Stages the restore: the swap happens at the next start, so nothing changes under running requests. */
  async restoreApp(householdId: string, id: string, userId: string): Promise<{ staged: true; applyOnRestart: true; note: string }> {
    if (!this.o.dbPath) throw new AppError(409, "not_available", "This database lives in memory and cannot be restored");
    const r = this.row(householdId, id);
    const raw = await this.load(householdId, r);
    const res = inspectDatabase(raw, userTableNames(this.db));
    if (!res.ok) throw new AppError(422, "backup_unusable", `This backup cannot be restored: ${res.problems.join("; ")}`);
    const ours = currentSchemaVersion(this.db);
    if (res.schemaVersion !== null && ours !== null && res.schemaVersion > ours) throw new AppError(422, "backup_too_new", "This backup was made by a newer version of Alice");
    await Bun.write(pendingRestorePath(this.o.dbPath), raw);
    writeAudit(this.db, { householdId, actorId: userId, action: "backup.restore_staged", resource: id }, this.now());
    return { staged: true, applyOnRestart: true, note: "Restart Alice to finish. Your current database is kept next to it until you remove it." };
  }

  // ---- Home Assistant backup ----

  createHa(householdId: string, o: { trigger: "manual" | "scheduled"; userId?: string | null }): BackupView {
    const id = newId("bkp");
    const t = this.now();
    const name = `Alice ${new Date(t).toISOString().slice(0, 16).replace("T", " ")}`;
    if (!this.jobs.connectionIdFor(householdId)) throw new AppError(409, "ha_not_connected", "Connect Home Assistant first");
    this.db.insert(backupRecords).values({ id, householdId, kind: "ha", destination: "ha", name, status: "running", trigger: o.trigger, createdBy: o.userId ?? null, createdAt: t, encrypted: false }).run();
    this.jobs.enqueue(householdId, { op: "backup.generate", recordId: id, name });
    return this.get(householdId, id);
  }

  restoreHa(householdId: string, id: string, userId: string) {
    const r = this.row(householdId, id);
    if (r.kind !== "ha" || r.status !== "ok" || !r.destinationRef) throw new AppError(409, "not_available", "That is not a finished Home Assistant backup");
    const job = this.jobs.enqueue(householdId, { op: "backup.restore", recordId: id, backupId: r.destinationRef }, { requestedBy: userId });
    if (!job) throw new AppError(409, "ha_not_connected", "Connect Home Assistant first");
    writeAudit(this.db, { householdId, actorId: userId, action: "backup.ha_restore_requested", resource: id }, this.now());
    return { queued: true, jobId: job, note: "Home Assistant will restart while it restores. Alice reconnects by itself." };
  }

  async remove(householdId: string, id: string, userId: string): Promise<{ removed: boolean; pending?: boolean }> {
    const r = this.row(householdId, id);
    writeAudit(this.db, { householdId, actorId: userId, action: "backup.deleted", resource: id, detail: { kind: r.kind } }, this.now());
    if (r.kind === "ha" && r.status === "ok" && r.destinationRef) {
      if (this.jobs.enqueue(householdId, { op: "backup.delete", recordId: id, backupId: r.destinationRef }, { requestedBy: userId }) === null) throw new AppError(409, "ha_not_connected", "Connect Home Assistant first");
      return { removed: false, pending: true };
    }
    if (r.kind === "app" && r.destinationRef) await this.destination(r.destination as "local" | "nas" | "upload", householdId).remove(r.destinationRef).catch(() => {});
    this.db.delete(backupRecords).where(eq(backupRecords.id, id)).run();
    return { removed: true };
  }

  // ---- finished worker jobs ----

  private onJob(job: ConfigJob) {
    const recordId = String(job.payload.recordId ?? "");
    const r = this.db.select().from(backupRecords).where(eq(backupRecords.id, recordId)).get();
    if (!r) return;
    if (job.operation === "backup.generate") {
      if (job.status === "done") {
        this.db.update(backupRecords).set({ status: "ok", destinationRef: String(job.result?.backupId ?? ""), sizeBytes: Number(job.result?.sizeBytes ?? 0) || null, finishedAt: this.now() }).where(eq(backupRecords.id, r.id)).run();
        writeAudit(this.db, { householdId: r.householdId, actorId: r.createdBy, actorType: r.createdBy ? "user" : "system", action: "backup.created", resource: r.id, detail: { kind: "ha", trigger: r.trigger } }, this.now());
        this.jobs.enqueue(r.householdId, { op: "backup.info", recordId: r.id, backupId: String(job.result?.backupId) }, { dedupeKey: `backup.info:${r.id}` });
        this.setVerify(r.id, "running", null);
        this.retain(r.householdId, "ha");
      } else this.fail(r, `Home Assistant could not make the backup: ${job.error ?? "unknown error"}`, r.householdId);
    } else if (job.operation === "backup.info") {
      if (job.status !== "done") { this.setVerify(r.id, "failed", `Could not ask Home Assistant: ${job.error ?? "unknown error"}`.slice(0, 300)); }
      else {
        const x = job.result as { exists?: boolean; sizeBytes?: number; homeassistantIncluded?: boolean; databaseIncluded?: boolean; failedAgents?: string[] };
        const problems: string[] = [];
        if (!x.exists) problems.push("Home Assistant no longer has this backup");
        else {
          if (!x.sizeBytes) problems.push("it is empty");
          if (!x.homeassistantIncluded) problems.push("it does not include the Home Assistant configuration");
          if (x.failedAgents?.length) problems.push(`it failed to save to ${x.failedAgents.join(", ")}`);
        }
        this.setVerify(r.id, problems.length ? "failed" : "passed", problems.length ? problems.join("; ") : `Home Assistant lists it: ${x.sizeBytes} bytes, configuration${x.databaseIncluded ? " and history" : ""} included`);
        if (problems.length) this.notifications.notifyAdmins(r.householdId, { kind: "backup_failed", title: "A Home Assistant backup did not pass its check", body: problems.join("; ").slice(0, 200), urgent: true });
      }
    } else if (job.operation === "backup.delete") {
      if (job.status === "done") this.db.delete(backupRecords).where(eq(backupRecords.id, r.id)).run();
      else this.db.update(backupRecords).set({ error: `Could not delete from Home Assistant: ${job.error ?? "unknown error"}`.slice(0, 300) }).where(eq(backupRecords.id, r.id)).run();
    } else if (job.operation === "backup.restore") {
      writeAudit(this.db, { householdId: r.householdId, actorType: "system", action: job.status === "done" ? "backup.ha_restore_done" : "backup.ha_restore_failed", resource: r.id, detail: job.status === "done" ? null : { error: job.error } }, this.now());
      if (job.status !== "done") this.notifications.notifyAdmins(r.householdId, { kind: "backup_failed", title: "The Home Assistant restore failed", body: (job.error ?? "").slice(0, 200), urgent: true });
    }
  }

  // ---- retention and schedule ----

  /** Keeps the newest `keep` finished backups of a kind. Failed records are dropped after the same count. */
  private retain(householdId: string, kind: "app" | "ha") {
    const keep = this.settings(householdId).keep;
    const rows = this.db.select().from(backupRecords).where(and(eq(backupRecords.householdId, householdId), eq(backupRecords.kind, kind))).orderBy(desc(backupRecords.createdAt), desc(backupRecords.id)).all().filter((r) => r.status !== "running");
    for (const r of rows.slice(keep)) void this.remove(householdId, r.id, "system").catch(() => {});
  }

  /** Runs the nightly backup if it is due. Safe to call often: it runs at most once per local day, and catches up if it was missed. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let ran = 0;
    try {
      for (const h of this.db.select().from(householdsTable).all()) {
        const s = this.settings(h.id);
        if (!s.enabled) continue;
        const { day, minutes } = localTime(this.now(), h.timezone);
        const [hh, mm] = s.time.split(":").map(Number);
        if (s.lastScheduledDay === day || minutes < hh! * 60 + mm!) continue;
        this.save(h.id, { ...s, lastScheduledDay: day });
        const rec = await this.createApp(h.id, { trigger: "scheduled" });
        if (rec.status === "ok") { await this.verify(h.id, rec.id); this.retain(h.id, "app"); }
        if (s.includeHa && this.jobs.connectionIdFor(h.id)) { try { this.createHa(h.id, { trigger: "scheduled" }); } catch { /* HA backup is best effort */ } }
        ran++;
      }
    } finally { this.running = false; }
    return ran;
  }

  start(intervalMs = 60_000) {
    this.timer = setInterval(() => void this.tick().catch(() => {}), intervalMs);
    this.timer.unref?.();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
