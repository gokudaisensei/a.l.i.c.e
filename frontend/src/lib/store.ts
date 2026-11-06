"use client";
import { create } from "zustand";
import { useSyncExternalStore } from "react";
import { savePreference } from "./admin";
import { disablePush, enablePush } from "./push";
import { undoCommand, dismissInsight, saveBuilder, ackAlert, interpretText, runPlan, type Suggestion, deleteAutomation, toggleFavourite, toggleVoice, isLive, markSeen, previewAutomation, runScene, sendCommand, toggleAutomation } from "./live";
import {
  ROOMS, MODES, PRIMARY, CLOCK, W, ENERGY, TRIG, TDEF,
  type Auto, type Dev, type Person, type Role, type Tod, type Activity, type Builder,
} from "./data";

/* ---------- state: one mutable object + a version counter ---------- */
export interface PK { title: string; desc: string; ok: () => void; state: "idle" | "go" | "ok" }
export interface PalItem { ic: string; l: string; s?: string; k?: string; dis?: boolean; run?: () => void }

export const S = {
  meId: "" as string, role: "admin" as Role, tod: "auto" as "auto" | Tod, view: "home", mode: "Home",
  room: "all", group: "room", q: "", voiceOnly: false, at: "people",
  snooze: {} as Record<string, boolean>, ack: {} as Record<string, boolean>, sync: 0,
  people: [] as Person[], persons: [] as { entityId: string; name: string }[], devices: [] as Dev[], activity: [] as Activity[], insight: null as null | { id: string; to: string; why: string },
  edit: null as null | { id: string; name: string },
  hiddenDevs: [] as { id: string; n: string }[],
  alertsLive: null as null | { id: string; t: string; d: string; ic: string }[],
  energyLive: null as null | { pattern: string | null; nowW: number | null; todayKwh: number | null; top: { n: string; w: number }[]; hourly: number[] },
  quiet: true, push: true, adm: null as null | { backupOk: boolean; backupNone: boolean; lastVerified: string; nextBackup: string; updateReady: boolean; healthWarn: boolean }, energy: ENERGY,
  aopen: {} as Record<string, boolean>, bstep: "when" as string | null, exp: {} as Record<string, boolean>,
  autos: [] as Auto[], b: { name: "", trig: { k: "arrive", p: "anyone" }, conds: { dark: false, home: false, days: "any", mode: "any" }, acts: [] } as Builder,
  hc: null as null | "run",
  sheet: null as string | null, pk: null as PK | null,
  pal: null as null | { q: string; sel: number; items: PalItem[] },
  toast: { id: 0, msg: "", title: undefined as string | undefined, tone: "neutral" as "neutral" | "ok" | "warn", show: false, undo: null as null | (() => void) },
};

export const useStore = create<{ v: number }>(() => ({ v: 0 }));
export const bump = () => useStore.setState((s) => ({ v: s.v + 1 }));
/** Subscribe a component to every state change and hand back the state. */
export function useS() { useStore((s) => s.v); return S; }

/* ---------- navigation bridge (set by the shell) ---------- */
export const PATH: Record<string, string> = { home: "/", rooms: "/rooms", build: "/automate", admin: "/admin" };
let navigate: (p: string) => void = () => {};
export const setNavigator = (fn: (p: string) => void) => { navigate = fn; };
export const NAV_ROLES: Record<string, Role[] | undefined> = { build: ["admin", "member"], admin: ["admin"] };
export function go(v: string, tab?: string) {
  const r = NAV_ROLES[v];
  if (r && !r.includes(S.role)) v = "home";
  S.view = v; if (tab) S.at = tab;
  navigate(PATH[v] ?? "/");
  if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  bump();
}

/* ---------- media query hook ---------- */
export function usePhone() {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia("(max-width:700px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia("(max-width:700px)").matches,
    () => false,
  );
}
export function useMounted() {
  return useSyncExternalStore(() => () => {}, () => true, () => false);
}

