"use client";
/**
 * Connects the app's store to the Alice backend: loads the household into `S`, keeps it current from `/ws`,
 * and turns taps into commands. The screens keep reading `S`; only where it comes from has changed.
 */
import { ApiError, del, get, patch, post, put } from "./api";
import { ROOMS, type Builder, type Activity, type Dev, type DevType, type Person, type Role } from "./data";
import { S, SCENES, bump, toast, type SceneItem } from "./store";
import { loadAdminSummary, loadPreferences } from "./admin";

/* ---------- what the backend sends (only the parts we read) ---------- */
interface Cap { name: string; operations?: string[]; metadata?: Record<string, unknown> }
interface Entity { entityId: string; name: string; domain: string; availability: string; values: Record<string, unknown>; capabilities: Cap[] }
export interface Thing {
  id: string; name: string; areaId: string | null; hidden: boolean; manufacturer: string | null; available: boolean;
  primary: Entity | null; favorite: boolean; settings?: { powerLimitW: number | null; voiceExposed: boolean };
}
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const CONTACT_CLASSES = new Set(["door", "window", "garage_door", "opening"]);
const hasCap = (e: Entity, n: string) => e.capabilities.some((c) => c.name === n);

/** Devices with no tile of their own are shown as simple on/off tiles with their own icon and name for what they are. */
const OTHER: Record<string, [string, string]> = {
  media_player: ["play", "Media player"], vacuum: ["rocket", "Vacuum"], humidifier: ["cloud", "Humidifier"], water_heater: ["thermo", "Water heater"],
  valve: ["flow", "Valve"], siren: ["bell", "Siren"], remote: ["play", "Remote"], alarm_control_panel: ["shield", "Alarm"],
};

/** The tile type for a Thing, or null when the design has no tile for it yet. */
function tileType(e: Entity): DevType | null {
  switch (e.domain) {
    case "light": return hasCap(e, "brightness") ? "dim" : "light";
    case "switch": case "input_boolean": return "plug";
    case "fan": return "fan";
    case "climate": return "climate";
    case "lock": return "lock";
    case "cover": return "contact";
    case "camera": return "camera";
    case "binary_sensor": return CONTACT_CLASSES.has(String(e.values.device_class)) ? "contact" : null;
    default: return OTHER[e.domain] && e.capabilities.some((c) => c.name === "power" && c.operations?.includes("turn_on")) ? "other" : null;
  }
}

/** The app-level values of a Thing, in the shape the tiles already read. */
export function toDev(t: Thing): Dev | null {
  const e = t.primary;
  if (!e || t.hidden) return null;
  const type = tileType(e);
  if (!type) return null;
  const d: Dev = { id: t.id, n: t.name, r: t.areaId ?? "none", t: type, hw: t.manufacturer ?? "Home Assistant", ent: e.entityId, ops: e.capabilities.flatMap((c) => c.operations ?? []), fav: t.favorite ? 1 : 0, voice: t.settings?.voiceExposed ? 1 : 0, g: 1 };
  if (type === "other") { d.ic = OTHER[e.domain]![0]; d.kind = OTHER[e.domain]![1]; }
  if (t.settings?.powerLimitW) d.limit = t.settings.powerLimitW;
  apply(d, e);
  return d;
}

/** Copies current values from an entity onto a Dev (used for the first load and for live updates). */
function apply(d: Dev, e: Pick<Entity, "values" | "availability">) {
  const v = e.values;
  switch (d.t) {
    case "dim": d.on = v.power === true; d.v = num(v.brightness) ?? d.v ?? 100; break;
    case "light": case "other": d.on = v.power === true; break;
    case "plug": d.on = v.power === true; d.w = num(v.power_w) ?? d.w ?? 0; break;
    case "fan": d.on = v.power === true; d.sp = Math.min(3, Math.max(1, Math.ceil((num(v.fan_speed) ?? 33) / 33.4))); break;
    case "climate": d.on = v.power !== false && v.hvac_mode !== "off"; d.tgt = num(v.target_temperature) ?? num(v.temperature) ?? d.tgt ?? 24; d.cur = num(v.temperature) ?? d.cur ?? d.tgt; break;
    case "lock": d.locked = v.lock === "locked"; break;
    case "contact": d.open = v.cover !== undefined ? v.cover !== "closed" : v.binary_sensor === true; break;
  }
}

