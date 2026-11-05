/**
 * The fixed set of changes the config-worker is willing to make in Home Assistant with the admin token.
 * The main process builds these from validated Alice data; the worker checks them again and refuses anything outside
 * this shape. There is no way to ask the worker to run an arbitrary service or write an arbitrary config.
 */
export const MODE_HELPER_NAME = "Alice household mode";
export const MODE_HELPER_ENTITY = "input_select.alice_household_mode";

/** Anything the worker writes into HA is named alice_*, so it can only ever touch what Alice created. */
export const ALICE_ID = /^alice_[a-z0-9_]{1,60}$/;
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;

export type HaAction =
  | { service: string; target?: { entity_id: string }; data?: Record<string, unknown>; continue_on_error?: boolean }
  | { delay: { seconds: number } }
  | { parallel: HaAction[] }
  | { event: string; event_data?: Record<string, unknown> };

export type HaTrigger =
  | { platform: "state"; entity_id: string | string[]; to?: string; from?: string }
  | { platform: "numeric_state"; entity_id: string; above: number }
  | { platform: "time"; at: string }
  | { platform: "sun"; event: "sunset" | "sunrise"; offset?: string };

export type HaCondition =
  | { condition: "state"; entity_id: string; state: string }
  | { condition: "template"; value_template: string }
  | { condition: "time"; weekday: string[] };

export interface ScriptConfig { alias: string; description?: string; icon?: string; mode: "single" | "parallel" | "queued" | "restart"; sequence: HaAction[] }
export interface AutomationConfig { alias: string; description?: string; mode: "single" | "parallel" | "queued" | "restart"; trigger: HaTrigger[]; condition: HaCondition[]; action: HaAction[] }

export type ConfigOperation =
  | { op: "script.upsert"; objectId: string; config: ScriptConfig }
  | { op: "script.delete"; objectId: string }
  | { op: "automation.upsert"; id: string; config: AutomationConfig; enabled: boolean }
  | { op: "automation.delete"; id: string }
  | { op: "automation.set_enabled"; id: string; enabled: boolean }
  | { op: "helper.ensure_mode_select"; options: string[] }
  | { op: "voice.expose"; entityIds: string[]; expose: boolean }
  /** Read-only: compare what Alice meant to write with what Home Assistant has now. */
  | { op: "config.verify"; scripts: { objectId: string; config: ScriptConfig }[]; automations: { id: string; config: AutomationConfig; enabled: boolean }[] };

/** Templates the worker accepts. They are fixed strings, so no template from outside is ever executed. */
export const TEMPLATE_SOMEONE_HOME = "{{ states.person | selectattr('state', 'eq', 'home') | list | count > 0 }}";
export const TEMPLATE_NO_ONE_HOME = "{{ states.person | selectattr('state', 'eq', 'home') | list | count == 0 }}";
const ALLOWED_TEMPLATES = new Set([TEMPLATE_SOMEONE_HOME, TEMPLATE_NO_ONE_HOME]);

const SERVICES = new Set([
  "light.turn_on", "light.turn_off", "light.toggle",
  "fan.turn_on", "fan.turn_off", "fan.toggle", "fan.set_percentage", "fan.oscillate", "fan.set_direction", "fan.set_preset_mode",
  "climate.set_hvac_mode", "climate.set_temperature", "climate.set_fan_mode", "climate.set_preset_mode", "climate.set_swing_mode", "climate.turn_on", "climate.turn_off",
  "cover.open_cover", "cover.close_cover", "cover.stop_cover", "cover.set_cover_position",
  "lock.lock", "lock.unlock", "lock.open",
  "switch.turn_on", "switch.turn_off", "switch.toggle", "input_boolean.turn_on", "input_boolean.turn_off", "input_boolean.toggle",
  "media_player.turn_on", "media_player.turn_off", "media_player.toggle",
  "input_number.set_value", "number.set_value",
  "script.turn_on", "scene.turn_on", "input_select.select_option",
]);

export class ConfigOpError extends Error {}

const bad = (m: string): never => { throw new ConfigOpError(m); };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const entity = (v: unknown, what: string) => { if (typeof v !== "string" || !ENTITY_ID.test(v)) bad(`${what} is not an entity id`); };

