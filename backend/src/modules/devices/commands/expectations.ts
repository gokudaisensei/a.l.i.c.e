import type { NormalizedState } from "@/modules/home-assistant";

/** What we expect to observe once an operation has taken effect, in application-level values. */
export interface Expectation {
  requested: Record<string, unknown>;
  matches(values: NormalizedState): boolean;
}

type Params = Record<string, unknown>;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const near = (actual: unknown, want: number, tol: number) => typeof actual === "number" && Math.abs(actual - want) <= tol;
const eq = (key: string, want: unknown): Expectation => ({ requested: { [key]: want }, matches: (v) => v[key] === want });

/** Parameters each operation needs, with a type check. Returns an error message or null. */
const REQUIRED: Record<string, { key: string; type: "number" | "string" | "boolean" | "rgb"; min?: number; max?: number }[]> = {
  set_brightness: [{ key: "brightness_pct", type: "number", min: 1, max: 100 }],
  set_color_temperature: [{ key: "kelvin", type: "number", min: 1000, max: 12000 }],
  set_color: [{ key: "rgb", type: "rgb" }],
  set_speed: [{ key: "percentage", type: "number", min: 0, max: 100 }],
  set_oscillation: [{ key: "oscillating", type: "boolean" }],
  set_direction: [{ key: "direction", type: "string" }],
  set_preset_mode: [{ key: "preset_mode", type: "string" }],
  set_hvac_mode: [{ key: "hvac_mode", type: "string" }],
  set_temperature: [{ key: "temperature", type: "number", min: -50, max: 100 }],
  set_fan_mode: [{ key: "fan_mode", type: "string" }],
  set_swing_mode: [{ key: "swing_mode", type: "string" }],
  set_position: [{ key: "position", type: "number", min: 0, max: 100 }],
  set_value: [{ key: "value", type: "number" }],
};

export function validateParameters(action: string, p: Params = {}): string | null {
  for (const r of REQUIRED[action] ?? []) {
    const v = p[r.key];
    if (v === undefined || v === null) return `${action} needs "${r.key}"`;
    if (r.type === "rgb") {
      if (!Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== "number" || x < 0 || x > 255)) return `"${r.key}" must be [r, g, b] with values 0-255`;
    } else if (typeof v !== r.type) return `"${r.key}" must be a ${r.type}`;
    if (r.type === "number" && ((r.min !== undefined && (v as number) < r.min) || (r.max !== undefined && (v as number) > r.max))) {
      return `"${r.key}" must be between ${r.min} and ${r.max}`;
    }
  }
  return null;
}

/**
 * The state we should see afterwards. Null means the operation has no observable state (scenes, scripts, stop),
 * so it is confirmed as soon as HA accepts it. Tolerances absorb HA's own rounding (0-255 brightness, mireds, fan steps).
 */
export function expectationFor(domain: string, action: string, p: Params = {}, before: NormalizedState = {}): Expectation | null {
  switch (action) {
    case "turn_on": return eq("power", true);
    case "turn_off": return eq("power", false);
    case "toggle": return typeof before.power === "boolean" ? eq("power", !before.power) : null;
    case "set_brightness": {
      const want = num(p.brightness_pct)!;
      return { requested: { power: true, brightness: want }, matches: (v) => v.power === true && near(v.brightness, want, 1) };
    }
    case "set_color_temperature": {
      const want = num(p.kelvin)!;
      return { requested: { color_temperature: want }, matches: (v) => near(v.color_temperature, want, 60) };
    }
    case "set_color": {
      const want = p.rgb as number[];
      return {
        requested: { color: { rgb: want } },
        matches: (v) => { const rgb = (v.color as { rgb?: number[] | null } | null)?.rgb; return !!rgb && rgb.every((c, i) => Math.abs(c - want[i]!) <= 4); },
      };
    }
    case "set_speed": {
      const want = num(p.percentage)!; // fan percentage steps can be as coarse as 34
      return { requested: { fan_speed: want }, matches: (v) => near(v.fan_speed, want, want === 0 ? 0 : 34) };
    }
    case "set_oscillation": return eq("oscillation", p.oscillating);
    case "set_direction": return eq("direction", p.direction);
    case "set_preset_mode": return eq(domain === "climate" ? "climate_preset" : "fan_preset", p.preset_mode);
    case "set_hvac_mode": return eq("hvac_mode", p.hvac_mode);
    case "set_temperature": {
      const want = num(p.temperature)!;
      return { requested: { target_temperature: want }, matches: (v) => near(v.target_temperature, want, 0.5) };
    }
    case "set_fan_mode": return eq("fan_mode", p.fan_mode);
    case "set_swing_mode": return eq("swing", p.swing_mode);
    case "open": return domain === "lock" ? eq("lock", "open") : eq("cover", "open");
    case "close": return eq("cover", "closed");
    case "set_position": {
      const want = num(p.position)!;
      return { requested: { position: want }, matches: (v) => near(v.position, want, 2) };
    }
    case "lock": return eq("lock", "locked");
    case "unlock": return eq("lock", "unlocked");
    case "set_value": {
      const want = num(p.value)!;
      return { requested: { number: want }, matches: (v) => near(v.number, want, 0.01) };
    }
    default: return null; // activate, run, stop
  }
}