/* ---------- scenes and routines ---------- */
interface SceneDto { id: string; name: string; icon: string | null; description: string | null }
const ICONS = new Set(["sun", "exit", "play", "moon", "home", "bolt", "lock", "unlock", "layers", "bag", "user"]);
/** Which of the design's suggested slots a scene fills, judging by its name. */
const keyFor = (name: string): string | undefined => {
  const n = name.toLowerCase();
  return /morning/.test(n) ? "morning" : /heading out|leaving|away/.test(n) ? "leaving" : /movie/.test(n) ? "movie" : /good ?night|bedtime|night/.test(n) ? "night" : /welcome|arriv/.test(n) ? "welcome" : undefined;
};
function toScene(x: SceneDto, kind: "scene" | "routine"): SceneItem {
  return { id: `${kind}:${x.id}`, n: x.name, ic: x.icon && ICONS.has(x.icon) ? x.icon : kind === "routine" ? "layers" : "play", tag: kind === "routine" ? "Routine" : "Scene", d: x.description ?? "", run: () => {}, key: keyFor(x.name), kind };
}

/** Scenes and routines the person may see, into the store. */
export async function loadScenes(role: Role = S.role) {
  const [scenes, routines] = await Promise.all([
    get<{ scenes: SceneDto[] }>("/scenes").catch(() => ({ scenes: [] as SceneDto[] })),
    role === "guest" ? Promise.resolve({ routines: [] as SceneDto[] }) : get<{ routines: SceneDto[] }>("/routines").catch(() => ({ routines: [] as SceneDto[] })),
  ]);
  SCENES.splice(0, SCENES.length, ...scenes.scenes.map((x) => toScene(x, "scene")), ...routines.routines.map((x) => toScene(x, "routine")));
  bump();
}
export async function deleteScene(s: SceneItem) {
  const [kind, id] = s.id.split(":");
  try { await del(`/${kind}s/${id}`); await loadScenes(); toast(`${s.n} removed, and taken out of Home Assistant`); } catch (e) { toast(e instanceof ApiError ? e.message : "It could not be removed"); }
}

/** Runs a scene or routine as the signed-in person and says how it went. */
export async function runScene(s: SceneItem) {
  const [kind, id] = s.id.split(":") as ["scene" | "routine", string];
  try {
    if (kind === "scene") {
      const r = await post<{ commands: unknown[]; skipped: unknown[] }>(`/scenes/${id}/activate`);
      toast(r.skipped.length ? `${s.n} done. ${r.skipped.length} ${r.skipped.length === 1 ? "device was" : "devices were"} skipped` : `${s.n} done`);
    } else {
      await post(`/routines/${id}/execute`);
      toast(`${s.n} started`);
    }
  } catch (e) { toast(e instanceof ApiError ? e.message : `${s.n} didn't run`); }
}

/* ---------- automations ---------- */
interface AutomationDto { id: string; name: string; enabled: boolean; summary: string; lastTriggeredAt: number | null; haAutomation?: { status: string; error?: string | null } }
const SYNC_TEXT: Record<string, string> = { synced: "In Home Assistant", pending: "Being added to Home Assistant", not_synced: "Not in Home Assistant yet", failed: "Could not be added to Home Assistant", drifted: "Changed in Home Assistant" };
function toAuto(a: AutomationDto) {
  return { id: a.id, n: a.name, s: a.summary, on: a.enabled, last: a.lastTriggeredAt ? `Last run: ${clockOf(a.lastTriggeredAt)}` : "Never run", sync: SYNC_TEXT[a.haAutomation?.status ?? ""] ?? "" };
}
export async function loadAutomations() {
  const r = await get<{ automations: AutomationDto[] }>("/automations").catch(() => null);
  S.autos = r ? r.automations.map(toAuto) : [];
  bump();
  // Home Assistant is told by a separate process; check back until it has caught up.
  if (r?.automations.some((a) => ["pending", "not_synced"].includes(a.haAutomation?.status ?? "")) && ++waits < 8) setTimeout(() => void loadAutomations(), 2500);
  else waits = 0;
}
let waits = 0;

