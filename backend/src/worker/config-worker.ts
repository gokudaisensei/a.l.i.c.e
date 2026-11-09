import { and, asc, eq, lte } from "drizzle-orm";
import type { Logger } from "pino";
import type { Db } from "../core/database/client";
import { configJobs, configWorkerHeartbeat, haConnections } from "../core/database/schema";
import { open } from "../core/security/sealed";
import { type HaConfigApi, type HaConfigApiFactory, HaConfigHttpError } from "../modules/home-assistant/config-api";
import { ConfigOpError, type DriftItem, fromJob, sameConfig, type ConfigOperation, validateOperation } from "../modules/home-assistant/config-ops";

const MAX_ATTEMPTS = 3;

/** Turns an operation into HA calls and returns what the main process wants to know. */
async function perform(api: HaConfigApi, o: ConfigOperation): Promise<Record<string, unknown>> {
  switch (o.op) {
    case "script.upsert":
      await api.putScript(o.objectId, o.config);
      await api.reload("script");
      return { entityId: `script.${o.objectId}` };
    case "script.delete":
      await api.deleteScript(o.objectId);
      await api.reload("script");
      return {};
    case "automation.upsert": {
      await api.putAutomation(o.id, o.config);
      await api.reload("automation");
      const entityId = await api.automationEntityId(o.id);
      if (entityId) await api.setAutomationEnabled(entityId, o.enabled);
      return { entityId };
    }
    case "automation.delete":
      await api.deleteAutomation(o.id);
      await api.reload("automation");
      return {};
    case "automation.set_enabled": {
      const entityId = await api.automationEntityId(o.id);
      if (!entityId) throw new ConfigOpError("That automation is not in Home Assistant yet");
      await api.setAutomationEnabled(entityId, o.enabled);
      return { entityId };
    }
    case "helper.ensure_mode_select":
      return await api.ensureModeSelect(o.options);
    case "voice.expose":
      await api.exposeEntities(o.entityIds, o.expose);
      return {};
    case "backup.generate": {
      const r = await api.generateBackup(o.name);
      return { backupId: r.backupId, sizeBytes: r.sizeBytes };
    }
    case "backup.info": return { ...(await api.backupInfo(o.backupId)) };
    case "backup.delete": await api.deleteBackup(o.backupId); return {};
    case "backup.restore": await api.restoreBackup(o.backupId); return {};
    case "config.verify": {
      const drifted: DriftItem[] = [];
      for (const x of o.scripts) {
        const have = await api.getScript(x.objectId);
        if (have === null) drifted.push({ kind: "script", id: x.objectId, reason: "missing" });
        else if (!sameConfig(x.config, have)) drifted.push({ kind: "script", id: x.objectId, reason: "changed" });
      }
      for (const x of o.automations) {
        const have = await api.getAutomation(x.id);
        if (have === null) { drifted.push({ kind: "automation", id: x.id, reason: "missing" }); continue; }
        if (!sameConfig(x.config, have)) { drifted.push({ kind: "automation", id: x.id, reason: "changed" }); continue; }
        const on = await api.automationEnabled(x.id);
        if (on !== null && on !== x.enabled) drifted.push({ kind: "automation", id: x.id, reason: "enabled_changed" });
      }
      return { drifted, checked: o.scripts.length + o.automations.length };
    }
  }
}

/**
 * The only process that opens the Home Assistant admin token. It takes jobs from the database one at a time, checks each
 * is within the fixed set of allowed changes, performs it, and writes the outcome back. It never talks to clients.
 */
