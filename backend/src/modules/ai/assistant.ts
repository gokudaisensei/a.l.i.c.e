/**
 * "Ask Alice": turns a short sentence into things Alice can do, using only what the person may see. It is a plain
 * rule-based reader, not a language model: it finds a verb, the devices, rooms, scenes and modes named, and offers
 * every reading as a choice with a plain description. Nothing is run here; the app runs the chosen plan through the
 * usual command path, so permissions, passkey checks and confirmation all still apply.
 */
export interface AssistantDevice {
  id: string; name: string; areaId: string | null; domain: string; manufacturer: string | null;
  ops: string[];
}
export interface AssistantContext {
  devices: AssistantDevice[];
  areas: { id: string; name: string }[];
  scenes: { id: string; name: string; description: string | null }[];
  routines: { id: string; name: string }[];
  /** The household modes the person may switch to (empty for guests). */
  modes: string[];
}

export type Plan =
  | { type: "commands"; commands: { thingId: string; action: string; parameters?: Record<string, unknown> }[] }
  | { type: "scene"; id: string }
  | { type: "routine"; id: string }
  | { type: "mode"; mode: string }
  | { type: "device"; thingId: string };

export interface Suggestion { kind: Plan["type"]; label: string; detail: string; icon: string; sensitive: boolean; plan: Plan }

const STOP = new Set(["the", "a", "an", "my", "in", "on", "off", "all", "please", "turn", "switch", "set", "to", "of", "and", "everything", "lock", "unlock", "dim", "make", "start", "stop", "mode", "percent"]);
const TYPES: [RegExp, string[]][] = [
  [/\b(lights?|lamps?)\b/, ["light"]], [/\bfans?\b/, ["fan"]], [/\b(plugs?|switch(es)?)\b/, ["switch", "input_boolean"]],
  [/\b(ac|thermostat|climate|heating)\b/, ["climate"]], [/\b(doors?|locks?)\b/, ["lock"]],
];
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9% ]/g, " ").replace(/\s+/g, " ").trim();