const MODE_KEY = (m: string) => m.toLowerCase();
const ent = (id: string) => S.devices.find((d) => d.id === id)?.ent ?? id;
/** The builder's choices as the backend's automation definition. */
export function buildDefinition(b: Builder) {
  const p = b.trig.p as string;
  const trigger = ({
    arrive: () => (p === "anyone" ? { type: "arrive", person: "anyone" } : { type: "arrive", userId: p }),
    leave: () => ({ type: "leave" }), time: () => ({ type: "time", at: p }), sunset: () => ({ type: "sunset" }),
    door: () => ({ type: "door_opens", entityId: ent(p) }), motion: () => ({ type: "motion", entityId: ent(p) }), power: () => ({ type: "power_over_limit", entityId: ent(p) }),
  } as Record<string, () => object>)[b.trig.k]!();
  const conditions: object[] = [];
  if (b.conds.dark) conditions.push({ type: "dark" });
  if (b.conds.home) conditions.push({ type: "someone_home" });
  if (b.conds.days !== "any") conditions.push({ type: "days", days: b.conds.days });
  if (b.conds.mode !== "any") conditions.push({ type: "mode", mode: MODE_KEY(b.conds.mode) });
  const name = b.name.trim() || "Untitled automation";
  const actions = b.acts.map((a): object => {
    switch (a.v) {
      case "on": return { type: "device", entityId: ent(a.t), action: "turn_on" };
      case "off": return { type: "device", entityId: ent(a.t), action: "turn_off" };
      case "dim": return { type: "device", entityId: ent(a.t), action: "set_brightness", parameters: { brightness_pct: a.n } };
      case "temp": return { type: "device", entityId: ent(a.t), action: "set_temperature", parameters: { temperature: a.n } };
      case "lock": return { type: "device", entityId: ent(a.t), action: "lock" };
      case "notify": return { type: "notify", title: name, message: `${name} just ran`, userIds: [a.t] };
      default: return { type: "scene", sceneId: a.t.replace(/^scene:/, "") };
    }
  });
  return { name, definition: { version: 1, trigger, conditions, actions } };
}

/** A scene: device actions only. A routine: device actions, scenes, a mode, and waits, in order. */
export function buildSceneOrRoutine(b: Builder) {
  const name = b.name.trim() || (b.kind === "routine" ? "Untitled routine" : "Untitled scene");
  const device = (a: Builder["acts"][number]) => ({ entityId: ent(a.t), action: ({ on: "turn_on", off: "turn_off", dim: "set_brightness", temp: "set_temperature", lock: "lock" } as Record<string, string>)[a.v]!, ...(a.v === "dim" ? { parameters: { brightness_pct: a.n } } : a.v === "temp" ? { parameters: { temperature: a.n } } : {}) });
  if (b.kind === "scene") return { name, actions: b.acts.map(device) };
  return {
    name, onFailure: "continue",
    steps: b.acts.map((a) => a.v === "wait" ? { type: "delay", seconds: a.n } : a.v === "mode" ? { type: "mode", mode: a.t.toLowerCase() } : a.v === "scene" ? { type: "scene", sceneId: a.t.replace(/^scene:/, "") } : { type: "device", ...device(a) }),
  };
}

/** Puts something already saved back into the builder to change it. */
export async function editAutomation(id: string) {
  try {
    const a = await get<{ id: string; name: string; definition: { trigger: any; conditions: any[]; actions: any[] } }>(`/automations/${id}`);
    const d = a.definition, t = d.trigger;
    const devId = (entityId: string) => S.devices.find((x) => x.ent === entityId)?.id ?? entityId;
    const trig = t.type === "arrive" ? { k: "arrive", p: t.userId ?? t.person ?? "anyone" } : t.type === "leave" ? { k: "leave", p: null } : t.type === "time" ? { k: "time", p: t.at }
      : t.type === "sunset" ? { k: "sunset", p: null } : t.type === "door_opens" ? { k: "door", p: devId(t.entityId) } : t.type === "power_over_limit" ? { k: "power", p: devId(t.entityId) } : { k: "arrive", p: "anyone" };
    const conds = { dark: false, home: false, days: "any", mode: "any" } as Builder["conds"];
    for (const c of d.conditions) { if (c.type === "dark") conds.dark = true; else if (c.type === "someone_home") conds.home = true; else if (c.type === "days") conds.days = c.days; else if (c.type === "mode") conds.mode = c.mode[0].toUpperCase() + c.mode.slice(1); }
    const verbs: Record<string, string> = { turn_on: "on", turn_off: "off", set_brightness: "dim", set_temperature: "temp", lock: "lock" };
    const acts = d.actions.flatMap((x): Builder["acts"] => x.type === "device" && verbs[x.action] ? [{ v: verbs[x.action]!, t: devId(x.entityId), n: x.parameters?.brightness_pct ?? x.parameters?.temperature }]
      : x.type === "notify" ? [{ v: "notify", t: x.userIds?.[0] ?? S.meId }] : x.type === "scene" ? [{ v: "scene", t: `scene:${x.sceneId}` }] : []);
    S.b = { kind: "automation", editId: id, name: a.name, trig, conds, acts };
    bump(); toast(`Editing “${a.name}”. Save to change it in Home Assistant`);
  } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't open it"); }
}