/* ---------- helpers ---------- */
export const PERSONA: Record<Role, string> = { admin: "gokul", member: "arjun", guest: "lakshmi" };
const NOBODY: Person = { id: "", n: "", role: "member", home: false, c: 1 };
/** The signed-in person (a blank placeholder before sign-in has finished, so the page frame can render without data). */
export const me = () => S.people.find((p) => p.id === S.meId) ?? S.people.find((p) => p.id === PERSONA[S.role]) ?? S.people[0] ?? NOBODY;
/** The scene suggested for this time of day (the design's ids, or a live scene whose name says so). */
export const primaryScene = (t: Tod) => SCENES.find((s) => (s.key ?? s.id) === PRIMARY[t]);
export const dev = (id: string) => S.devices.find((d) => d.id === id)!;
export const mainClimate = () => S.devices.find((d) => d.t === "climate" && (S.role !== "guest" || d.g));
export const vis = () => S.devices.filter((d) => S.role !== "guest" || d.g);
export const rname = (id: string) => ROOMS.find((r) => r.id === id)!.n;
export const isLight = (d: Dev) => d.t === "light" || d.t === "dim";
const ICON: Record<string, string> = { light: "bulb", dim: "bulb", plug: "plug", fan: "fan", climate: "thermo", lock: "lock", camera: "camera", contact: "door", other: "plug" };
export const icn = (d: Dev) => (d.t === "lock" ? (d.locked ? "lock" : "unlock") : d.ic ?? ICON[d.t]);
export const isOn = (d: Dev) => (d.t === "contact" ? !!d.open : d.t === "lock" || d.t === "camera" ? false : !!d.on);
export const watts = (d: Dev) =>
  d.t === "plug" && d.on ? d.w! : d.t === "climate" && d.on ? 850 : d.t === "fan" && d.on ? 45
  : d.t === "dim" && d.on ? Math.round(d.v! * 0.12) : d.t === "light" && d.on ? 9 : 0;
export const totalW = () => S.energyLive?.nowW != null ? S.energyLive.nowW : S.energyLive ? 0 : 200 + S.devices.reduce((a, d) => a + watts(d), 0);
export const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
export const esc = (s: string) => String(s);
export function tod(): Tod {
  if (S.tod !== "auto") return S.tod;
  const h = new Date().getHours();
  return h >= 5 && h < 11 ? "morning" : h < 17 ? "day" : h < 22 ? "evening" : "night";
}
export const clock = () =>
  S.tod !== "auto" ? CLOCK[S.tod] : new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
export const dateStr = () => new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
export const nowT = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const nowS = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
export const buzz = (n: number) => { try { navigator.vibrate?.(n); } catch {} };

export function backupState() { return { ok: S.adm ? S.adm.backupOk : true }; }
export const adminAttention = () => (backupState().ok ? 0 : 1) + (S.adm?.updateReady ? 1 : 0) + (S.adm?.healthWarn ? 1 : 0);

export interface Alert { id: string; t: string; d: string; ic: string }
export function alerts(): Alert[] {
  if (S.role === "guest") return [];
  if (S.alertsLive) return S.alertsLive;
  const out: Alert[] = [];
  S.devices.filter((d) => d.t === "plug" && d.limit && d.on).forEach((d) => {
    const p = d.w! / d.limit!;
    if (p >= 0.9 && !S.ack["p" + d.id]) out.push({ id: "p" + d.id, t: `${d.n} is at ${Math.round(p * 100)}% of its ${d.limit!.toLocaleString()} W limit`, d: "Alice alerts you at 90%. You can raise the limit in Rooms.", ic: "bolt" });
  });
  S.devices.filter((d) => d.t === "contact" && d.open && !S.ack["o" + d.id]).forEach((d) => out.push({ id: "o" + d.id, t: `${d.n} is open`, d: "Left open for 12 minutes.", ic: "door" }));
  return out;
}
/** One human line about the household, from what actually happened last. */
export function personal(): string | null {
  if (S.role === "guest") return null;
  const plain = (h: string) => h.replace(/<[^>]+>/g, "");
  const a = S.activity.find((x) => /got home|arrived/i.test(x.t)) ?? S.activity[0];
  return a ? `${plain(a.t)} · ${a.time}` : null;
}
export interface StatusChip { ic: string; t: string; warn?: boolean; to: string | null }
export function status() {
  const locks = S.devices.filter((d) => d.t === "lock"), un = locks.filter((l) => !l.locked);
  const opens = S.devices.filter((d) => d.t === "contact" && d.open), al = alerts();
  let line: string;
  if (un.length) line = `${un.map((l) => l.n).join(" and ")} ${un.length > 1 ? "are" : "is"} unlocked.`;
  else if (opens.length) line = `${opens[0].n} is open. Everything else is shut.`;
  else if (S.mode === "Away") line = "Away mode is on. Every door is locked.";
  else if (S.mode === "Vacation") line = "Vacation mode is on. Alice is keeping watch.";
  else if (al.length) line = `Doors are locked. ${W[al.length]} thing${al.length > 1 ? "s" : ""} to look at.`;
  else line = S.mode === "Night" ? "Doors are locked. Sleep well." : "The house is locked up and quiet.";
  const chips: StatusChip[] = [];
  chips.push({ ic: un.length ? "unlock" : "lock", t: un.length ? `${un.length} unlocked` : `${locks.length} of ${locks.length} locked`, warn: !!un.length, to: "locks" });
  chips.push({ ic: opens.length ? "alert" : "door", t: opens.length ? `${opens[0].n} open` : "Nothing left open", warn: !!opens.length, to: "locks" });
  if (S.role !== "guest") chips.push({ ic: "camera", t: "2 cameras online", to: null });
  if (al.length && al[0].id[0] === "p") chips.push({ ic: "bolt", t: "Water heater near its limit", warn: true, to: "alerts" });
  if (S.role === "admin") { const nb = backupState(); chips.push({ ic: nb.ok ? "shieldcheck" : "alert", t: nb.ok ? `Backup verified ${S.adm?.lastVerified ?? "never"}` : "Backup not verified yet", warn: !nb.ok, to: "backup" }); }
  const nw = S.activity.filter((a) => a.nw).length;
  if (nw && S.role !== "guest") chips.push({ ic: "clock", t: `${nw} new since last visit`, to: "activity" });
  return { line, chips, al };
}

