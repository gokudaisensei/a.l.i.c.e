import { compileDeviceAction, routineObjectId, sceneObjectId } from "../home-assistant/compile";
import {
  type AutomationConfig, type HaAction, type HaCondition, type HaTrigger, MODE_HELPER_ENTITY, TEMPLATE_NO_ONE_HOME, TEMPLATE_SOMEONE_HOME,
} from "../home-assistant/config-ops";
import type { Action, AutomationDefinition, Condition, Trigger } from "./definition";

export interface CompileContext {
  /** Every Home Assistant person entity the household has. */
  personEntityIds: string[];
  /** The Home Assistant person linked to a household member, or null. */
  personOfUser(userId: string): string | null;
  /** For a power trigger: the device's power sensor and its limit in watts. */
  powerLimit(entityId: string): { sensor: string; limitW: number } | null;
}

/** Thrown when a definition cannot be expressed in Home Assistant (e.g. nobody to arrive). The message is for the person. */
export class CompileError extends Error {}

const offset = (minutes: number) => {
  const s = minutes < 0 ? "-" : "+";
  const m = Math.abs(minutes);
  return `${s}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
};

function compileTrigger(t: Trigger, ctx: CompileContext): { triggers: HaTrigger[]; extra: HaCondition[] } {
  switch (t.type) {
    case "arrive": {
      if ("userId" in t) {
        const person = ctx.personOfUser(t.userId);
        if (!person) throw new CompileError("That member is not linked to a Home Assistant person");
        return { triggers: [{ platform: "state", entity_id: [person], to: "home" }], extra: [] };
      }
      const who = t.person === "anyone" ? ctx.personEntityIds : ctx.personEntityIds.filter((p) => p === t.person);
      if (!who.length) throw new CompileError(t.person === "anyone" ? "No people are set up in Home Assistant yet" : "That person is not in Home Assistant");
      return { triggers: [{ platform: "state", entity_id: who, to: "home" }], extra: [] };
    }
    case "leave":
      if (!ctx.personEntityIds.length) throw new CompileError("No people are set up in Home Assistant yet");
      // Fires when someone leaves, but only counts if that left nobody at home.
      return { triggers: [{ platform: "state", entity_id: ctx.personEntityIds, to: "not_home" }], extra: [{ condition: "template", value_template: TEMPLATE_NO_ONE_HOME }] };
    case "time": return { triggers: [{ platform: "time", at: `${t.at}:00` }], extra: [] };
    case "sunset": case "sunrise": return { triggers: [{ platform: "sun", event: t.type, ...(t.offsetMinutes ? { offset: offset(t.offsetMinutes) } : {}) }], extra: [] };
    case "door_opens": case "motion": return { triggers: [{ platform: "state", entity_id: t.entityId, to: "on" }], extra: [] };
    case "power_over_limit": {
      const p = ctx.powerLimit(t.entityId);
      if (!p) throw new CompileError("That device has no power limit set, or no power reading");
      return { triggers: [{ platform: "numeric_state", entity_id: p.sensor, above: Math.round(p.limitW * 0.9) }], extra: [] };
    }
  }
}

function compileCondition(c: Condition): HaCondition {
  switch (c.type) {
    case "dark": return { condition: "state", entity_id: "sun.sun", state: "below_horizon" };
    case "someone_home": return { condition: "template", value_template: TEMPLATE_SOMEONE_HOME };
    case "days": return { condition: "time", weekday: c.days === "weekdays" ? ["mon", "tue", "wed", "thu", "fri"] : ["sat", "sun"] };
    case "mode": return { condition: "state", entity_id: MODE_HELPER_ENTITY, state: c.mode };
  }
}

function compileAction(a: Action): HaAction {
  switch (a.type) {
    case "device": return compileDeviceAction(a, true);
    case "scene": return { service: `script.${sceneObjectId(a.sceneId)}`, continue_on_error: true };
    case "routine": return { service: `script.${routineObjectId(a.routineId)}`, continue_on_error: true };
    case "mode": return { service: "input_select.select_option", target: { entity_id: MODE_HELPER_ENTITY }, data: { option: a.mode } };
    case "notify": return { event: "alice_notification", event_data: { title: a.title ?? "Home", message: a.message, ...(a.userIds ? { userIds: a.userIds } : {}) } };
  }
}

export function compileAutomation(name: string, def: AutomationDefinition, ctx: CompileContext): AutomationConfig {
  const { triggers, extra } = compileTrigger(def.trigger, ctx);
  return {
    alias: `Alice: ${name}`, mode: "single", trigger: triggers,
    condition: [...extra, ...def.conditions.map(compileCondition)],
    action: def.actions.map(compileAction),
  };
}

// ---- plain language ----

export interface Names {
  device(entityId: string): string;
  person(entityId: string): string;
  user(userId: string): string;
  scene(id: string): string;
  routine(id: string): string;
}

const MODE_LABEL = { home: "Home", away: "Away", night: "Night", vacation: "Vacation" } as const;
const clock = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number) as [number, number]; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
const join = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

const when = (t: Trigger, n: Names): string => {
  switch (t.type) {
    case "arrive": return "userId" in t ? `${n.user(t.userId)} gets home` : t.person === "anyone" ? "someone gets home" : `${n.person(t.person)} gets home`;
    case "leave": return "everyone has left";
    case "time": return `it is ${clock(t.at)}`;
    case "sunset": case "sunrise": {
      const off = t.offsetMinutes ?? 0;
      return `${off ? `${Math.abs(off)} minutes ${off < 0 ? "before" : "after"} ` : ""}the sun ${t.type === "sunset" ? "sets" : "rises"}`;
    }
    case "door_opens": return `${n.device(t.entityId)} opens`;
    case "motion": return `motion is seen at ${n.device(t.entityId)}`;
    case "power_over_limit": return `${n.device(t.entityId)} goes over its power limit`;
  }
};

const cond = (c: Condition): string => ({ dark: "it is dark", someone_home: "someone is home", days: c.type === "days" ? (c.days === "weekdays" ? "it is a weekday" : "it is a weekend") : "", mode: c.type === "mode" ? `the mode is ${MODE_LABEL[c.mode]}` : "" })[c.type];

const act = (a: Action, n: Names): string => {
  switch (a.type) {
    case "scene": return `run the “${n.scene(a.sceneId)}” scene`;
    case "routine": return `run the “${n.routine(a.routineId)}” routine`;
    case "mode": return `switch to ${MODE_LABEL[a.mode]} mode`;
    case "notify": return "send a notification";
    case "device": {
      const d = n.device(a.entityId);
      const p = a.parameters ?? {};
      return ({
        turn_on: `turn on ${d}`, turn_off: `turn off ${d}`, toggle: `toggle ${d}`, lock: `lock ${d}`, unlock: `unlock ${d}`, open: `open ${d}`, close: `close ${d}`,
        set_brightness: `set ${d} to ${p.brightness_pct}%`, set_temperature: `set ${d} to ${p.temperature}°`, set_position: `set ${d} to ${p.position}%`, set_speed: `set ${d} to ${p.percentage}%`,
      } as Record<string, string>)[a.action] ?? `${a.action.replace(/_/g, " ")} ${d}`;
    }
  }
};

/** "When someone gets home, if it is dark, turn on Hall lights and set Floor lamp to 70%." */
export function describeAutomation(def: AutomationDefinition, names: Names): string {
  const conds = def.conditions.map(cond).filter(Boolean);
  return `When ${when(def.trigger, names)}${conds.length ? `, if ${join(conds)}` : ""}, ${join(def.actions.map((a) => act(a, names)))}.`;
}