export async function previewAutomation(b: Builder) {
  try {
    const r = await post<{ summary: string; warnings: string[] }>("/automations/preview", buildDefinition(b));
    toast(r.warnings.length ? `${r.summary} ${r.warnings[0]}` : `Dry run: ${r.summary} Nothing changed`);
  } catch (e) { toast(e instanceof ApiError ? e.message : "The dry run failed"); }
}
export async function saveBuilder(b: Builder, stepUp: () => Promise<void>) {
  const kind = b.kind ?? "automation";
  const send = () => b.editId && kind === "automation" ? patch(`/automations/${b.editId}`, buildDefinition(b))
    : kind === "automation" ? post("/automations", buildDefinition(b))
    : post(kind === "scene" ? "/scenes" : "/routines", buildSceneOrRoutine(b));
  try {
    try { await send(); } catch (e) { if (e instanceof ApiError && e.code === "step_up_required") { await stepUp(); await send(); } else throw e; }
    if (kind === "automation") await loadAutomations(); else await loadScenes();
    toast(kind === "automation" ? "Saved. Alice is adding it to Home Assistant" : kind === "scene" ? "Scene saved. It shows on Home" : "Routine saved. It shows on Home");
    bump();
    return true;
  } catch (e) { toast(e instanceof ApiError ? e.message : "It could not be saved"); return false; }
}
export async function toggleAutomation(id: string, on: boolean) {
  const a = S.autos.find((x) => x.id === id);
  if (a) { a.on = on; bump(); }
  try { await post(`/automations/${id}/${on ? "enable" : "disable"}`); toast(a ? (on ? `${a.n} is on` : `${a.n} is paused`) : "Done"); }
  catch (e) { if (a) { a.on = !on; bump(); } toast(e instanceof ApiError ? e.message : "That didn't change"); }
}
export async function deleteAutomation(id: string) {
  try { await del(`/automations/${id}`); S.autos = S.autos.filter((x) => x.id !== id); bump(); toast("Automation removed, and taken out of Home Assistant"); }
  catch (e) { toast(e instanceof ApiError ? e.message : "It could not be removed"); }
}

/** A fresh, empty builder for a live home (the design's starter uses sample devices). */
export const emptyBuilder = (kind: Builder["kind"] = "automation"): Builder => ({ kind, name: "", trig: { k: "arrive", p: "anyone" }, conds: { dark: false, home: false, days: "any", mode: "any" }, acts: [] });

/* ---------- activity, energy ---------- */
interface ActivityDto { id: string; kind: string; summary: string; actor: { name: string } | null; tone: "info" | "warn"; at: number; new: boolean }
const KIND_ICON: Record<string, string> = { device: "bulb", lock: "lock", scene: "layers", routine: "layers", mode: "home", automation: "bolt", alert: "bolt", presence: "user" };
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const clockOf = (at: number) => {
  const d = new Date(at), today = new Date();
  const hm = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
  return d.toDateString() === today.toDateString() ? hm : `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${hm}`;
};
function toActivity(a: ActivityDto): Activity {
  return { ic: KIND_ICON[a.kind] ?? "bolt", t: a.actor ? `<b>${esc(a.actor.name)}</b> ${esc(a.summary)}` : esc(a.summary), time: clockOf(a.at), nw: a.new, tone: a.tone === "warn" ? "warn" : undefined };
}
export async function markSeen() { await post("/activity/seen").catch(() => {}); }

async function loadActivity() {
  const r = await get<{ items: ActivityDto[] }>("/activity?limit=30").catch(() => null);
  if (r) S.activity = r.items.map(toActivity);
}