/* ---------- scenes ---------- */
export const lockAll = () => S.devices.filter((d) => d.t === "lock").forEach((d) => { d.locked = true; d.by = me().n; d.at = "just now"; });
export interface SceneItem { id: string; n: string; ic: string; tag: string; d: string; run: () => void; key?: string; kind?: "scene" | "routine" }
export const SCENES: SceneItem[] = [];
export function suggestion() { return S.insight; }

/* ---------- toast / overlays ---------- */
/** Wording that means something went wrong: shown as a warning, and announced to screen readers at once. */
const BAD = /\b(couldn.t|could not|didn.t|did not|can.t|cannot|isn.t|wasn.t|won.t|failed|refused|blocked|not allowed|too many|too late|unable|no longer|error|wrong|offline|expired)\b/i;
let toastId = 0;
/** A short notice at the bottom of the screen. `undo` adds an Undo button. Tone is a warning for wording that says something failed. */
export function toast(msg: string, undo?: () => void, opts: { title?: string; tone?: "neutral" | "ok" | "warn" } = {}) {
  S.toast = { id: ++toastId, msg, title: opts.title, tone: opts.tone ?? (BAD.test(msg) ? "warn" : "neutral"), show: true, undo: undo ?? null };
  bump();
}
export function dismissToast() { if (S.toast.show) { S.toast.show = false; bump(); } }
export function commit(msg: string, fn: () => void) {
  const before = structuredClone({ d: S.devices, m: S.mode, p: S.people });
  fn(); S.sync = Date.now(); buzz(14);
  S.activity.unshift({ ic: "sparkle", t: `<b>${me().n}</b>: ${msg}`, time: "just now" });
  S.activity.length = Math.min(S.activity.length, 10);
  bump();
  toast(msg, () => { S.devices = before.d; S.mode = before.m; S.people = before.p; S.activity.shift(); bump(); toast("Undone"); });
}
export const closeOv = () => { S.pk = null; S.pal = null; S.sheet = null; bump(); };
export function openSheet(id: string) { S.pk = null; S.pal = null; S.sheet = id; bump(); }
let stepUpFn: () => Promise<void> = async () => {};
/** The auth module registers the real passkey check here (avoids a circular import). */
export const setStepUp = (f: () => Promise<void>) => { stepUpFn = f; };
export const stepUpNow = () => stepUpFn();
export function passkey(title: string, desc: string, ok: () => void) { S.pk = { title, desc, ok, state: "idle" }; S.pal = null; S.sheet = null; bump(); }
export function pkRun() {
  const k = S.pk; if (!k || k.state !== "idle") return;
  k.state = "go"; bump();
  stepUpFn().then(() => {
    if (S.pk !== k) return;
    k.state = "ok"; bump();
    setTimeout(() => { if (S.pk !== k) return; closeOv(); k.ok(); }, 520);
  }, (e: unknown) => {
    if (S.pk !== k) return;
    k.state = "idle"; bump();
    toast((e as { name?: string })?.name === "NotAllowedError" ? "The passkey prompt was closed" : ((e as Error)?.message || "That didn't work"));
  });
}

