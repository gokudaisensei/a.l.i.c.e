import { createConnection, createLongLivedTokenAuth, type Connection } from "home-assistant-js-websocket";
import { type BackupInfo, type HaConfigApi, HaConfigHttpError } from "@/modules/home-assistant/config-api";
import { type AutomationConfig, MODE_HELPER_ENTITY, MODE_HELPER_NAME, type ScriptConfig } from "@/modules/home-assistant/config-ops";

/** The real thing: REST for config files and reloads, a WebSocket for helpers and voice exposure. Uses the admin token. */
export class HaAdminApi implements HaConfigApi {
  private conn: Connection | null = null;

  constructor(private readonly baseUrl: string, private readonly token: string) {}

  private async rest(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method, headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new HaConfigHttpError(res.status, `HA ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    try { return text ? JSON.parse(text) : null; } catch { return text; }
  }

  private async ws(): Promise<Connection> {
    this.conn ??= await createConnection({ auth: createLongLivedTokenAuth(this.baseUrl, this.token) });
    return this.conn;
  }

  async getScript(objectId: string) {
    try { return await this.rest("GET", `/api/config/script/config/${objectId}`); } catch (e) { if (e instanceof HaConfigHttpError && e.status === 404) return null; throw e; }
  }

  async getAutomation(id: string) {
    try { return await this.rest("GET", `/api/config/automation/config/${id}`); } catch (e) { if (e instanceof HaConfigHttpError && e.status === 404) return null; throw e; }
  }

  async automationEnabled(id: string) {
    const entityId = await this.automationEntityId(id);
    if (!entityId) return null;
    const st = await this.rest("GET", `/api/states/${entityId}`);
    return st?.state === "on" ? true : st?.state === "off" ? false : null;
  }

  async putScript(objectId: string, config: ScriptConfig) { await this.rest("POST", `/api/config/script/config/${objectId}`, config); }
  async deleteScript(objectId: string) { try { await this.rest("DELETE", `/api/config/script/config/${objectId}`); } catch (e) { if (!(e instanceof HaConfigHttpError && e.status === 404)) throw e; } }
  async putAutomation(id: string, config: AutomationConfig) { await this.rest("POST", `/api/config/automation/config/${id}`, config); }
  async deleteAutomation(id: string) { try { await this.rest("DELETE", `/api/config/automation/config/${id}`); } catch (e) { if (!(e instanceof HaConfigHttpError && e.status === 404)) throw e; } }
  async reload(domain: "script" | "automation") { await this.rest("POST", `/api/services/${domain}/reload`, {}); }

  async automationEntityId(id: string) {
    const states: { entity_id: string; attributes: { id?: string } }[] = await this.rest("GET", "/api/states");
    return states.find((s) => s.entity_id.startsWith("automation.") && s.attributes.id === id)?.entity_id ?? null;
  }

  async setAutomationEnabled(entityId: string, enabled: boolean) {
    await this.rest("POST", `/api/services/automation/${enabled ? "turn_on" : "turn_off"}`, { entity_id: entityId });
  }

  async ensureModeSelect(options: string[]) {
    const conn = await this.ws();
    const existing = await conn.sendMessagePromise<{ id: string; name: string }[]>({ type: "input_select/list" });
    if (!existing.some((i) => `input_select.${i.id}` === MODE_HELPER_ENTITY)) {
      await conn.sendMessagePromise({ type: "input_select/create", name: MODE_HELPER_NAME, options, initial: options[0], icon: "mdi:home-switch" });
    }
    return { entityId: MODE_HELPER_ENTITY };
  }

  async exposeEntities(entityIds: string[], expose: boolean) {
    const conn = await this.ws();
    await conn.sendMessagePromise({ type: "homeassistant/expose_entity", assistants: ["conversation"], entity_ids: entityIds, should_expose: expose });
  }

  private async backups() {
    return (await (await this.ws()).sendMessagePromise<{ backups: any[] }>({ type: "backup/info" })).backups;
  }

  async generateBackup(name: string) {
    const conn = await this.ws();
    const { backup_job_id } = await conn.sendMessagePromise<{ backup_job_id: string }>({ type: "backup/generate", agent_ids: ["backup.local"], name, include_database: true, include_homeassistant: true, include_all_addons: false });
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
    await (await this.ws()).sendMessagePromise({ type: "backup/delete", backup_id: backupId });
  }

  async restoreBackup(backupId: string) {
    await (await this.ws()).sendMessagePromise({ type: "backup/restore", backup_id: backupId, agent_id: "backup.local", restore_database: true, restore_homeassistant: true });
  }

  async close() { this.conn?.close(); this.conn = null; }
}
