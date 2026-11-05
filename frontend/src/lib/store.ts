"use client";
import { create } from "zustand";
import { useSyncExternalStore } from "react";
import {
  ROOMS, MODES, CLOCK, W, ENERGY, TRIG, TDEF,
  initialPeople, initialDevices, initialActivity, initialBackups, initialAutos, initialBuilder,
  type Dev, type Person, type Role, type Tod, type Activity, type Builder,
} from "./data";

/* ---------- state: one mutable object + a version counter ---------- */
export interface PK { title: string; desc: string; ok: () => void; state: "idle" | "go" | "ok" }
export interface PalItem { ic: string; l: string; s?: string; k?: string; dis?: boolean; run?: () => void }

export const S = {
  role: "admin" as Role, tod: "auto" as "auto" | Tod, view: "home", mode: "Home",
  room: "all", group: "room", q: "", voiceOnly: false, at: "people",
  snooze: {} as Record<string, boolean>, ack: {} as Record<string, boolean>, sync: 0,
  people: initialPeople() as Person[], devices: initialDevices() as Dev[], activity: initialActivity() as Activity[],
  quiet: true, push: true, lastVerified: "this morning", energy: ENERGY,
  aopen: {} as Record<string, boolean>, bstep: "when" as string | null, exp: {} as Record<string, boolean>,
  backups: initialBackups(), bk: { run: null as number | null, dest: "NAS" },
  invites: [{ code: "MAPLE-4829-KITE", role: "Guest", exp: "Expires in 22 hours" }] as { code: string; role: string; exp: string }[],
  inv: { role: "Member", exp: "24 hours", code: null as string | null },
  upd: { cur: "1.8.2", avail: "1.9.0", state: "ready" as "ready" | "scheduled" | "installing" | "done", step: 0 },
  em: { open: false, reason: "", word: "" },
  sup: {
    dur: 1, scope: { health: true, devices: true, cameras: false, control: false } as Record<string, boolean>,
    active: null as null | { end: number; dur: number },
  },
  hlog: [
    { t: "Tue 4:10 pm", x: "Gokul gave support access for 1 hour" },
    { t: "Tue 4:12 pm", x: "Support looked at System health" },
    { t: "Tue 5:10 pm", x: "Support access ended on its own" },
  ],
  olog: [
    { t: "17:10:00", op: "system", a: "session.expire", r: "sess_8f2c" },
    { t: "16:12:41", op: "ops-114", a: "health.read", r: "/admin/health" },
    { t: "16:10:02", op: "ops-114", a: "session.start", r: "granted by household, 1h" },
  ],
  autos: initialAutos(), b: initialBuilder() as Builder,
  hc: null as null | "run",
  sheet: null as string | null, pk: null as PK | null,
  pal: null as null | { q: string; sel: number; items: PalItem[] },
  toast: { msg: "", show: false, undo: null as null | (() => void) },
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
export const me = () => S.people.find((p) => p.id === PERSONA[S.role])!;
export const dev = (id: string) => S.devices.find((d) => d.id === id)!;
export const vis = () => S.devices.filter((d) => S.role !== "guest" || d.g);
export const rname = (id: string) => ROOMS.find((r) => r.id === id)!.n;
export const isLight = (d: Dev) => d.t === "light" || d.t === "dim";
const ICON: Record<string, string> = { light: "bulb", dim: "bulb", plug: "plug", fan: "fan", climate: "thermo", lock: "lock", camera: "camera", contact: "door" };
export const icn = (d: Dev) => (d.t === "lock" ? (d.locked ? "lock" : "unlock") : ICON[d.t]);
export const isOn = (d: Dev) => (d.t === "contact" ? !!d.open : d.t === "lock" || d.t === "camera" ? false : !!d.on);
export const watts = (d: Dev) =>
  d.t === "plug" && d.on ? d.w! : d.t === "climate" && d.on ? 850 : d.t === "fan" && d.on ? 45
  : d.t === "dim" && d.on ? Math.round(d.v! * 0.12) : d.t === "light" && d.on ? 9 : 0;
export const totalW = () => 200 + S.devices.reduce((a, d) => a + watts(d), 0);
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

export function backupState() { const latest = S.backups[0]; return { ok: !latest || latest.verified, latest }; }
export const adminAttention = () => (backupState().ok ? 0 : 1) + (S.upd.state === "ready" ? 1 : 0);

export interface Alert { id: string; t: string; d: string; ic: string }
export function alerts(): Alert[] {
  if (S.role === "guest") return [];
  const out: Alert[] = [];
  S.devices.filter((d) => d.t === "plug" && d.limit && d.on).forEach((d) => {
    const p = d.w! / d.limit!;
    if (p >= 0.9 && !S.ack["p" + d.id]) out.push({ id: "p" + d.id, t: `${d.n} is at ${Math.round(p * 100)}% of its ${d.limit!.toLocaleString()} W limit`, d: "Alice alerts you at 90%. You can raise the limit in Rooms.", ic: "bolt" });
  });
  S.devices.filter((d) => d.t === "contact" && d.open && !S.ack["o" + d.id]).forEach((d) => out.push({ id: "o" + d.id, t: `${d.n} is open`, d: "Left open for 12 minutes.", ic: "door" }));
  return out;
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
  if (S.role === "admin") { const nb = backupState(); chips.push({ ic: nb.ok ? "shieldcheck" : "alert", t: nb.ok ? `Backup verified ${S.lastVerified}` : "Backup not verified yet", warn: !nb.ok, to: "backup" }); }
  const nw = S.activity.filter((a) => a.nw).length;
  if (nw && S.role !== "guest") chips.push({ ic: "clock", t: `${nw} new since last visit`, to: "activity" });
  return { line, chips, al };
}

/* ---------- scenes ---------- */
const set = (id: string, p: Partial<Dev>) => Object.assign(dev(id), p);
const allLights = (on: boolean) => S.devices.filter(isLight).forEach((d) => (d.on = on));
export const lockAll = () => S.devices.filter((d) => d.t === "lock").forEach((d) => { d.locked = true; d.by = me().n; d.at = "just now"; });
export const SCENES = [
  { id: "morning", n: "Good morning", ic: "sun", tag: "Routine · weekdays 6:45", d: "Kitchen lights up, bedroom off, AC off", run() { set("pend", { on: true, v: 90 }); set("strip", { on: true }); set("bed", { on: false }); set("bedac", { on: false }); S.mode = "Home"; } },
  { id: "leaving", n: "Heading out", ic: "exit", tag: "Scene", d: "Lights off, doors locked, Away mode", run() { allLights(false); lockAll(); set("ac", { on: false }); set("bedac", { on: false }); S.mode = "Away"; } },
  { id: "movie", n: "Movie night", ic: "play", tag: "Scene", d: "Ceiling off, floor lamp 15%, AC 23°", run() { set("ceil", { on: false }); set("floor", { on: true, v: 15 }); set("pend", { on: false }); set("ac", { on: true, tgt: 23 }); } },
  { id: "night", n: "Goodnight", ic: "moon", tag: "Routine · 10:30 pm", d: "Lights off, doors locked, Night mode", run() { allLights(false); set("kid", { on: true, v: 10 }); lockAll(); S.mode = "Night"; } },
  { id: "welcome", n: "Welcome home", ic: "home", tag: "Routine · on arrival", d: "Hall lights on, Home mode", run() { set("hall", { on: true }); set("floor", { on: true, v: 60 }); S.mode = "Home"; } },
];
export function suggestion() {
  const t = tod(), home = S.people.filter((p) => p.home && p.role !== "guest").length;
  let s: { to: string; why: string } | null = null;
  if (home === 0 && S.mode === "Home") s = { to: "Away", why: "Everyone has left and the doors are locked." };
  else if (t === "night" && S.mode === "Home") s = { to: "Night", why: "It is 10:40 pm and the living room has been still for 40 minutes." };
  else if (home > 0 && S.mode === "Away") s = { to: "Home", why: "Someone just got home." };
  else if (t === "morning" && S.mode === "Night") s = { to: "Home", why: "It is morning and the kitchen lights are on." };
  return s && !S.snooze[s.to + t] ? s : null;
}

/* ---------- toast / overlays ---------- */
let tt: ReturnType<typeof setTimeout>;
export function toast(msg: string, undo?: () => void) {
  S.toast = { msg, show: true, undo: undo ?? null };
  clearTimeout(tt);
  tt = setTimeout(() => { S.toast.show = false; bump(); }, undo ? 6000 : 3200);
  bump();
}
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
export function passkey(title: string, desc: string, ok: () => void) { S.pk = { title, desc, ok, state: "idle" }; S.pal = null; S.sheet = null; bump(); }
export function pkRun() {
  const k = S.pk; if (!k || k.state !== "idle") return;
  k.state = "go"; bump();
  setTimeout(() => { if (S.pk !== k) return; k.state = "ok"; bump(); setTimeout(() => { if (S.pk !== k) return; closeOv(); k.ok(); }, 520); }, 1000);
}

/* ---------- builder logic ---------- */
export interface Verb { n: string; ic: string; pick: () => { id: string; n: string }[]; val?: { min: number; max: number; def: number; u: string } }
export const VERBS: Record<string, Verb> = {
  on: { n: "Turn on", ic: "bulb", pick: () => S.devices.filter((d) => isLight(d) || d.t === "plug" || d.t === "fan" || d.t === "climate") },
  off: { n: "Turn off", ic: "bulb", pick: () => S.devices.filter((d) => isLight(d) || d.t === "plug" || d.t === "fan" || d.t === "climate") },
  dim: { n: "Set brightness", ic: "sun", pick: () => S.devices.filter((d) => d.t === "dim"), val: { min: 1, max: 100, def: 60, u: "%" } },
  temp: { n: "Set temperature", ic: "thermo", pick: () => S.devices.filter((d) => d.t === "climate"), val: { min: 16, max: 30, def: 24, u: "°" } },
  lock: { n: "Lock", ic: "lock", pick: () => S.devices.filter((d) => d.t === "lock") },
  notify: { n: "Send a notification", ic: "bell", pick: () => S.people.filter((p) => p.role !== "guest").map((p) => ({ id: p.id, n: p.n })) },
  scene: { n: "Run scene", ic: "play", pick: () => SCENES.map((s) => ({ id: s.id, n: s.n })) },
};
export const fmtTime = (t: string | null) => { const [h, m] = (t || "18:30").split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
export const joinL = (a: string[]) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
const nameOf = (v: string, id: string) => { const o = VERBS[v].pick(); return (o.find((x) => x.id === id) || o[0] || { n: "something" }).n; };
const actText = (a: { v: string; t: string; n?: number }) => {
  const n = nameOf(a.v, a.t);
  return ({ on: `turn on ${n}`, off: `turn off ${n}`, dim: `set ${n} to ${a.n}%`, temp: `set ${n} to ${a.n}°`, lock: `lock ${n}`, notify: `send ${n} a notification`, scene: `run the “${n}” scene` } as Record<string, string>)[a.v];
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
export function setTrigger(k: string) { S.b.trig = { k, p: TDEF[k] }; bump(); }
export function builderAdd(v: string) { const o = VERBS[v].pick()[0]; S.b.acts.push({ v, t: o.id, n: VERBS[v].val?.def }); bump(); }
export function builderSave() {
  const b = S.b;
  if (!b.acts.length) { toast("Add at least one action first"); return; }
  const name = b.name.trim() || "Untitled automation";
  S.autos.unshift({ id: "a" + Date.now(), n: name, s: sumPlain(), on: true, last: "Never run" });
  S.activity.unshift({ ic: "layers", t: `<b>${me().n}</b> saved the automation “${name}”`, time: "just now" });
  bump(); toast("Saved. It is live in Home Assistant now");
}
export function builderTest() {
  toast(S.b.acts.length ? `Dry run: Alice would ${joinL(sumParts().a)}. Nothing changed` : "Nothing to run yet. Add an action");
}
export { TRIG };

/* ---------- command palette ---------- */
const STOP = new Set("turn switch please the all my in on off set to dim lock unlock of a everything degrees percent light lights lamp lamps fan fans plug plugs ac thermostat climate door doors make brighten stop start and".split(" "));
const RK: Record<string, string> = { living: "living", kitchen: "kitchen", bedroom: "bedroom", arjun: "kids", bathroom: "bath", guest: "guest", hall: "hall", garden: "garden", balcony: "living" };
export function cmdItems(q0: string): PalItem[] {
  const q = q0.trim().toLowerCase(), out: PalItem[] = [], guest = S.role === "guest";
  if (!q) {
    ["turn off all lights", "lock everything", guest ? "turn on the guest lamp" : "goodnight", guest ? "set guest ac to 24" : "set living ac to 23", guest ? "go to rooms" : "switch to night mode"]
      .forEach((t) => { const r = cmdItems(t)[0]; if (r && !r.dis) out.push(r); });
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
export function openPal() { S.pk = null; S.sheet = null; S.pal = { q: "", sel: 0, items: cmdItems("") }; bump(); }
export function palQuery(q: string) { if (!S.pal) return; S.pal.q = q; S.pal.sel = 0; S.pal.items = cmdItems(q); bump(); }
export function palMove(d: number) { const p = S.pal; if (!p) return; p.sel = (p.sel + d + p.items.length) % p.items.length; bump(); }
export function runPal(i: number) { const it = S.pal?.items[i]; if (!it || it.dis) return; closeOv(); it.run?.(); }

/* ---------- actions ---------- */
export const A = {
  live: (id: string) => toast(`${dev(id).n} opens full screen on a real device`),
  cmd: () => openPal(),
  tog: (id: string) => { const d = dev(id); d.on = !d.on; S.sync = Date.now(); bump(); },
  dtap: (id: string) => {
    const d = dev(id);
    if (d.t === "lock") return d.locked ? A.unlock(id) : A.lock(id);
    if (d.t === "contact" || d.t === "camera") return openSheet(d.id);
    d.on = !d.on; buzz(12); S.sync = Date.now(); bump();
  },
  preset: (id: string, n: number) => { const d = dev(id); d.v = n; d.on = true; buzz(8); bump(); },
  slide: (id: string, v: number) => { const d = dev(id); d.v = v; d.on = true; S.sync = Date.now(); bump(); },
  role: (r: Role) => { S.role = r; go(S.view); },
  setTod: (t: "auto" | Tod) => { S.tod = t; bump(); },
  lock: (id: string) => { const d = dev(id); commit(`${d.n} locked`, () => { d.locked = true; d.by = me().n; d.at = "just now"; }); },
  unlock: (id: string) => { const d = dev(id); passkey(`Unlock ${d.n}?`, "Unlocking always needs your passkey, even for admins.", () => commit(`${d.n} unlocked`, () => { d.locked = false; d.by = me().n; d.at = "just now"; })); },
  lockall: () => commit("Every door locked", lockAll),
  mode: (m: string) => { if (S.mode !== m) commit(`Mode: ${m}`, () => { S.mode = m; }); },
  snooze: (id: string) => { S.snooze[id] = true; bump(); toast("Okay, Alice will not ask again for now"); },
  scene: (id: string) => { const s = SCENES.find((x) => x.id === id)!; commit(`${s.n} done`, s.run); },
  flash: (id: string) => {
    const go2 = () => { const t = document.getElementById("t-" + id); if (!t) return; t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash"); };
    if (S.view !== "home") { go("home"); setTimeout(go2, 120); } else go2();
  },
  fav: (id: string) => { const d = dev(id); d.fav = d.fav ? 0 : 1; bump(); toast(d.fav ? `${d.n} added to Favourites` : `${d.n} removed from Favourites`); },
  voice: (id: string) => { const d = dev(id); d.voice = d.voice ? 0 : 1; bump(); toast(d.voice ? `${d.n} shared with Alexa and Google` : `${d.n} no longer shared`); },
  tgt: (id: string, delta: number) => { const d = dev(id); d.tgt = clamp(d.tgt! + delta, 16, 30); d.on = true; bump(); },
  fan: (id: string, n: number) => { const d = dev(id); d.sp = n; d.on = true; bump(); },
  ack: (id: string) => { S.ack[id] = true; bump(); toast("Alert cleared. Alice will tell you if it happens again"); },
  seen: () => { S.activity.forEach((a) => (a.nw = false)); bump(); toast("All caught up"); },
  person: (id: string) => { const p = S.people.find((x) => x.id === id)!; commit(`${p.n} marked ${p.home ? "away" : "home"}`, () => { p.home = !p.home; }); },
  push: () => { S.push = !S.push; bump(); }, quiet: () => { S.quiet = !S.quiet; bump(); },
  copy: (v: string) => { try { navigator.clipboard.writeText(v).then(() => toast("Copied"), () => toast("Select the text to copy it")); } catch { toast("Select the text to copy it"); } },
  autotog: (id: string) => { const a = S.autos.find((x) => x.id === id)!; a.on = !a.on; bump(); toast(a.on ? `${a.n} is on` : `${a.n} is paused`); },
  invmake: () => {
    const w = ["MAPLE", "CEDAR", "RIVER", "AMBER", "PEPPER", "LOTUS"], k = ["KITE", "LAMP", "FERN", "DUSK", "BELL", "SAGE"];
    const c = `${w[(Math.random() * 6) | 0]}-${1000 + ((Math.random() * 9000) | 0)}-${k[(Math.random() * 6) | 0]}`;
    S.inv.code = c; S.invites.unshift({ code: c, role: S.inv.role, exp: "Expires in " + S.inv.exp }); bump(); toast("One-time code created");
  },
  invrev: (i: number) => { S.invites.splice(i, 1); S.inv.code = null; bump(); toast("Invite revoked"); },
  addpk: () => passkey("Add a passkey?", "This device will be able to sign in as you.", () => toast("Passkey added to this device")),
  bkdest: (d: string) => { S.bk.dest = d; bump(); toast(`Backups now go to ${d}`); },
  bknow: () => { S.backups.unshift({ id: "b" + Date.now(), when: "Just now", size: "41.9 MB", where: S.bk.dest, verified: false }); bump(); toast("Backup saved. It counts once it passes a restore test"); },
  bktest: () => {
    S.bk.run = 0; bump();
    const adv = () => {
      if (S.bk.run === null) return;
      S.bk.run++;
      if (S.bk.run >= 3) { S.bk.run = null; const b = S.backups[0]; b.verified = true; b.note = "Passed just now"; S.lastVerified = "just now"; bump(); toast("Restore test passed. The backup is verified"); return; }
      bump(); setTimeout(adv, 1000);
    };
    setTimeout(adv, 1000);
  },
  recheck: () => { S.hc = "run"; bump(); setTimeout(() => { S.hc = null; bump(); }, 1200); },
  updnight: () => { S.upd.state = "scheduled"; bump(); toast("Scheduled for 2:30 tonight"); },
  updcancel: () => { S.upd.state = "ready"; bump(); },
  updnow: () => passkey(`Install ${S.upd.avail} now?`, "Alice will back up first, then restart. This takes about a minute.", () => {
    S.upd.state = "installing"; S.upd.step = 0; bump();
    const adv = () => {
      S.upd.step++;
      if (S.upd.step >= 4) { S.upd.state = "done"; S.upd.cur = S.upd.avail; S.hlog.unshift({ t: "Today " + nowS(), x: `Gokul installed Alice ${S.upd.cur}` }); bump(); toast(`Alice ${S.upd.cur} is running`); return; }
      bump(); setTimeout(adv, 900);
    };
    setTimeout(adv, 900);
  }),
  emtoggle: () => { S.em.open = !S.em.open; bump(); },
  emgo: () => passkey("Deploy now?", "This skips the nightly window and is recorded with your name.", () => {
    S.hlog.unshift({ t: "Today " + nowS(), x: "Gokul ran an emergency deploy" });
    S.olog.unshift({ t: nowT(), op: "gokul", a: "deploy.emergency", r: S.em.reason.trim().slice(0, 40) });
    S.em = { open: false, reason: "", word: "" }; bump(); toast("Emergency deploy started");
  }),
  supgrant: () => passkey("Let support in?", `Access lasts ${S.sup.dur} hour${S.sup.dur > 1 ? "s" : ""} and ends on its own.`, () => {
    const s = S.sup; s.active = { end: Date.now() + s.dur * 3600e3, dur: s.dur };
    S.hlog.unshift({ t: "Today " + nowS(), x: `Gokul gave support access for ${s.dur} hour${s.dur > 1 ? "s" : ""}` });
    S.olog.unshift({ t: nowT(), op: "ops-114", a: "session.start", r: `granted by household, ${s.dur}h` });
    bump(); toast("Support can now see what you allowed");
  }),
  supend: () => { S.sup.active = null; S.hlog.unshift({ t: "Today " + nowS(), x: "Gokul ended support access" }); S.olog.unshift({ t: nowT(), op: "gokul", a: "session.revoke", r: "sess_91ab" }); bump(); toast("Support access ended"); },
  supext: () => { const a = S.sup.active!; a.end += 3600e3; a.dur += 1; S.hlog.unshift({ t: "Today " + nowS(), x: "Gokul added 1 hour of support access" }); bump(); },
};

/* ---------- live simulation (called once from the shell) ---------- */
export function startLive() {
  S.sync = Date.now();
  const i1 = setInterval(() => {
    const sa = S.sup.active;
    if (sa && sa.end - Date.now() <= 0) {
      S.sup.active = null;
      S.hlog.unshift({ t: "Today " + nowS(), x: "Support access ended on its own" });
      S.olog.unshift({ t: nowT(), op: "system", a: "session.expire", r: "sess_91ab" });
      bump();
    }
  }, 1000);
  const i2 = setInterval(() => {
    const g = dev("geyser"), tv = dev("tv");
    if (g.on) g.w = clamp(g.w! + Math.round((Math.random() - 0.5) * 50), 1370, 1470);
    if (tv.on) tv.w = clamp(tv.w! + Math.round((Math.random() - 0.5) * 10), 70, 98);
    S.sync = Date.now(); bump();
  }, 5000);
  return () => { clearInterval(i1); clearInterval(i2); };
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
