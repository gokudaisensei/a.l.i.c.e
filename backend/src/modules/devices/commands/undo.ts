import type { DeviceCommand } from "./command-types";

export const UNDO_WINDOW_MS = 10 * 60_000;

/**
 * What puts a finished command back, worked out from how the device was before it ran. Null when there is nothing safe
 * to do: the command changed nothing, or the device's earlier state is not known, or the action has no clear opposite.
 */
export function undoPlan(c: DeviceCommand): { action: string; parameters?: Record<string, unknown> } | null {
  if (c.state !== "confirmed" || c.confirmedBy !== "state" || c.source !== "user") return null;
  const prev = c.previousState ?? {};
  switch (c.action) {
    case "turn_on": return prev.power === false ? { action: "turn_off" } : null;
    case "turn_off": return prev.power === true ? { action: "turn_on" } : null;
    case "toggle": return { action: "toggle" };
    case "lock": return { action: "unlock" };
    case "unlock": return { action: "lock" };
    case "set_brightness":
      if (prev.power === false) return { action: "turn_off" };
      return typeof prev.brightness === "number" ? { action: "set_brightness", parameters: { brightness_pct: prev.brightness } } : null;
    case "set_temperature": return typeof prev.target_temperature === "number" ? { action: "set_temperature", parameters: { temperature: prev.target_temperature } } : null;
    case "set_speed":
      if (prev.power === false) return { action: "turn_off" };
      return typeof prev.fan_speed === "number" ? { action: "set_speed", parameters: { percentage: prev.fan_speed } } : null;
    default: return null;
  }
}

/** Can this command still be undone right now? */
export const isUndoable = (c: DeviceCommand, now: number) => !c.undoneBy && !c.undoOf && c.finishedAt !== null && now - c.finishedAt <= UNDO_WINDOW_MS && undoPlan(c) !== null;