export function interpret(text: string, ctx: AssistantContext): Suggestion[] {
  const q = norm(text);
  const out: Suggestion[] = [];
  if (!q) return suggestions(ctx);
  const words = q.split(" ");
  const num = (q.match(/(\d+)/) ?? [])[1];
  let verb: "on" | "off" | "lock" | "unlock" | "set" | null = null;
  if (/\bunlock\b/.test(q)) verb = "unlock"; else if (/\block\b/.test(q)) verb = "lock";
  else if (/\b(off|stop)\b/.test(q)) verb = "off"; else if (/\b(on|start)\b/.test(q) && !/\bmode\b/.test(q)) verb = "on";
  else if (/\b(set|dim|brighten|make)\b/.test(q) && num !== undefined) verb = "set";

  if (verb) {
    const area = ctx.areas.find((a) => q.includes(norm(a.name)));
    const types = TYPES.filter(([re]) => re.test(q)).flatMap(([, d]) => d);
    const areaWords = new Set(area ? norm(area.name).split(" ") : []);
    const toks = words.filter((w) => !STOP.has(w) && !areaWords.has(w) && w.length > 2 && !/^\d/.test(w) && !TYPES.some(([re]) => re.test(w)));
    const all = /\b(all|everything)\b/.test(q);
    const domains = verb === "on" || verb === "off" ? ["light", "switch", "input_boolean", "fan", "climate"] : verb === "lock" || verb === "unlock" ? ["lock"] : ["light", "climate"];
    const op = verb === "on" ? "turn_on" : verb === "off" ? "turn_off" : verb;
    const list = ctx.devices.filter((d) =>
      domains.includes(d.domain) && (!types.length || types.includes(d.domain)) && (!area || d.areaId === area.id) &&
      toks.every((t) => norm(`${d.name} ${d.manufacturer ?? ""}`).includes(t)) && (verb === "set" || d.ops.includes(op)));
    if (list.length && (area || types.length || toks.length || all || verb === "lock")) {
      const where = area ? ` in ${area.name}` : "";
      const lights = list.every((d) => d.domain === "light"), doors = list.every((d) => d.domain === "lock");
      const noun = list.length === 1 ? list[0]!.name : `${list.length} ${lights ? "lights" : doors ? "doors" : "devices"}${where}`;
      const detail = list.slice(0, 4).map((d) => d.name).join(", ") + (list.length > 4 ? "…" : "");
      if (verb === "on" || verb === "off") out.push({ kind: "commands", label: `Turn ${verb} ${noun}`, detail, icon: "bulb", sensitive: false, plan: { type: "commands", commands: list.map((d) => ({ thingId: d.id, action: op })) } });
      if (verb === "lock") out.push({ kind: "commands", label: `Lock ${noun}`, detail, icon: "lock", sensitive: false, plan: { type: "commands", commands: list.map((d) => ({ thingId: d.id, action: "lock" })) } });
      if (verb === "unlock") out.push({ kind: "commands", label: `Unlock ${noun}`, detail: "Asks for your passkey first", icon: "unlock", sensitive: true, plan: { type: "commands", commands: list.map((d) => ({ thingId: d.id, action: "unlock" })) } });
      if (verb === "set") {
        const n = Number(num);
        const climates = list.filter((d) => d.domain === "climate" && d.ops.includes("set_temperature"));
        const dimmers = list.filter((d) => d.domain === "light" && d.ops.includes("set_brightness"));
        const useClimate = climates.length > 0 && (!dimmers.length || /\b(ac|thermostat|climate)\b/.test(q) || (n >= 16 && n <= 30 && !/%|percent/.test(q)));
        const target = useClimate ? climates : dimmers;
        if (target.length) {
          const value = useClimate ? clamp(n, 16, 30) : clamp(n, 1, 100);
          out.push({
            kind: "commands", icon: useClimate ? "thermo" : "bulb", sensitive: false, detail: target.map((d) => d.name).join(", "),
            label: useClimate ? `Set ${target.length === 1 ? target[0]!.name : `${target.length} thermostats`} to ${value}°` : `Set ${target.length === 1 ? target[0]!.name : `${target.length} lights`} to ${value}%`,
            plan: { type: "commands", commands: target.map((d) => ({ thingId: d.id, action: useClimate ? "set_temperature" : "set_brightness", parameters: useClimate ? { temperature: value } : { brightness_pct: value } })) },
          });
        }
      }
    }
  }

  for (const s of ctx.scenes) if (q.includes(norm(s.name)) || norm(s.name).split(" ").filter((w) => w.length > 3).some((w) => words.includes(w) && words.length <= 3)) out.push({ kind: "scene", label: `Run “${s.name}”`, detail: s.description ?? "Scene", icon: "play", sensitive: false, plan: { type: "scene", id: s.id } });
  for (const r of ctx.routines) if (q.includes(norm(r.name))) out.push({ kind: "routine", label: `Run “${r.name}”`, detail: "Routine", icon: "layers", sensitive: false, plan: { type: "routine", id: r.id } });
  for (const m of ctx.modes) if (q.includes(m) && (q.includes("mode") || q === m)) out.push({ kind: "mode", label: `Switch to ${m[0]!.toUpperCase()}${m.slice(1)} mode`, detail: "Household mode", icon: "home", sensitive: false, plan: { type: "mode", mode: m } });
  ctx.devices.filter((d) => norm(d.name).includes(q)).slice(0, 3).forEach((d) => out.push({ kind: "device", label: d.name, detail: "Show in Rooms", icon: "bulb", sensitive: false, plan: { type: "device", thingId: d.id } }));
  return dedupe(out);
}

const dedupe = (items: Suggestion[]) => items.filter((x, i) => items.findIndex((y) => y.label === x.label) === i);

/** What to offer before anything is typed: a few things that would work in this home. */
function suggestions(ctx: AssistantContext): Suggestion[] {
  const out: Suggestion[] = [];
  const lights = ctx.devices.filter((d) => d.domain === "light" && d.ops.includes("turn_off"));
  if (lights.length > 1) out.push(...interpret("turn off all lights", ctx).slice(0, 1));
  if (ctx.devices.some((d) => d.domain === "lock")) out.push(...interpret("lock everything", ctx).slice(0, 1));
  for (const s of ctx.scenes.slice(0, 2)) out.push({ kind: "scene", label: `Run “${s.name}”`, detail: s.description ?? "Scene", icon: "play", sensitive: false, plan: { type: "scene", id: s.id } });
  const m = ctx.modes.find((x) => x === "night");
  if (m) out.push({ kind: "mode", label: "Switch to Night mode", detail: "Household mode", icon: "moon", sensitive: false, plan: { type: "mode", mode: m } });
  return dedupe(out);
}