/* ---------- builder logic ---------- */
export interface Verb { n: string; ic: string; pick: () => { id: string; n: string }[]; val?: { min: number; max: number; def: number; u: string } }
/** A device can do this (sample devices have no list, so they always can). */
const can = (d: Dev, op: string) => !d.ops || d.ops.includes(op);
export const VERBS: Record<string, Verb> = {
  on: { n: "Turn on", ic: "bulb", pick: () => S.devices.filter((d) => (isLight(d) || d.t === "plug" || d.t === "fan" || d.t === "climate" || d.t === "other") && can(d, "turn_on")) },
  off: { n: "Turn off", ic: "bulb", pick: () => S.devices.filter((d) => (isLight(d) || d.t === "plug" || d.t === "fan" || d.t === "climate" || d.t === "other") && can(d, "turn_off")) },
  dim: { n: "Set brightness", ic: "sun", pick: () => S.devices.filter((d) => d.t === "dim" && can(d, "set_brightness")), val: { min: 1, max: 100, def: 60, u: "%" } },
  temp: { n: "Set temperature", ic: "thermo", pick: () => S.devices.filter((d) => d.t === "climate" && can(d, "set_temperature")), val: { min: 16, max: 30, def: 24, u: "°" } },
  lock: { n: "Lock", ic: "lock", pick: () => S.devices.filter((d) => d.t === "lock" && can(d, "lock")) },
  notify: { n: "Send a notification", ic: "bell", pick: () => S.people.filter((p) => p.role !== "guest").map((p) => ({ id: p.id, n: p.n })) },
  scene: { n: "Run scene", ic: "play", pick: () => SCENES.filter((s) => s.kind !== "routine").map((s) => ({ id: s.id, n: s.n })) },
  wait: { n: "Wait", ic: "clock", pick: () => [{ id: "wait", n: "then" }], val: { min: 1, max: 3600, def: 30, u: "seconds" } },
  mode: { n: "Set mode", ic: "home", pick: () => MODES.map((m) => ({ id: m.k, n: m.k })) },
};
/** Which verbs each kind of thing can use. */
export const VERBS_FOR: Record<string, string[]> = { automation: ["on", "off", "dim", "temp", "lock", "notify", "scene"], scene: ["on", "off", "dim", "temp", "lock"], routine: ["on", "off", "dim", "temp", "lock", "scene", "mode", "wait"] };
export const fmtTime = (t: string | null) => { const [h, m] = (t || "18:30").split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
export const joinL = (a: string[]) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
const nameOf = (v: string, id: string) => { const o = VERBS[v].pick(); return (o.find((x) => x.id === id) || o[0] || { n: "something" }).n; };
const actText = (a: { v: string; t: string; n?: number }) => {
  const n = nameOf(a.v, a.t);
  return ({ on: `turn on ${n}`, off: `turn off ${n}`, dim: `set ${n} to ${a.n}%`, temp: `set ${n} to ${a.n}°`, lock: `lock ${n}`, notify: `send ${n} a notification`, scene: `run the “${n}” scene`, wait: `wait ${a.n} seconds`, mode: `switch to ${n} mode` } as Record<string, string>)[a.v];
};
export function sumParts() {
  const b = S.b, p = b.trig.p as string;
  const w = ({
    arrive: () => `${p === "anyone" ? "someone" : S.people.find((x) => x.id === p)!.n} gets home`,
    leave: () => "everyone has left", time: () => `it is ${fmtTime(p)}`, sunset: () => "the sun sets",
    door: () => `${dev(p).n} opens`, motion: () => `motion is seen in ${rname(p)}`, power: () => `${dev(p).n} goes over its limit`,
  } as Record<string, () => string>)[b.trig.k]();
  const c: string[] = [];
  if (b.conds.dark) c.push("it is dark"); if (b.conds.home) c.push("someone is home");
  if (b.conds.days === "weekdays") c.push("it is a weekday"); if (b.conds.days === "weekends") c.push("it is a weekend");
  if (b.conds.mode !== "any") c.push(`the mode is ${b.conds.mode}`);
  return { w, c, a: b.acts.map(actText) };
}
export const sumPlain = () => { const { w, c, a } = sumParts(); return `When ${w}${c.length ? ", if " + joinL(c) : ""}, ${a.length ? joinL(a) : "do nothing"}.`; };
export function setTrigger(k: string) {
  const live = isLive();
  const first = (f: (d: Dev) => boolean) => S.devices.find(f)?.id ?? null;
  S.b.trig = { k, p: live && k === "door" ? first((d) => d.t === "contact") : live && k === "power" ? first((d) => d.t === "plug" && !!d.limit) : TDEF[k] };
  bump();
}
export function builderAdd(v: string) { const o = VERBS[v].pick()[0]; if (!o) { toast("Nothing in your home can do that yet"); return; } S.b.acts.push({ v, t: o.id, n: VERBS[v].val?.def }); bump(); }
const emptyBuilderLocal = (): Builder => ({ name: "", trig: { k: "arrive", p: "anyone" }, conds: { dark: false, home: false, days: "any", mode: "any" }, acts: [] });
export function builderSave() {
  const b = S.b;
  if (isLive()) { if (!b.acts.length) { toast("Add at least one action first"); return; } void saveBuilder(b, stepUpFn).then((ok) => { if (ok) { const k = b.kind; S.b = { ...emptyBuilderLocal(), kind: k }; bump(); } }); return; }
  if (!b.acts.length) { toast("Add at least one action first"); return; }
  const name = b.name.trim() || "Untitled automation";
  S.autos.unshift({ id: "a" + Date.now(), n: name, s: sumPlain(), on: true, last: "Never run" });
  S.activity.unshift({ ic: "layers", t: `<b>${me().n}</b> saved the automation “${name}”`, time: "just now" });
  bump(); toast("Saved. It is live in Home Assistant now");
}
export function builderTest() {
  if (isLive()) { if (!S.b.acts.length) { toast("Nothing to run yet. Add an action"); return; } void previewAutomation(S.b); return; }
  toast(S.b.acts.length ? `Dry run: Alice would ${joinL(sumParts().a)}. Nothing changed` : "Nothing to run yet. Add an action");
}
export { TRIG };
export type { Builder } from "./data";

/* ---------- command palette ---------- */
const STOP = new Set("turn switch please the all my in on off set to dim lock unlock of a everything degrees percent light lights lamp lamps fan fans plug plugs ac thermostat climate door doors make brighten stop start and".split(" "));
const RK: Record<string, string> = { living: "living", kitchen: "kitchen", bedroom: "bedroom", arjun: "kids", bathroom: "bath", guest: "guest", hall: "hall", garden: "garden", balcony: "living" };
export function cmdItems(q0: string): PalItem[] {
  const q = q0.trim().toLowerCase(), out: PalItem[] = [], guest = S.role === "guest";
  if (!q) {
    ["turn off all lights", "lock everything", guest ? "turn on the guest lamp" : "goodnight", guest ? "set guest ac to 24" : "set living ac to 23", guest ? "go to rooms" : "switch to night mode"]
      .forEach((t) => { const all = cmdItems(t), r = t.includes("mode") ? all.find((x) => x.l.startsWith("Switch to")) : all[0]; if (r && !r.dis && !out.some((o) => o.l === r.l)) out.push(r); });
    return out;
  }
  const words = q.replace(/[^a-z0-9% ]/g, " ").split(/\s+/).filter(Boolean), num = (q.match(/(\d+)/) || [])[1];
  let verb: string | null = null;
  if (/\bunlock\b/.test(q)) verb = "unlock"; else if (/\block\b/.test(q)) verb = "lock";
  else if (/\b(off|stop)\b/.test(q)) verb = "off"; else if (/\b(on|start)\b/.test(q) && !/mode/.test(q)) verb = "on";
  else if (/\b(set|dim|brighten|make)\b/.test(q) && num !== undefined) verb = "set";
  if (verb) {
    const room = Object.keys(RK).find((k) => words.includes(k)), types: string[] = [];
    if (/\blights?\b|\blamps?\b/.test(q)) types.push("light", "dim"); if (/\bfans?\b/.test(q)) types.push("fan");
    if (/\bplugs?\b/.test(q)) types.push("plug"); if (/\b(ac|thermostat|climate)\b/.test(q)) types.push("climate"); if (/\bdoors?\b/.test(q)) types.push("lock");
    const toks = words.filter((w) => !STOP.has(w) && !RK[w] && w.length > 2 && !/^\d/.test(w)), all = /\b(all|everything)\b/.test(q);
    const cand = verb === "on" || verb === "off" ? ["light", "dim", "plug", "fan", "climate"] : verb === "lock" || verb === "unlock" ? ["lock"] : ["dim", "climate"];
    const list = vis().filter((d) => cand.includes(d.t) && (!types.length || types.includes(d.t)) && (!room || d.r === RK[room]) && toks.every((t) => (d.n + " " + d.hw).toLowerCase().includes(t)));
    if (list.length && (room || types.length || toks.length || all || verb === "lock")) {
      const rn = room ? rname(RK[room]) : "", allL = list.every(isLight);
      const noun = list.length === 1 ? list[0].n : `${list.length} ${allL ? "lights" : list.every((d) => d.t === "lock") ? "doors" : "devices"}${rn ? " in " + rn : ""}`;
      const sub = list.slice(0, 4).map((d) => d.n).join(", ") + (list.length > 4 ? "…" : "");
      if (verb === "on" || verb === "off") out.push({ ic: "bulb", l: `Turn ${verb} ${noun}`, s: sub, k: "Enter", run: () => commit(`${noun} turned ${verb}`, () => list.forEach((d) => { d.on = verb === "on"; if (d.t === "dim" && d.on && d.v! < 1) d.v = 50; })) });
      if (verb === "lock") out.push({ ic: "lock", l: `Lock ${noun}`, s: sub, k: "Enter", run: () => commit(`${noun} locked`, () => list.forEach((d) => { d.locked = true; d.by = me().n; d.at = "just now"; })) });
      if (verb === "unlock") out.push({ ic: "unlock", l: `Unlock ${noun}`, s: "Asks for your passkey first", k: "Enter", run: () => passkey(`Unlock ${noun}?`, "Unlocking always needs your passkey.", () => commit(`${noun} unlocked`, () => list.forEach((d) => { d.locked = false; d.by = me().n; d.at = "just now"; }))) });
      if (verb === "set") {
        const n = +num!, cl = list.filter((d) => d.t === "climate"), dm = list.filter((d) => d.t === "dim");
        const useC = cl.length && (!dm.length || /\b(ac|thermostat|climate)\b/.test(q) || (n >= 16 && n <= 30 && !/%|percent/.test(q)));
        const tg = useC ? cl : dm;
        if (tg.length) out.push({ ic: useC ? "thermo" : "bulb", l: useC ? `Set ${tg.length === 1 ? tg[0].n : tg.length + " ACs"} to ${clamp(n, 16, 30)}°` : `Set ${tg.length === 1 ? tg[0].n : tg.length + " lights"} to ${clamp(n, 1, 100)}%`, s: tg.map((d) => d.n).join(", "), k: "Enter",
          run: () => commit("Set " + (useC ? "temperature" : "brightness"), () => tg.forEach((d) => { if (useC) { d.tgt = clamp(n, 16, 30); d.on = true; } else { d.v = clamp(n, 1, 100); d.on = true; } })) });
      }
    }
  }
  if (!guest) {
    SCENES.forEach((s) => {
      const m = q.includes(s.id) || q.includes(s.n.toLowerCase()) || (s.id === "night" && /good ?night|bedtime/.test(q)) || (s.id === "leaving" && /leaving|heading out|going out/.test(q)) || (s.id === "movie" && /film|movie/.test(q)) || (s.id === "welcome" && /welcome|arriv/.test(q));
      if (m) out.push({ ic: s.ic, l: `Run “${s.n}”`, s: s.d, k: "Enter", run: () => commit(`${s.n} done`, s.run) });
    });
    MODES.forEach((m) => { if (q.includes(m.k.toLowerCase()) && (q.includes("mode") || q === m.k.toLowerCase())) out.push({ ic: m.ic, l: `Switch to ${m.k} mode`, s: m.d, run: () => commit(`Mode: ${m.k}`, () => { S.mode = m.k; }) }); });
  }
  const pages: [string, string, string, Role[]?][] = [["home", "Home", "home"], ["rooms", "Rooms and devices", "grid"], ["build", "Automation builder", "flow", ["admin", "member"]], ["admin", "Admin", "shield", ["admin"]], ["admin:backups", "Backups", "disk", ["admin"]], ["admin:support", "Support access", "key", ["admin"]], ["admin:health", "System health", "pulse", ["admin"]], ["admin:updates", "Updates", "rocket", ["admin"]], ["admin:people", "People and invites", "users", ["admin"]]];
  pages.forEach((p) => { if ((!p[3] || p[3].includes(S.role)) && (p[1].toLowerCase().includes(q) || ("go to " + p[1].toLowerCase()).includes(q))) out.push({ ic: p[2], l: `Go to ${p[1]}`, s: "Page", run: () => { const [v, t] = p[0].split(":"); go(v, t); } }); });
  vis().filter((d) => d.n.toLowerCase().includes(q)).slice(0, 3).forEach((d) => out.push({ ic: icn(d), l: d.n, s: `${rname(d.r)} · show in Rooms`, run: () => { S.q = d.n; S.room = "all"; go("rooms"); } }));
  if (!out.length) out.push({ ic: "search", l: "No match yet", s: "Try “turn off the kitchen lights” or “lock everything”", dis: true });
  return out;
}
let palSeq = 0;
/** Ask Alice's answers: the server reads the sentence against this home; pages and devices are matched here. */
function liveItems(q: string, found: Suggestion[]): PalItem[] {
  const out: PalItem[] = found.map((f) => ({
    ic: f.icon, l: f.label, s: f.detail, k: "Enter",
    run: () => {
      const go2 = () => runPlan(f, stepUpFn, (name) => { S.q = name; S.room = "all"; go("rooms"); }, (m) => A.mode(m));
      if (f.sensitive) passkey(`${f.label}?`, "This always needs your passkey, even for admins.", go2); else go2();
    },
  }));
  const local = cmdItems(q).filter((x) => x.s === "Page");
  out.push(...local);
  if (!out.length) out.push({ ic: "search", l: "No match yet", s: "Try “turn off the kitchen lights” or “lock everything”", dis: true });
  return out;
}
function refreshPal(q: string) {
  const seq = ++palSeq;
  void interpretText(q).then((found) => { if (S.pal && seq === palSeq && S.pal.q === q) { S.pal.items = liveItems(q, found); S.pal.sel = 0; bump(); } });
}
export function openPal() {
  S.pk = null; S.sheet = null;
  S.pal = { q: "", sel: 0, items: isLive() ? [] : cmdItems("") }; bump();
  if (isLive()) refreshPal("");
}
export function palQuery(q: string) {
  if (!S.pal) return;
  S.pal.q = q; S.pal.sel = 0;
  if (isLive()) { S.pal.items = liveItems(q, []).filter((x) => !x.dis); bump(); refreshPal(q); return; }
  S.pal.items = cmdItems(q); bump();
}
export function palMove(d: number) { const p = S.pal; if (!p) return; p.sel = (p.sel + d + p.items.length) % p.items.length; bump(); }
export function runPal(i: number) { const it = S.pal?.items[i]; if (!it || it.dis) return; closeOv(); it.run?.(); }

/* ---------- actions ---------- */
/** Switch a device on or off and say so, with a one-tap undo. A fast second tap replaces the toast rather than stacking. */
function flip(id: string, haptic: boolean) {
  const d = dev(id);
  if (isLive()) {
    const target = !d.on;
    if (haptic) buzz(12);
    void sendCommand(id, target ? "turn_on" : "turn_off", undefined, (x) => { x.on = target; }, d.n, stepUpFn)
      .then((cmd) => { if (cmd) toast(`${d.n} ${target ? "on" : "off"}`, () => void undoCommand(cmd)); });
    return;
  }
  d.on = !d.on; if (haptic) buzz(12); S.sync = Date.now(); bump();
  toast(`${d.n} ${d.on ? "on" : "off"}`, () => { d.on = !d.on; S.sync = Date.now(); bump(); toast(`${d.n} ${d.on ? "on" : "off"}`); });
}
export const A = {
  live: (id: string) => toast(`${dev(id).n} opens full screen on a real device`),
  cmd: () => openPal(),
  tog: (id: string) => flip(id, false),
  dtap: (id: string) => {
    const d = dev(id);
    if (d.t === "lock") return d.locked ? A.unlock(id) : A.lock(id);
    if (d.t === "contact" || d.t === "camera") return openSheet(d.id);
    flip(id, true);
  },
  preset: (id: string, n: number) => { const d = dev(id); if (isLive()) { buzz(8); void sendCommand(id, "set_brightness", { brightness_pct: n }, (x) => { x.v = n; x.on = true; }, d.n, stepUpFn); return; } d.v = n; d.on = true; buzz(8); bump(); },
  slide: (id: string, v: number) => { const d = dev(id); if (isLive()) { void sendCommand(id, "set_brightness", { brightness_pct: v }, (x) => { x.v = v; x.on = true; }, d.n, stepUpFn); return; } d.v = v; d.on = true; S.sync = Date.now(); bump(); },
  role: (r: Role) => { S.role = r; go(S.view); },
  setTod: (t: "auto" | Tod) => { S.tod = t; bump(); },
  lock: (id: string) => { const d = dev(id); if (isLive()) { void sendCommand(id, "lock", undefined, (x) => { x.locked = true; x.by = me().n; x.at = "just now"; }, d.n, stepUpFn).then((cmd) => { if (cmd) toast(`${d.n} locked`, () => void undoCommand(cmd)); }); return; } commit(`${d.n} locked`, () => { d.locked = true; d.by = me().n; d.at = "just now"; }); },
  unlock: (id: string) => { const d = dev(id); passkey(`Unlock ${d.n}?`, "Unlocking always needs your passkey, even for admins.", () => isLive() ? (void sendCommand(id, "unlock", undefined, (x) => { x.locked = false; x.by = me().n; x.at = "just now"; }, d.n, stepUpFn).then((cmd) => { if (cmd) toast(`${d.n} unlocked`, () => void undoCommand(cmd)); })) : commit(`${d.n} unlocked`, () => { d.locked = false; d.by = me().n; d.at = "just now"; })); },
  lockall: () => { if (isLive()) { for (const d of S.devices.filter((x) => x.t === "lock" && !x.locked)) void sendCommand(d.id, "lock", undefined, (x) => { x.locked = true; x.by = me().n; x.at = "just now"; }, d.n, stepUpFn); toast("Locking every door"); return; } commit("Every door locked", lockAll); },
  mode: (m: string) => { if (isLive() && S.mode !== m) { const prev = S.mode; S.mode = m; bump(); void import("./api").then(({ put }) => put("/household/mode", { mode: m.toLowerCase() })).then(() => toast(`Mode: ${m}`), () => { S.mode = prev; bump(); toast("Couldn't change the mode"); }); return; } if (S.mode !== m) commit(`Mode: ${m}`, () => { S.mode = m; }); },
  snooze: (id: string) => { if (S.insight) { void dismissInsight(S.insight.id); return; } S.snooze[id] = true; bump(); toast("Okay, Alice will not ask again for now"); },
  scene: (id: string) => { const s = SCENES.find((x) => x.id === id); if (!s) return; if (isLive()) { void runScene(s); return; } commit(`${s.n} done`, s.run); },
  flash: (id: string) => {
    const go2 = () => { const t = document.getElementById("t-" + id); if (!t) return; t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash"); };
    if (S.view !== "home") { go("home"); setTimeout(go2, 120); } else go2();
  },
  editDev: (id: string) => { const d = dev(id); S.edit = { id, name: d.n }; bump(); },
  fav: (id: string) => { if (isLive()) { void toggleFavourite(id); return; } const d = dev(id); d.fav = d.fav ? 0 : 1; bump(); toast(d.fav ? `${d.n} added to Favourites` : `${d.n} removed from Favourites`); },
  voice: (id: string) => { if (isLive()) { void toggleVoice(id); return; } const d = dev(id); d.voice = d.voice ? 0 : 1; bump(); toast(d.voice ? `${d.n} shared with Alexa and Google` : `${d.n} no longer shared`); },
  tgt: (id: string, delta: number) => { const d = dev(id); if (isLive()) { const t = clamp(d.tgt! + delta, 16, 30); void sendCommand(id, "set_temperature", { temperature: t }, (x) => { x.tgt = t; x.on = true; }, d.n, stepUpFn); return; } d.tgt = clamp(d.tgt! + delta, 16, 30); d.on = true; bump(); },
  fan: (id: string, n: number) => { const d = dev(id); if (isLive()) { void sendCommand(id, "set_speed", { percentage: Math.min(100, n * 33) }, (x) => { x.sp = n; x.on = true; }, d.n, stepUpFn); return; } d.sp = n; d.on = true; bump(); },
  ack: (id: string) => { if (S.alertsLive) { void ackAlert(id); return; } S.ack[id] = true; bump(); toast("Alert cleared. Alice will tell you if it happens again"); },
  seen: () => { S.activity.forEach((a) => (a.nw = false)); bump(); toast("All caught up"); if (isLive()) void markSeen(); },
  person: () => toast("Who is home follows each person's phone in Home Assistant, so it can't be changed here"),
  push: () => {
    const on = !S.push; S.push = on; bump();
    void (async () => {
      try {
        if (on) await enablePush(); else await disablePush();
        await savePreference({ pushEnabled: on });
        toast(on ? "This browser will get Alice's alerts" : "Push is off for this browser");
      } catch (e) { S.push = !on; bump(); toast(e instanceof Error ? e.message : "Push didn't change"); }
    })();
  }, quiet: () => { S.quiet = !S.quiet; bump(); void savePreference({ quietHours: { enabled: S.quiet } }); },
  copy: (v: string) => { try { navigator.clipboard.writeText(v).then(() => toast("Copied"), () => toast("Select the text to copy it")); } catch { toast("Select the text to copy it"); } },
  autodel: (id: string) => { if (isLive()) void deleteAutomation(id); },
  autotog: (id: string) => { if (isLive()) { const x = S.autos.find((y) => y.id === id); if (x) void toggleAutomation(id, !x.on); return; } const a = S.autos.find((x) => x.id === id)!; a.on = !a.on; bump(); toast(a.on ? `${a.n} is on` : `${a.n} is paused`); },
};

/* ---------- keeps the "synced" clock honest (called once from the shell) ---------- */
export function startLive() {
  S.sync = Date.now();
  return () => {};
}
export const fmtCd = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
export const dstate = (d: Dev) => {
  switch (d.t) {
    case "dim": return d.on ? d.v + "%" : "Off"; case "light": return d.on ? "On" : "Off";
    case "plug": return d.on ? d.w!.toLocaleString() + " W" : "Off"; case "climate": return d.on ? `${d.cur!.toFixed(1)}° to ${d.tgt}°` : "Off";
    case "fan": return d.on ? "Speed " + d.sp : "Off"; case "lock": return d.locked ? "Locked" : "Unlocked";
    case "contact": return d.open ? "Open" : "Closed"; default: return "Live";
  }
};