export async function loadEnergy() {
  const to = Date.now();
  const [sum, hist, devs, pat] = await Promise.all([
    get<{ nowWatts: number | null; todayKwh: number | null }>("/energy/summary").catch(() => null),
    get<{ series: { kwh: number }[] }>(`/energy/history?from=${to - 24 * 3_600_000}&to=${to}&resolution=hour`).catch(() => null),
    get<{ devices: { name: string; watts: number | null }[] }>("/energy/devices").catch(() => null),
    get<{ pattern: { sentence: string } | null }>("/energy/pattern").catch(() => null),
  ]);
  if (!sum) { S.energyLive = null; return; }
  S.energyLive = {
    nowW: sum.nowWatts, todayKwh: sum.todayKwh, pattern: pat?.pattern?.sentence ?? null, hourly: hist?.series.map((x) => x.kwh) ?? [],
    top: (devs?.devices ?? []).filter((d) => d.watts != null && d.watts > 0).sort((a, b) => b.watts! - a.watts!).slice(0, 3).map((d) => ({ n: d.name, w: d.watts! })),
  };
  bump();
}

/* ---------- who is home ---------- */
interface PeopleDto { people: { userId: string; displayName: string; role: Role; home: boolean | null; personEntityId: string | null }[]; unlinkedPersons?: { entityId: string; name: string }[] }
function applyPeople(r: PeopleDto) {
  S.people = r.people.map((p, i): Person => ({ id: p.userId, n: p.displayName, role: p.role, home: p.home === true, c: (i % 6) + 1, linked: !!p.personEntityId }));
  S.persons = r.unlinkedPersons ?? [];
}
export async function refreshPeople() {
  const r = await get<PeopleDto>("/household/people").catch(() => null);
  if (r) { applyPeople(r); bump(); }
}

/* ---------- loading ---------- */
const MODE_NAME: Record<string, string> = { home: "Home", away: "Away", night: "Night", vacation: "Vacation" };
let loaded = false;
export const isLive = () => loaded;
/** After sign-out: the next person starts from nothing. */
export function resetLoaded() { loaded = false; S.devices = []; S.people = []; S.activity = []; S.autos = []; SCENES.splice(0); ROOMS.splice(0); S.adm = null; S.alertsLive = null; S.energyLive = null; S.insight = null; }

/** The household, as the signed-in person may see it. */
export async function loadHome(role: Role, userId: string) {
  const [dev, areas, mode, people] = await Promise.all([
    get<{ devices: Thing[] }>("/devices"),
    get<{ areas: { id: string; name: string }[] }>("/areas").catch(() => ({ areas: [] })),
    get<{ mode: string }>("/household/mode").catch(() => null),
    role === "guest" ? Promise.resolve(null) : get<PeopleDto>("/household/people").catch(() => null),
  ]);
  const devices = dev.devices.map(toDev).filter((d): d is Dev => !!d);
  const rooms = areas.areas.filter((a) => devices.some((d) => d.r === a.id)).map((a) => ({ id: a.id, n: a.name }));
  if (devices.some((d) => d.r === "none")) rooms.push({ id: "none", n: "No room yet" });
  ROOMS.splice(0, ROOMS.length, ...rooms);
  S.devices = devices;
  S.room = "all";
  if (mode) S.mode = MODE_NAME[mode.mode] ?? "Home";
  if (people) applyPeople(people);
  await loadScenes(role);
  S.meId = userId;
  await Promise.all([loadActivity(), loadEnergy(), role === "guest" ? Promise.resolve() : loadAutomations()]);
  S.b = emptyBuilder();
  void loadAlerts();
  void loadInsights();
  void loadPreferences().then(bump);
  if (role === "admin") void loadAdminSummary();
  S.sync = Date.now();
  loaded = true;
  bump();
}

/* ---------- realtime ---------- */
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3002/ws";
let ws: WebSocket | null = null;
let retry = 0;
let closing = false;

interface Msg { type: string; data?: any }

function onMessage(m: Msg) {
  const d = m.data;
  switch (m.type) {
    case "entity.updated": {
      const dv = S.devices.find((x) => x.id === d.thingId);
      if (dv && d.role === "primary") { apply(dv, d); S.sync = Date.now(); bump(); }
      break;
    }
    case "activity.created": S.activity = [toActivity(d), ...S.activity].slice(0, 30); bump(); break;
    case "insights.changed": void loadInsights(); break;
    case "alert.created": case "alert.cleared": void loadAlerts(); break;
    case "devices.changed": void refetchDevices(); break;
    case "household.mode_changed": S.mode = MODE_NAME[d.mode] ?? S.mode; bump(); break;
    case "presence.changed": { const p = S.people.find((x) => x.id === d.userId); if (p) { p.home = d.home === true; bump(); } break; }
    case "command.failed": case "command.timed_out": onCommandEnd(d.id, false, d); break;
    case "command.confirmed": onCommandEnd(d.id, true, d); break;
  }
}