export class ConfigWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy: Promise<unknown> | null = null;
  private stopping = false;

  constructor(
    private readonly deps: {
      db: Db;
      privateKeyPem: string;
      apiFactory: HaConfigApiFactory;
      log: Logger;
      now?: () => number;
      name?: string;
      /** Milliseconds to wait before retrying a job that failed for a reason that may pass. */
      retryDelayMs?: number;
    },
  ) {}

  private now = () => this.deps.now?.() ?? Date.now();

  heartbeat(info: Record<string, unknown> | null = null) {
    const name = this.deps.name ?? "config-worker";
    this.deps.db.insert(configWorkerHeartbeat).values({ name, lastSeenAt: this.now(), info })
      .onConflictDoUpdate({ target: configWorkerHeartbeat.name, set: { lastSeenAt: this.now(), info } }).run();
  }

  private claim() {
    const next = this.deps.db.select().from(configJobs).where(and(eq(configJobs.status, "pending"), lte(configJobs.runAfter, this.now()))).orderBy(asc(configJobs.createdAt)).limit(1).get();
    if (!next) return null;
    const got = this.deps.db.update(configJobs).set({ status: "running", startedAt: this.now(), attempts: next.attempts + 1 })
      .where(and(eq(configJobs.id, next.id), eq(configJobs.status, "pending"))).returning().get();
    return got ?? null;
  }

  /** Runs at most one job. Returns false when there was nothing to do. */
  async tick(): Promise<boolean> {
    this.heartbeat();
    const job = this.claim();
    if (!job) return false;
    const finish = (patch: Partial<typeof configJobs.$inferInsert>) => this.deps.db.update(configJobs).set({ completedAt: this.now(), ...patch }).where(eq(configJobs.id, job.id)).run();
    let api: HaConfigApi | null = null;
    try {
      const op = fromJob(job.operation, job.payload);
      validateOperation(op);
      const conn = this.deps.db.select().from(haConnections).where(eq(haConnections.id, job.connectionId)).get();
      if (!conn) throw new ConfigOpError("That Home Assistant connection no longer exists");
      if (!conn.adminTokenEnc) throw new ConfigOpError("No admin token has been stored for this Home Assistant");
      let token: string;
      try { token = open(conn.adminTokenEnc, this.deps.privateKeyPem); } catch { throw new ConfigOpError("The stored admin token cannot be read by this worker"); }
      api = this.deps.apiFactory(conn.baseUrl, token);
      const result = await perform(api, op);
      finish({ status: "done", result, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const permanent = err instanceof ConfigOpError || (err instanceof HaConfigHttpError && [400, 401, 403, 404, 405].includes(err.status));
      if (!permanent && job.attempts < MAX_ATTEMPTS) {
        this.deps.log.warn({ jobId: job.id, op: job.operation, attempt: job.attempts, err: msg }, "config job failed, will retry");
        this.deps.db.update(configJobs).set({ status: "pending", error: msg, runAfter: this.now() + (this.deps.retryDelayMs ?? 5_000) * job.attempts }).where(eq(configJobs.id, job.id)).run();
      } else {
        this.deps.log.error({ jobId: job.id, op: job.operation, err: msg }, "config job failed");
        finish({ status: "failed", error: msg.slice(0, 500) });
      }
    } finally {
      await api?.close().catch(() => {});
    }
    return true;
  }

  /** Runs jobs until none are due. For tests and one-shot use. */
  async drain(max = 200) {
    let n = 0;
    while (n < max && !this.stopping && (await this.tick())) n++;
    return n;
  }

  /** A job still `running` at start belongs to a worker that died: put it back in the queue (the operations are safe to repeat). */
  recoverInterrupted(): number {
    return this.deps.db.update(configJobs).set({ status: "pending" }).where(eq(configJobs.status, "running")).returning({ id: configJobs.id }).all().length;
  }

  start(intervalMs = 1000) {
    const n = this.recoverInterrupted();
    if (n) this.deps.log.warn({ jobs: n }, "put jobs interrupted by the last shutdown back in the queue");
    this.stopping = false;
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = this.drain().catch((err) => this.deps.log.error({ err: String(err) }, "worker loop failed")).finally(() => { this.busy = null; });
    }, intervalMs);
  }

  /** Stops taking jobs and resolves once the one in progress has finished. */
  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.busy;
  }
}
