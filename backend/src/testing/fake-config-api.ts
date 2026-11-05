import type { HaConfigApi } from "@/modules/home-assistant/config-api";
import { HaConfigHttpError } from "@/modules/home-assistant/config-api";
import type { AutomationConfig, ScriptConfig } from "@/modules/home-assistant/config-ops";
import { MODE_HELPER_ENTITY } from "@/modules/home-assistant/config-ops";

/** An in-memory Home Assistant admin API for tests. Records what was written. */
/** What Home Assistant does to a config on the way back out: new key names, an id, and defaults filled or dropped. */
function asHaStores(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(asHaStores);
  if (typeof v !== "object" || v === null) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as object).reverse()) { // different key order too
    const val = (v as Record<string, unknown>)[k];
    out[k === "service" ? "action" : k === "platform" ? "trigger" : k] = asHaStores(val);
  }
  return out;
}

export class FakeConfigApi implements HaConfigApi {
  scripts = new Map<string, ScriptConfig>();
  automations = new Map<string, AutomationConfig>();
  enabled = new Map<string, boolean>();
  reloads: string[] = [];
  exposed = new Map<string, boolean>();
  modeHelperOptions: string[] | null = null;
  calls: string[] = [];
  failWith: Error | null = null;
  /** Lets a test create the helper entity in the fake Home Assistant when the worker asks for it. */
  onEnsureModeSelect?: () => void;
  closed = 0;

  private fail() { if (this.failWith) throw this.failWith; }

  async getScript(id: string) { this.calls.push(`getScript:${id}`); const c = this.scripts.get(id); return c ? asHaStores({ ...c, mode: c.mode === "single" ? undefined : c.mode }) : null; }
  async getAutomation(id: string) { this.calls.push(`getAutomation:${id}`); const c = this.automations.get(id); return c ? asHaStores({ id, ...c, condition: c.condition.length ? c.condition : undefined }) : null; }
  async automationEnabled(id: string) { return this.automations.has(id) ? (this.enabled.get(`automation.${id}`) ?? true) : null; }
  async putScript(id: string, c: ScriptConfig) { this.fail(); this.calls.push(`putScript:${id}`); this.scripts.set(id, c); }
  async deleteScript(id: string) { this.fail(); this.calls.push(`deleteScript:${id}`); this.scripts.delete(id); }
  async putAutomation(id: string, c: AutomationConfig) { this.fail(); this.calls.push(`putAutomation:${id}`); this.automations.set(id, c); }
  async deleteAutomation(id: string) { this.fail(); this.calls.push(`deleteAutomation:${id}`); this.automations.delete(id); this.enabled.delete(`automation.${id}`); }
  async reload(d: "script" | "automation") { this.fail(); this.reloads.push(d); }
  async automationEntityId(id: string) { return this.automations.has(id) ? `automation.${id}` : null; }
  async setAutomationEnabled(entityId: string, on: boolean) { this.fail(); this.calls.push(`enable:${entityId}:${on}`); this.enabled.set(entityId, on); }
  async ensureModeSelect(options: string[]) { this.fail(); this.calls.push("ensureModeSelect"); this.modeHelperOptions = options; this.onEnsureModeSelect?.(); return { entityId: MODE_HELPER_ENTITY }; }
  async exposeEntities(ids: string[], expose: boolean) { this.fail(); this.calls.push(`expose:${expose}:${ids.join(",")}`); for (const id of ids) this.exposed.set(id, expose); }
  async close() { this.closed++; }
}

export const httpError = (status: number) => new HaConfigHttpError(status, `HA said ${status}`);