export function startRealtime() {
  closing = false;
  if (ws) return;
  const open = () => {
    const sock = new WebSocket(WS_URL);
    ws = sock;
    sock.onopen = () => {
      retry = 0;
      for (const resource of ["devices", "commands", "household", "activity", "alerts"]) sock.send(JSON.stringify({ type: "subscribe", resource }));
    };
    sock.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore a bad frame */ } };
    sock.onclose = () => {
      ws = null;
      if (closing) return;
      setTimeout(() => { void refetchDevices(); open(); }, Math.min(15_000, 500 * 2 ** retry++));
    };
  };
  open();
  setInterval(() => { void loadEnergy(); }, 60_000);
}
export function stopRealtime() { closing = true; ws?.close(); ws = null; }

export async function refetchDevices() {
  try {
    const dev = await get<{ devices: Thing[] }>("/devices");
    S.devices = dev.devices.map(toDev).filter((d): d is Dev => !!d);
    S.sync = Date.now(); bump();
  } catch { /* the next event or reconnect retries */ }
}

/* ---------- rename, hide ---------- */
/** A device's own name, or null to go back to the name Home Assistant gives it. */
export async function renameDevice(id: string, name: string | null) {
  try { await patch(`/devices/${id}/name`, { name }); await refetchDevices(); toast(name ? "Renamed" : "Name reset"); } catch (e) { toast(e instanceof ApiError ? e.message : "That didn't save"); }
}
export async function setHidden(id: string, hidden: boolean) {
  try { await post(`/devices/${id}/${hidden ? "hide" : "unhide"}`); await refetchDevices(); await loadHidden(); toast(hidden ? "Hidden. You can show it again at the bottom of Rooms" : "Showing again"); } catch (e) { toast(e instanceof ApiError ? e.message : "That didn't save"); }
}
export async function loadHidden() {
  const r = await get<{ devices: Thing[] }>("/devices?includeHidden=true").catch(() => null);
  S.hiddenDevs = r ? r.devices.filter((t) => t.hidden).map((t) => ({ id: t.id, n: t.name })) : [];
  bump();
}

/* ---------- Alice's suggestions ---------- */
export async function loadInsights() {
  const r = await get<{ insights: { id: string; title: string; reason: string; action: { type: string; mode: string } }[] }>("/insights").catch(() => null);
  if (!r) return;
  const i = r.insights.find((x) => x.action.type === "set_mode");
  S.insight = i ? { id: i.id, to: i.action.mode[0]!.toUpperCase() + i.action.mode.slice(1), why: i.reason } : null;
  bump();
}
export async function dismissInsight(id: string) {
  S.insight = null; bump();
  try { await post(`/insights/${encodeURIComponent(id)}/dismiss`); toast("Okay, Alice will not ask again for now"); } catch (e) { toast(e instanceof ApiError ? e.message : "That didn't save"); await loadInsights(); }
}

/* ---------- alerts ---------- */
interface AlertDto { id: string; kind: string; title: string; detail: string; ackedAt: number | null }
export async function loadAlerts() {
  const r = await get<{ alerts: AlertDto[] }>("/alerts").catch(() => null);
  if (r) { S.alertsLive = r.alerts.filter((a) => !a.ackedAt).map((a) => ({ id: a.id, t: a.title, d: a.detail, ic: a.kind === "left_open" ? "door" : "bolt" })); bump(); }
}
export async function ackAlert(id: string) {
  S.alertsLive = (S.alertsLive ?? []).filter((a) => a.id !== id); bump();
  try { await post(`/alerts/${id}/ack`); toast("Alert cleared. Alice will tell you if it happens again"); } catch (e) { toast(e instanceof ApiError ? e.message : "That didn't save"); await loadAlerts(); }
}