function checkAction(a: unknown, depth = 0): void {
  if (!isObj(a) || depth > 3) return bad("Invalid action");
  if ("service" in a) {
    const svc = a.service;
    if (typeof svc !== "string") return bad("Invalid service");
    const aliceScript = /^script\.alice_[a-z0-9_]{1,60}$/.test(svc);
    if (!SERVICES.has(svc) && !aliceScript) return bad(`Service ${svc} is not allowed`);
    if (a.target !== undefined) { if (!isObj(a.target)) return bad("Invalid target"); entity(a.target.entity_id, "target"); }
    if (svc === "input_select.select_option" && (!isObj(a.target) || a.target.entity_id !== MODE_HELPER_ENTITY)) return bad("Only the Alice mode helper may be selected");
    if (svc === "script.turn_on" && (!isObj(a.target) || !/^script\.alice_[a-z0-9_]{1,60}$/.test(String(a.target.entity_id)))) return bad("Only Alice scripts may be started");
    if (a.data !== undefined && !isObj(a.data)) return bad("Invalid data");
    return;
  }
  if ("delay" in a) {
    const s = isObj(a.delay) ? a.delay.seconds : undefined;
    if (typeof s !== "number" || s < 1 || s > 3600) return bad("Delay must be 1 to 3600 seconds");
    return;
  }
  if ("parallel" in a) {
    if (!Array.isArray(a.parallel) || a.parallel.length > 50) return bad("Invalid parallel block");
    for (const x of a.parallel) checkAction(x, depth + 1);
    return;
  }
  if ("event" in a) {
    if (a.event !== "alice_notification") return bad("Only alice_notification events may be fired");
    return;
  }
  bad("Unknown action type");
}

function checkTrigger(t: unknown) {
  if (!isObj(t)) return bad("Invalid trigger");
  if (t.platform === "state") { for (const e of Array.isArray(t.entity_id) ? t.entity_id : [t.entity_id]) entity(e, "trigger entity"); return; }
  if (t.platform === "numeric_state") { entity(t.entity_id, "trigger entity"); if (typeof t.above !== "number") bad("numeric trigger needs 'above'"); return; }
  if (t.platform === "time") { if (typeof t.at !== "string" || !/^\d{2}:\d{2}(:\d{2})?$/.test(t.at)) bad("Invalid time"); return; }
  if (t.platform === "sun") { if (t.event !== "sunset" && t.event !== "sunrise") bad("Invalid sun event"); return; }
  bad(`Trigger ${String(t.platform)} is not allowed`);
}

