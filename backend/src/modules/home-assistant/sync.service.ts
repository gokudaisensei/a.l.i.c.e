import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../core/database/client";
import { automations, haConnections, routines, scenes, type SyncStatus } from "../../core/database/schema";
import { compileRoutine, compileScene, ownerOfScript, routineObjectId, sceneObjectId } from "./compile";
import type { AutomationConfig, DriftItem, ScriptConfig } from "./config-ops";
import type { ConfigJob, ConfigJobService } from "./config-jobs.service";

export interface HaScriptView {
  status: SyncStatus;
  error: string | null;
  syncedAt: number | null;
  entityId: string | null;
}

const DRIFT_TEXT: Record<DriftItem["reason"], string> = {
  missing: "It was removed from Home Assistant",
  changed: "It was changed in Home Assistant",
  enabled_changed: "It was switched on or off in Home Assistant",
};

export interface Verification {
  scripts?: { objectId: string; config: ScriptConfig }[];
  automations?: { id: string; config: AutomationConfig; enabled: boolean }[];
}

export const scriptView = (r: { syncStatus: SyncStatus; syncError: string | null; syncedAt: number | null; haEntityId: string | null }): HaScriptView =>
  ({ status: r.syncStatus, error: r.syncError, syncedAt: r.syncedAt, entityId: r.haEntityId });

/**
 * Keeps Home Assistant's copy of Alice's scenes and routines (as scripts) up to date. Changes are queued for the
 * config-worker; when it finishes, the result is written back so the app can show "synced" or why it is not.
 */
export class HaSyncService {
  private reconcilers: ((householdId: string, userId: string | null) => void)[] = [];
  private verifiers: ((householdId: string) => Verification)[] = [];
  private driftHandlers: ((householdId: string, drifted: DriftItem[], checkedAutomationIds: string[]) => void)[] = [];
  private driftListeners: ((householdId: string, names: string[]) => void)[] = [];

  constructor(private readonly db: Db, private readonly jobs: ConfigJobService, private readonly now: () => number = Date.now) {
    jobs.onResult("script.upsert", (job) => this.applyScript(job));
    jobs.onResult("config.verify", (job) => this.applyVerify(job));
  }

  /** Can changes be applied to Home Assistant right now? (A connection and a stored admin token are needed.) */
  ready(householdId: string): { ok: true } | { ok: false; reason: string } {
    const s = this.jobs.status(householdId);
    if (!s.connected) return { ok: false, reason: "Home Assistant is not connected" };
    if (!s.adminTokenSet) return { ok: false, reason: "Add a Home Assistant admin token so this can also run from Home Assistant" };
    return { ok: true };
  }

  private mark(table: typeof scenes | typeof routines, id: string, patch: { syncStatus: SyncStatus; syncError?: string | null; syncedAt?: number | null; haEntityId?: string | null }) {
    this.db.update(table).set(patch).where(eq(table.id, id)).run();
  }

  syncScene(householdId: string, scene: typeof scenes.$inferSelect, userId: string | null = null) {
    const ready = this.ready(householdId);
    if (!ready.ok) return this.mark(scenes, scene.id, { syncStatus: "not_synced", syncError: ready.reason });
    try {
      const { objectId, config } = compileScene(scene);
      this.jobs.enqueue(householdId, { op: "script.upsert", objectId, config }, { requestedBy: userId, dedupeKey: `script:${objectId}` });
      this.mark(scenes, scene.id, { syncStatus: "pending", syncError: null });
    } catch (e) {
      this.mark(scenes, scene.id, { syncStatus: "failed", syncError: e instanceof Error ? e.message : String(e) });
    }
  }

  syncRoutine(householdId: string, routine: typeof routines.$inferSelect, userId: string | null = null) {
    const ready = this.ready(householdId);
    if (!ready.ok) return this.mark(routines, routine.id, { syncStatus: "not_synced", syncError: ready.reason });
    // A routine calls its scenes' scripts, so any scene not yet in HA goes first (jobs run in the order they were queued).
    for (const step of routine.steps) {
      if (step.type !== "scene") continue;
      const sc = this.db.select().from(scenes).where(eq(scenes.id, step.sceneId)).get();
      if (sc && sc.syncStatus !== "synced" && sc.syncStatus !== "pending") this.syncScene(householdId, sc, userId);
    }
    try {
      const { objectId, config } = compileRoutine(routine);
      this.jobs.enqueue(householdId, { op: "script.upsert", objectId, config }, { requestedBy: userId, dedupeKey: `script:${objectId}` });
      this.mark(routines, routine.id, { syncStatus: "pending", syncError: null });
    } catch (e) {
      this.mark(routines, routine.id, { syncStatus: "failed", syncError: e instanceof Error ? e.message : String(e) });
    }
  }

  removeScene(householdId: string, sceneId: string) { this.removeScript(householdId, sceneObjectId(sceneId)); }
  removeRoutine(householdId: string, routineId: string) { this.removeScript(householdId, routineObjectId(routineId)); }

  private removeScript(householdId: string, objectId: string) {
    if (!this.ready(householdId).ok) return;
    this.jobs.enqueue(householdId, { op: "script.delete", objectId }, { dedupeKey: `script:${objectId}` });
  }

  private applyScript(job: ConfigJob) {
    const objectId = String(job.payload.objectId ?? "");
    const owner = ownerOfScript(objectId);
    if (!owner) return;
    const table = owner.kind === "scene" ? scenes : routines;
    if (!this.db.select({ id: table.id }).from(table).where(eq(table.id, owner.id)).get()) return; // deleted since
    if (job.status === "done") this.mark(table, owner.id, { syncStatus: "synced", syncError: null, syncedAt: this.now(), haEntityId: (job.result?.entityId as string | undefined) ?? `script.${objectId}` });
    else this.mark(table, owner.id, { syncStatus: "failed", syncError: job.error ?? "Home Assistant did not accept it" });
  }

