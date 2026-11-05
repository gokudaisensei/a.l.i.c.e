import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { configJobs, configWorkerHeartbeat, haConnections } from "@/core/database/schema";
import { AppError } from "@/core/errors/errors";
import { newId } from "@/core/ids";
import { type ConfigOperation, toJob, validateOperation } from "./config-ops";

export interface ConfigJob {
  id: string;
  connectionId: string;
  operation: string;
  payload: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed";
  result: Record<string, unknown> | null;
  error: string | null;
  dedupeKey: string | null;
  completedAt: number | null;
}

type Handler = (job: ConfigJob) => void;

/**
 * The main process's side of the config-worker: it validates changes, queues them, and applies finished results to the
 * scene, routine or automation they belong to. It never sees the admin token.
 */
export class ConfigJobService {
  private handlers: { prefix: string; fn: Handler }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  /** The household's Home Assistant connection, if one is saved. */
  connectionIdFor(householdId: string): string | null {
    return this.db.select({ id: haConnections.id }).from(haConnections).where(eq(haConnections.householdId, householdId)).get()?.id ?? null;
  }

  /** Can changes be applied at all? Needs a connection with an admin token and a worker that has checked in recently. */
  status(householdId: string) {
    const conn = this.db.select().from(haConnections).where(eq(haConnections.householdId, householdId)).get();
    const beat = this.db.select().from(configWorkerHeartbeat).orderBy(desc(configWorkerHeartbeat.lastSeenAt)).get();
    const pending = conn ? this.db.select().from(configJobs).where(and(eq(configJobs.connectionId, conn.id), inArray(configJobs.status, ["pending", "running"]))).all().length : 0;
    const failed = conn ? this.db.select().from(configJobs).where(and(eq(configJobs.connectionId, conn.id), eq(configJobs.status, "failed"), isNull(configJobs.appliedAt))).all().length : 0;
    const lastSeen = beat?.lastSeenAt ?? null;
    return {
      connected: !!conn, adminTokenSet: !!conn?.adminTokenEnc, workerLastSeenAt: lastSeen,
      workerOnline: lastSeen !== null && this.now() - lastSeen < 15_000, pendingJobs: pending, failedJobs: failed,
    };
  }

  /**
   * Queues a validated change. Returns null when the household has no Home Assistant connection (nothing to apply to).
   * A newer job with the same `dedupeKey` replaces any older one still waiting.
   */
  enqueue(householdId: string, op: ConfigOperation, opts: { requestedBy?: string | null; dedupeKey?: string } = {}): string | null {
    const connectionId = this.connectionIdFor(householdId);
    if (!connectionId) return null;
    try { validateOperation(op); } catch (e) { throw new AppError(400, "invalid_config_operation", e instanceof Error ? e.message : "Invalid change"); }
    const { operation, payload } = toJob(op);
    const id = newId("cfg");
    const t = this.now();
    this.db.transaction((tx) => {
      if (opts.dedupeKey) tx.delete(configJobs).where(and(eq(configJobs.dedupeKey, opts.dedupeKey), eq(configJobs.status, "pending"))).run();
      tx.insert(configJobs).values({ id, householdId, connectionId, operation, payload, dedupeKey: opts.dedupeKey ?? null, requestedBy: opts.requestedBy ?? null, runAfter: t, createdAt: t }).run();
    });
    return id;
  }

  get(id: string): ConfigJob | null {
    const r = this.db.select().from(configJobs).where(eq(configJobs.id, id)).get();
    return r ? { id: r.id, connectionId: r.connectionId, operation: r.operation, payload: r.payload, status: r.status, result: r.result, error: r.error, dedupeKey: r.dedupeKey, completedAt: r.completedAt } : null;
  }

  /** Waits for a job to finish (polling the database). For callers that need the outcome, and for tests. */
  async waitFor(id: string, timeoutMs = 10_000): Promise<ConfigJob> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const j = this.get(id);
      if (j && (j.status === "done" || j.status === "failed")) return j;
      if (Date.now() > end) throw new AppError(504, "config_timeout", "The change is still waiting for the config-worker");
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** Registers what to do with finished jobs whose operation starts with `prefix` (e.g. "script."). */
  onResult(prefix: string, fn: Handler) {
    this.handlers.push({ prefix, fn });
  }

  /** Applies every finished job that has not been applied yet. Run on a timer in the server. */
  applyResults(): number {
    const rows = this.db.select().from(configJobs).where(and(inArray(configJobs.status, ["done", "failed"]), isNull(configJobs.appliedAt))).all();
    for (const r of rows) {
      const job = this.get(r.id)!;
      for (const h of this.handlers) if (job.operation.startsWith(h.prefix)) h.fn(job);
      this.db.update(configJobs).set({ appliedAt: this.now() }).where(eq(configJobs.id, r.id)).run();
    }
    return rows.length;
  }

  start(intervalMs = 500) {
    this.timer = setInterval(() => { try { this.applyResults(); } catch { /* retried next tick */ } }, intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