/* ---------- Ask Alice ---------- */
export interface Suggestion { kind: "commands" | "scene" | "routine" | "mode" | "device"; label: string; detail: string; icon: string; sensitive: boolean; plan: any }
export async function interpretText(text: string): Promise<Suggestion[]> {
  try { return (await post<{ items: Suggestion[] }>("/ai/interpret", { text })).items; } catch { return []; }
}
/** What a command does to the tile straight away, before Home Assistant confirms. */
function optimisticFor(action: string, p?: Record<string, unknown>): (d: Dev) => void {
  return (d) => {
    if (action === "turn_on") d.on = true; else if (action === "turn_off") d.on = false;
    else if (action === "lock") d.locked = true; else if (action === "unlock") d.locked = false;
    else if (action === "set_brightness") { d.v = Number(p?.brightness_pct); d.on = true; }
    else if (action === "set_temperature") { d.tgt = Number(p?.temperature); d.on = true; }
  };
}
/** Runs what the person chose in Ask Alice, through the same paths as a tap. */
export function runPlan(s: Suggestion, stepUp: () => Promise<void>, goRooms: (name: string) => void, setMode: (m: string) => void) {
  const p = s.plan;
  if (p.type === "commands") {
    for (const c of p.commands as { thingId: string; action: string; parameters?: Record<string, unknown> }[]) {
      const d = S.devices.find((x) => x.id === c.thingId);
      void sendCommand(c.thingId, c.action, c.parameters, optimisticFor(c.action, c.parameters), d?.n ?? "That", stepUp);
    }
    toast(s.label);
  } else if (p.type === "scene") { const sc = SCENES.find((x) => x.id === `scene:${p.id}`); if (sc) void runScene(sc); }
  else if (p.type === "routine") { const sc = SCENES.find((x) => x.id === `routine:${p.id}`); if (sc) void runScene(sc); }
  else if (p.type === "mode") setMode(p.mode[0].toUpperCase() + p.mode.slice(1));
  else if (p.type === "device") { const d = S.devices.find((x) => x.id === p.thingId); if (d) goRooms(d.n); }
}

/* ---------- favourites and voice ---------- */
/** Adds or removes a favourite (your own list; the order is the order on screen). */
export async function toggleFavourite(id: string) {
  const d = S.devices.find((x) => x.id === id);
  if (!d) return;
  const was = d.fav ?? 0;
  d.fav = was ? 0 : 1; bump();
  try {
    await put("/favorites", { thingIds: S.devices.filter((x) => x.fav).map((x) => x.id) });
    toast(d.fav ? `${d.n} added to Favourites` : `${d.n} removed from Favourites`);
  } catch (e) { d.fav = was; bump(); toast(e instanceof ApiError ? e.message : "That didn't save"); }
}
/** Shares or stops sharing a device with Alexa and Google (an admin setting; Home Assistant applies it). */
export async function toggleVoice(id: string) {
  const d = S.devices.find((x) => x.id === id);
  if (!d) return;
  const was = d.voice ?? 0;
  d.voice = was ? 0 : 1; bump();
  try {
    await patch(`/devices/${id}/settings`, { voiceExposed: !!d.voice });
    toast(d.voice ? `${d.n} shared with Alexa and Google` : `${d.n} no longer shared`);
  } catch (e) { d.voice = was; bump(); toast(e instanceof ApiError ? e.message : "That didn't save"); }
}

/* ---------- commands ---------- */
interface Pending { revert: () => void; label: string }
const pending = new Map<string, Pending>();

function onCommandEnd(id: string, ok: boolean, c: { error?: { message?: string } | null }) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (!ok) { p.revert(); toast(c.error?.message ? `${p.label}: ${c.error.message}` : `${p.label} didn't go through`); }
}

/**
 * Sends a command for a device. `optimistic` changes the tile at once; if the command fails (now, or later over `/ws`)
 * it is put back and the person is told why. A sensitive action asks for a passkey first.
 */
export async function sendCommand(id: string, action: string, parameters: Record<string, unknown> | undefined, optimistic: (d: Dev) => void, label: string, stepUp: () => Promise<void>) {
  const d = S.devices.find((x) => x.id === id);
  if (!d) return;
  const before = { ...d };
  const revert = () => { Object.assign(d, before); bump(); };
  optimistic(d); S.sync = Date.now(); bump();
  const send = () => post<{ id: string; state: string }>(`/devices/${id}/commands`, { action, parameters });
  try {
    let c: { id: string };
    try { c = await send(); }
    catch (e) { if (e instanceof ApiError && e.code === "step_up_required") { await stepUp(); c = await send(); } else throw e; }
    pending.set(c.id, { revert, label });
    setTimeout(() => pending.delete(c.id), 60_000);
  } catch (e) {
    revert();
    toast(e instanceof ApiError ? e.message : "That didn't go through");
  }
}
