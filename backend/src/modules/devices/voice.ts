import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../core/database/client";
import { entitySettings } from "../../core/database/schema";
import type { ConfigJob, ConfigJobService } from "../home-assistant/config-jobs.service";
import type { HaSyncService } from "../home-assistant/sync.service";

/**
 * Pushes "can be controlled by voice" to Home Assistant's Assist, so the flag set in Alice is real. Done by the
 * config-worker (it needs the admin token); the result is written back to the setting so the app can show it.
 */
export class VoiceExposureService {
  constructor(private readonly db: Db, private readonly jobs: ConfigJobService, private readonly sync: HaSyncService, private readonly now: () => number = Date.now) {
    jobs.onResult("voice.expose", (job) => this.apply(job));
    sync.onReconcile((householdId, userId) => this.reconcile(householdId, userId));
  }

  private mark(connectionId: string, entityId: string, patch: { voiceSyncStatus: "none" | "pending" | "synced" | "failed"; voiceSyncError?: string | null }) {
    this.db.update(entitySettings).set({ ...patch, updatedAt: this.now() }).where(and(eq(entitySettings.connectionId, connectionId), eq(entitySettings.entityId, entityId))).run();
  }

  /** Queues the change, or records why it cannot go yet. */
  push(householdId: string, connectionId: string, entityId: string, expose: boolean, userId: string | null) {
    const ready = this.sync.ready(householdId);
    if (!ready.ok) return this.mark(connectionId, entityId, { voiceSyncStatus: "none", voiceSyncError: ready.reason });
    this.jobs.enqueue(householdId, { op: "voice.expose", entityIds: [entityId], expose }, { requestedBy: userId, dedupeKey: `voice:${entityId}` });
    this.mark(connectionId, entityId, { voiceSyncStatus: "pending", voiceSyncError: null });
  }

  private apply(job: ConfigJob) {
    const ids = (job.payload.entityIds as string[] | undefined) ?? [];
    for (const id of ids) {
      if (job.status === "done") this.mark(job.connectionId, id, { voiceSyncStatus: "synced", voiceSyncError: null });
      else this.mark(job.connectionId, id, { voiceSyncStatus: "failed", voiceSyncError: job.error ?? "Home Assistant did not accept it" });
    }
  }

  /** Sends every exposure that never reached Home Assistant (e.g. set before an admin token existed). */
  reconcile(householdId: string, userId: string | null = null) {
    if (!this.sync.ready(householdId).ok) return;
    const rows = this.db.select().from(entitySettings).where(and(eq(entitySettings.householdId, householdId), inArray(entitySettings.voiceSyncStatus, ["none", "failed"]))).all();
    for (const r of rows) if (r.voiceExposed) this.push(householdId, r.connectionId, r.entityId, true, userId);
  }
}
