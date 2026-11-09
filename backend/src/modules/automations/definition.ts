import { HOUSEHOLD_MODES, type HouseholdMode } from "../../core/database/schema";
import { AppError } from "../../core/errors/errors";

/**
 * Alice's own automation format (versioned). It is what people edit and what the app shows; it is compiled into a
 * Home Assistant automation, so it keeps running when Alice is down.
 */
export type Trigger =
  | { type: "arrive"; person: "anyone" | string }
  /** A household member, whichever Home Assistant person they are linked to. */
  | { type: "arrive"; userId: string }
  | { type: "leave" }
  | { type: "time"; at: string }
  | { type: "sunset"; offsetMinutes?: number }
  | { type: "sunrise"; offsetMinutes?: number }
  | { type: "door_opens"; entityId: string }
  | { type: "motion"; entityId: string }
  | { type: "power_over_limit"; entityId: string };

export type Condition =
  | { type: "dark" }
  | { type: "someone_home" }
  | { type: "days"; days: "weekdays" | "weekends" }
  | { type: "mode"; mode: HouseholdMode };

export type Action =
  | { type: "device"; entityId: string; action: string; parameters?: Record<string, unknown> }
  | { type: "scene"; sceneId: string }
  | { type: "routine"; routineId: string }
  | { type: "notify"; title?: string; message: string; userIds?: string[] }
  | { type: "mode"; mode: HouseholdMode };

export interface AutomationDefinition {
  version: 1;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
}

export const MAX_CONDITIONS = 10;
export const MAX_ACTIONS = 20;

const bad = (m: string): never => { throw new AppError(400, "validation_error", m); };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string, max = 200) => { if (typeof v !== "string" || !v || v.length > max) bad(`${what} is missing or too long`); return v as string; };
const mode = (v: unknown) => { if (!(HOUSEHOLD_MODES as readonly string[]).includes(String(v))) bad("Unknown mode"); return v as HouseholdMode; };
const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;
const entityId = (v: unknown, what: string) => { if (typeof v !== "string" || !ENTITY.test(v)) bad(`${what} is not an entity id`); return v as string; };

/** Checks the shape only (what each field is). Whether devices exist and are allowed is checked by the service. */
export function parseDefinition(input: unknown): AutomationDefinition {
  if (!isObj(input)) return bad("The automation must be an object");
  if (input.version !== 1) bad("Unsupported automation version");
  const t = input.trigger;
  if (!isObj(t)) return bad("An automation needs a trigger");
  let trigger: Trigger;
  switch (t.type) {
    case "arrive":
      trigger = typeof t.userId === "string" && t.userId ? { type: "arrive", userId: t.userId.slice(0, 80) } : { type: "arrive", person: t.person === "anyone" ? "anyone" : entityId(t.person, "person") };
      break;
    case "leave": trigger = { type: "leave" }; break;
    case "time": if (typeof t.at !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.at)) bad("Time must be HH:MM (24 hour)"); trigger = { type: "time", at: t.at as string }; break;
    case "sunset": case "sunrise": {
      const off = t.offsetMinutes === undefined ? 0 : Number(t.offsetMinutes);
      if (!Number.isInteger(off) || Math.abs(off) > 360) bad("Offset must be a whole number of minutes, at most 6 hours either way");
      trigger = { type: t.type, ...(off ? { offsetMinutes: off } : {}) };
      break;
    }
    case "door_opens": case "motion": trigger = { type: t.type, entityId: entityId(t.entityId, "device") }; break;
    case "power_over_limit": trigger = { type: "power_over_limit", entityId: entityId(t.entityId, "device") }; break;
    default: return bad("Unknown trigger");
  }

  const rawConds = input.conditions ?? [];
  if (!Array.isArray(rawConds) || rawConds.length > MAX_CONDITIONS) bad(`At most ${MAX_CONDITIONS} conditions`);
  const conditions = (rawConds as unknown[]).map((c): Condition => {
    if (!isObj(c)) return bad("Invalid condition");
    switch (c.type) {
      case "dark": return { type: "dark" };
      case "someone_home": return { type: "someone_home" };
      case "days": if (c.days !== "weekdays" && c.days !== "weekends") bad("days must be weekdays or weekends"); return { type: "days", days: c.days as "weekdays" | "weekends" };
      case "mode": return { type: "mode", mode: mode(c.mode) };
      default: return bad("Unknown condition");
    }
  });

  const rawActions = input.actions;
  if (!Array.isArray(rawActions) || rawActions.length < 1 || rawActions.length > MAX_ACTIONS) bad(`An automation needs 1 to ${MAX_ACTIONS} actions`);
  const actions = (rawActions as unknown[]).map((a): Action => {
    if (!isObj(a)) return bad("Invalid action");
    switch (a.type) {
      case "device": {
        if (a.parameters !== undefined && !isObj(a.parameters)) bad("parameters must be an object");
        return { type: "device", entityId: entityId(a.entityId, "device"), action: str(a.action, "action", 40), ...(a.parameters ? { parameters: a.parameters as Record<string, unknown> } : {}) };
      }
      case "scene": return { type: "scene", sceneId: str(a.sceneId, "scene", 60) };
      case "routine": return { type: "routine", routineId: str(a.routineId, "routine", 60) };
      case "notify": {
        const userIds = a.userIds === undefined ? undefined : Array.isArray(a.userIds) && a.userIds.length <= 50 && a.userIds.every((u) => typeof u === "string") ? (a.userIds as string[]) : bad("userIds must be a list of user ids");
        return { type: "notify", message: str(a.message, "message", 500), ...(typeof a.title === "string" && a.title ? { title: a.title.slice(0, 100) } : {}), ...(userIds ? { userIds } : {}) };
      }
      case "mode": return { type: "mode", mode: mode(a.mode) };
      default: return bad("Unknown action");
    }
  });
  return { version: 1, trigger, conditions, actions };
}
