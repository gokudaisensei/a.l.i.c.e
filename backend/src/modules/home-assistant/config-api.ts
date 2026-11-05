import type { AutomationConfig, ScriptConfig } from "./config-ops";

/** What the worker can do in Home Assistant with the admin token. Narrow on purpose. */
export interface HaConfigApi {
  putScript(objectId: string, config: ScriptConfig): Promise<void>;
  deleteScript(objectId: string): Promise<void>;
  putAutomation(id: string, config: AutomationConfig): Promise<void>;
  deleteAutomation(id: string): Promise<void>;
  reload(domain: "script" | "automation"): Promise<void>;
  /** What Home Assistant has stored for this script, or null if there is none. */
  getScript(objectId: string): Promise<unknown | null>;
  getAutomation(id: string): Promise<unknown | null>;
  /** Is the automation currently on in Home Assistant? Null if it is not loaded. */
  automationEnabled(id: string): Promise<boolean | null>;
  /** The entity id Home Assistant gave the automation with this config id, once it has loaded. */
  automationEntityId(id: string): Promise<string | null>;
  setAutomationEnabled(entityId: string, enabled: boolean): Promise<void>;
  /** Creates the helper that mirrors the household mode if it is missing. */
  ensureModeSelect(options: string[]): Promise<{ entityId: string }>;
  exposeEntities(entityIds: string[], expose: boolean): Promise<void>;
  close(): Promise<void>;
}

export type HaConfigApiFactory = (baseUrl: string, adminToken: string) => HaConfigApi;

export class HaConfigHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