function checkCondition(c: unknown) {
  if (!isObj(c)) return bad("Invalid condition");
  if (c.condition === "state") { entity(c.entity_id, "condition entity"); if (typeof c.state !== "string") bad("Invalid state"); return; }
  if (c.condition === "template") { if (typeof c.value_template !== "string" || !ALLOWED_TEMPLATES.has(c.value_template)) bad("That template is not allowed"); return; }
  if (c.condition === "time") { if (!Array.isArray(c.weekday) || c.weekday.some((d) => !["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(String(d)))) bad("Invalid weekdays"); return; }
  bad(`Condition ${String(c.condition)} is not allowed`);
}

/** Throws ConfigOpError if the operation is outside what the worker may do. */
export function validateOperation(o: ConfigOperation): void {
  switch (o.op) {
    case "script.upsert":
      if (!ALICE_ID.test(o.objectId)) return bad("Script ids must start with alice_");
      if (!isObj(o.config) || typeof o.config.alias !== "string" || !Array.isArray(o.config.sequence) || o.config.sequence.length < 1 || o.config.sequence.length > 60) return bad("Invalid script");
      for (const a of o.config.sequence) checkAction(a);
      return;
    case "script.delete": case "automation.delete": case "automation.set_enabled":
      if (!ALICE_ID.test("id" in o ? o.id : o.objectId)) return bad("Ids must start with alice_");
      return;
    case "automation.upsert":
      if (!ALICE_ID.test(o.id)) return bad("Automation ids must start with alice_");
      if (!isObj(o.config) || typeof o.config.alias !== "string" || !Array.isArray(o.config.trigger) || !o.config.trigger.length || o.config.trigger.length > 20) return bad("Invalid automation");
      for (const t of o.config.trigger) checkTrigger(t);
      for (const c of o.config.condition ?? []) checkCondition(c);
      if (!Array.isArray(o.config.action) || !o.config.action.length || o.config.action.length > 60) return bad("Invalid automation actions");
      for (const a of o.config.action) checkAction(a);
      return;
    case "helper.ensure_mode_select":
      if (!Array.isArray(o.options) || o.options.length < 2 || o.options.length > 10 || o.options.some((x) => typeof x !== "string" || !/^[a-z_]{1,20}$/.test(x))) return bad("Invalid options");
      return;
    case "voice.expose":
      if (!Array.isArray(o.entityIds) || o.entityIds.length < 1 || o.entityIds.length > 200) return bad("Invalid entity list");
      for (const e of o.entityIds) entity(e, "entity");
      if (typeof o.expose !== "boolean") bad("expose must be true or false");
      return;
    case "config.verify":
      if (!Array.isArray(o.scripts) || !Array.isArray(o.automations) || o.scripts.length + o.automations.length > 500) return bad("Invalid verification request");
      for (const x of o.scripts) validateOperation({ op: "script.upsert", objectId: x.objectId, config: x.config });
      for (const x of o.automations) validateOperation({ op: "automation.upsert", id: x.id, config: x.config, enabled: x.enabled });
      return;
    default:
      return bad("Unknown operation");
  }
}

/** The change the worker would make, in the shape stored in config_jobs (operation + payload). */
export function toJob(o: ConfigOperation): { operation: string; payload: Record<string, unknown> } {
  const { op, ...payload } = o;
  return { operation: op, payload };
}

export function fromJob(operation: string, payload: Record<string, unknown>): ConfigOperation {
  return { op: operation, ...payload } as ConfigOperation;
}


// ---- comparing what we wrote with what Home Assistant stores ----

const KEY_RENAMES: Record<string, string> = { service: "action", platform: "trigger" };

/**
 * Home Assistant rewrites what it is given (`service` becomes `action`, `platform` becomes `trigger`, defaults appear or
 * vanish, keys are reordered). This reduces both sides to the same plain form so only real differences remain.
 */
export function canonicalConfig(value: unknown): unknown {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v !== "object" || v === null) return v;
    const entries: [string, unknown][] = [];
    for (const key of Object.keys(v as object)) {
      const val = (v as Record<string, unknown>)[key];
      if (key === "id" || val === undefined || val === null || val === "") continue; // ids are ours/HA's bookkeeping; empties are defaults
      if (key === "continue_on_error" && val === false) continue;
      entries.push([KEY_RENAMES[key] ?? key, walk(val)]);
    }
    // Sort after renaming, so the order does not depend on which name a key had.
    const out: Record<string, unknown> = Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return out;
  };
  const c = walk(value) as Record<string, unknown>;
  if (c && typeof c === "object") {
    // Newer Home Assistant stores the top-level lists in the plural (triggers, conditions, actions).
    for (const [plural, singular] of [["triggers", "trigger"], ["conditions", "condition"], ["actions", "action"]] as const) {
      if (plural in c) { c[singular] = c[plural]; delete c[plural]; }
    }
    if (c.mode === "single") delete c.mode; // the default
    if (Array.isArray(c.condition) && c.condition.length === 0) delete c.condition;
    // A single trigger/condition may be stored as an object instead of a list.
    for (const k of ["trigger", "condition", "sequence", "action"]) if (c[k] && !Array.isArray(c[k]) && k !== "action") c[k] = [c[k]];
    if (Array.isArray(c.condition) && c.condition.length === 0) delete c.condition;
    return Object.fromEntries(Object.entries(c).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  return c;
}

export const sameConfig = (a: unknown, b: unknown) => JSON.stringify(canonicalConfig(a)) === JSON.stringify(canonicalConfig(b));

export interface DriftItem {
  kind: "script" | "automation";
  id: string;
  reason: "missing" | "changed" | "enabled_changed";
}
