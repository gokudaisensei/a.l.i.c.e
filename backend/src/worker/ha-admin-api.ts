import { createConnection, createLongLivedTokenAuth, type Connection } from "home-assistant-js-websocket";
import { type BackupInfo, type HaConfigApi, HaConfigHttpError } from "../modules/home-assistant/config-api";
import { type AutomationConfig, MODE_HELPER_ENTITY, MODE_HELPER_NAME, type ScriptConfig } from "../modules/home-assistant/config-ops";

const CALL_TIMEOUT_MS = 30_000;

interface HaState { entity_id: string; state: string; attributes: { id?: string } }

/** Raised when Home Assistant does not answer in time (it may be restarting). */
export class HaTimeout extends Error {}

const timed = <T>(p: Promise<T>, ms: number, what: string) => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new HaTimeout(`Home Assistant did not answer ${what} within ${ms / 1000}s`)), ms);
  p.then(resolve, reject).finally(() => clearTimeout(t));
});

/** The real thing: REST for config files and reloads, a WebSocket for helpers and voice exposure. Uses the admin token. */
export class HaAdminApi implements HaConfigApi {
  private conn: Connection | null = null;
  /** All states, read once per job (one job, one instance): looking each automation up separately would download them every time. */
  private states: Promise<HaState[]> | null = null;

  constructor(private readonly baseUrl: string, private readonly token: string) {}

  private async rest(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method, headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new HaConfigHttpError(res.status, `HA ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    try { return text ? JSON.parse(text) : null; } catch { return text; }
  }

  private async ws(): Promise<Connection> {
    this.conn ??= await timed(createConnection({ auth: createLongLivedTokenAuth(this.baseUrl, this.token) }), CALL_TIMEOUT_MS, "the connection");
    return this.conn;
  }

  private async send<T>(msg: { type: string; [k: string]: unknown }, ms = CALL_TIMEOUT_MS): Promise<T> {
    return timed((await this.ws()).sendMessagePromise<T>(msg), ms, msg.type);
  }

  async getScript(objectId: string) {
    try { return await this.rest("GET", `/api/config/script/config/${objectId}`); } catch (e) { if (e instanceof HaConfigHttpError && e.status === 404) return null; throw e; }
  }

  async getAutomation(id: string) {
    try { return await this.rest("GET", `/api/config/automation/config/${id}`); } catch (e) { if (e instanceof HaConfigHttpError && e.status === 404) return null; throw e; }
  }

  async automationEnabled(id: string) {
    const st = (await this.allStates()).find((s) => s.entity_id.startsWith("automation.") && s.attributes.id === id);
    return st?.state === "on" ? true : st?.state === "off" ? false : null;
  }

  async putScript(objectId: string, config: ScriptConfig) { await this.rest("POST", `/api/config/script/config/${objectId}`, config); }
  async deleteScript(objectId: string) { try { await this.rest("DELETE", `/api/config/script/config/${objectId}`); } catch (e) { if (!(e instanceof HaConfigHttpError && e.status === 404)) throw e; } }
  async putAutomation(id: string, config: AutomationConfig) { await this.rest("POST", `/api/config/automation/config/${id}`, config); }
  async deleteAutomation(id: string) { try { await this.rest("DELETE", `/api/config/automation/config/${id}`); } catch (e) { if (!(e instanceof HaConfigHttpError && e.status === 404)) throw e; } }
  async reload(domain: "script" | "automation") { await this.rest("POST", `/api/services/${domain}/reload`, {}); this.states = null; }

  private allStates(): Promise<HaState[]> { return (this.states ??= this.rest("GET", "/api/states")); }

  async automationEntityId(id: string) {
    return (await this.allStates()).find((s) => s.entity_id.startsWith("automation.") && s.attributes.id === id)?.entity_id ?? null;
  }

  async setAutomationEnabled(entityId: string, enabled: boolean) {
    await this.rest("POST", `/api/services/automation/${enabled ? "turn_on" : "turn_off"}`, { entity_id: entityId });
    this.states = null;
  }

  async ensureModeSelect(options: string[]) {
    const existing = await this.send<{ id: string; name: string }[]>({ type: "input_select/list" });
    if (!existing.some((i) => `input_select.${i.id}` === MODE_HELPER_ENTITY)) {
      await this.send({ type: "input_select/create", name: MODE_HELPER_NAME, options, initial: options[0], icon: "mdi:home-switch" });
    }
    return { entityId: MODE_HELPER_ENTITY };
  }

  async exposeEntities(entityIds: string[], expose: boolean) {
    await this.send({ type: "homeassistant/expose_entity", assistants: ["conversation"], entity_ids: entityIds, should_expose: expose });
  }

  private async backups() {
    return (await this.send<{ backups: any[] }>({ type: "backup/info" })).backups;
  }

  async generateBackup(name: string) {
    const { backup_job_id } = await this.send<{ backup_job_id: string }>({ type: "backup/generate", agent_ids: ["backup.local"], name, include_database: true, include_homeassistant: true, include_all_addons: false });
    const end = Date.now() + 180_000;
    for (;;) {
      const mine = (await this.backups()).find((b) => b.backup_id === backup_job_id);
      if (mine) return { backupId: mine.backup_id as string, sizeBytes: Number(Object.values<{ size: number }>(mine.agents ?? {})[0]?.size ?? 0) };
      if (Date.now() > end) throw new Error("Home Assistant did not finish the backup in time");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async backupInfo(backupId: string): Promise<BackupInfo> {
    const b = (await this.backups()).find((x) => x.backup_id === backupId);
    if (!b) return { exists: false, sizeBytes: null, homeassistantIncluded: false, databaseIncluded: false, failedAgents: [], date: null };
    const agents = Object.values<{ size: number }>(b.agents ?? {});
    return { exists: true, sizeBytes: agents.length ? Number(agents[0]!.size) : null, homeassistantIncluded: !!b.homeassistant_included, databaseIncluded: !!b.database_included, failedAgents: b.failed_agent_ids ?? [], date: b.date ?? null };
  }

  async deleteBackup(backupId: string) {
    await this.send({ type: "backup/delete", backup_id: backupId });
  }

  async restoreBackup(backupId: string) {
    try {
      await this.send({ type: "backup/restore", backup_id: backupId, agent_id: "backup.local", restore_database: true, restore_homeassistant: true }, 120_000);
    } catch (e) {
      // Home Assistant restarts to restore, so it may never answer. Retrying would restore a second time.
      if (!(e instanceof HaTimeout)) throw e;
    }
  }

  async close() { this.conn?.close(); this.conn = null; }
}