  /** Other services register what they need re-sent after reconnecting or adding an admin token (automations, voice, mode helper). */
  onReconcile(fn: (householdId: string, userId: string | null) => void) {
    this.reconcilers.push(fn);
  }

  // ---- drift: what Home Assistant has versus what Alice meant to write ----

  /** Other services add the things they own (automations) to a verification. */
  provideVerification(fn: (householdId: string) => Verification, onDrift: (householdId: string, drifted: DriftItem[], checkedAutomationIds: string[]) => void) {
    this.verifiers.push(fn);
    this.driftHandlers.push(onDrift);
  }

  /** Called with the names of items that newly drifted, e.g. to tell the admins. */
  onDrift(fn: (householdId: string, names: string[]) => void) {
    this.driftListeners.push(fn);
  }

  /**
   * Asks the worker to read back everything Alice has put in Home Assistant and compare it. Items that were edited or
   * removed there are marked `drifted`; a resync puts them back. Returns false when nothing can be checked.
   */
  verify(householdId: string): boolean {
    if (!this.ready(householdId).ok) return false;
    const live = ["synced", "drifted"] as const;
    const scriptsOut: { objectId: string; config: ScriptConfig }[] = [];
    for (const r of this.db.select().from(scenes).where(and(eq(scenes.householdId, householdId), inArray(scenes.syncStatus, [...live]))).all()) { try { scriptsOut.push(compileScene(r)); } catch { /* shown as failed on the next sync */ } }
    for (const r of this.db.select().from(routines).where(and(eq(routines.householdId, householdId), inArray(routines.syncStatus, [...live]))).all()) { try { scriptsOut.push(compileRoutine(r)); } catch { /* same */ } }
    const automationsOut: NonNullable<Verification["automations"]> = [];
    for (const v of this.verifiers) { const x = v(householdId); scriptsOut.push(...(x.scripts ?? [])); automationsOut.push(...(x.automations ?? [])); }
    if (!scriptsOut.length && !automationsOut.length) return false;
    this.jobs.enqueue(householdId, { op: "config.verify", scripts: scriptsOut, automations: automationsOut }, { dedupeKey: "verify" });
    return true;
  }

  /** How many scenes, routines and automations are marked drifted. */
  driftedCount(householdId: string): number {
    const n = (table: typeof scenes | typeof routines | typeof automations) => this.db.select({ id: table.id }).from(table).where(and(eq(table.householdId, householdId), eq(table.syncStatus, "drifted"))).all().length;
    return n(scenes) + n(routines) + n(automations);
  }

  verifyAll() {
    for (const r of this.db.select({ householdId: haConnections.householdId }).from(haConnections).all()) this.verify(r.householdId);
  }

  private applyVerify(job: ConfigJob) {
    if (job.status !== "done") return; // a failed check says nothing about the items
    const drifted = ((job.result?.drifted as DriftItem[] | undefined) ?? []);
    const householdId = (this.db.select({ h: haConnections.householdId }).from(haConnections).where(eq(haConnections.id, job.connectionId)).get())?.h;
    if (!householdId) return;
    const checkedScripts = ((job.payload.scripts as { objectId: string }[]) ?? []).map((x) => x.objectId);
    const checkedAutomations = ((job.payload.automations as { id: string }[]) ?? []).map((x) => x.id);
    const newly: string[] = [];
    for (const id of checkedScripts) {
      const owner = ownerOfScript(id);
      if (!owner) continue;
      const table = owner.kind === "scene" ? scenes : routines;
      const row = this.db.select().from(table).where(eq(table.id, owner.id)).get();
      if (!row) continue;
      const d = drifted.find((x) => x.kind === "script" && x.id === id);
      if (d) {
        if (row.syncStatus !== "drifted") newly.push(row.name);
        this.mark(table, owner.id, { syncStatus: "drifted", syncError: DRIFT_TEXT[d.reason] });
      } else if (row.syncStatus === "drifted") this.mark(table, owner.id, { syncStatus: "synced", syncError: null }); // someone put it back
    }
    for (const h of this.driftHandlers) h(householdId, drifted, checkedAutomations);
    // Automations report their own newly drifted names through the handler above; scripts are reported here.
    if (newly.length) for (const l of this.driftListeners) l(householdId, newly);
  }

  /** Every household with a connection. Called at startup so work that was waiting for a worker or a token is not forgotten. */
  reconcileAll() {
    for (const r of this.db.select({ householdId: haConnections.householdId }).from(haConnections).all()) this.reconcile(r.householdId, null);
  }

  /** Re-queues everything that is not in Home Assistant yet or failed to get there. */
  reconcile(householdId: string, userId: string | null = null) {
    if (!this.ready(householdId).ok) return 0;
    let n = 0;
    for (const s of this.db.select().from(scenes).where(and(eq(scenes.householdId, householdId), inArray(scenes.syncStatus, ["not_synced", "failed", "drifted"]))).all()) { this.syncScene(householdId, s, userId); n++; }
    for (const r of this.db.select().from(routines).where(and(eq(routines.householdId, householdId), inArray(routines.syncStatus, ["not_synced", "failed", "drifted"]))).all()) { this.syncRoutine(householdId, r, userId); n++; }
    for (const fn of this.reconcilers) fn(householdId, userId);
    return n;
  }
}
