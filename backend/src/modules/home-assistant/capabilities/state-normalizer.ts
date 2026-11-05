/**
 * Turns raw HA state + attributes into application-level values keyed by capability name,
 * so clients never deal with HA scales or attribute names (e.g. brightness 0-255, hvac_modes).
 * Values mirror the operations in capability-detector.ts: what you read here is what you can set there.
 */
export type NormalizedState = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const pct255 = (v: unknown) => {
  const n = num(v);
  return n === null ? null : Math.round((n / 255) * 100);
};
const tuple = (v: unknown): number[] | null => (Array.isArray(v) && v.every((x) => typeof x === "number") ? (v as number[]) : null);

type Norm = (state: string, a: Record<string, unknown>) => NormalizedState;

const NORMALIZERS: Record<string, Norm> = {
  light: (s, a) => ({
    power: s === "on",
    brightness: pct255(a.brightness),
    color_temperature: num(a.color_temp_kelvin),
    color: a.rgb_color || a.hs_color ? { rgb: tuple(a.rgb_color), hs: tuple(a.hs_color) } : null,
    color_mode: str(a.color_mode),
  }),
  switch: (s) => ({ power: s === "on" }),
  input_boolean: (s) => ({ power: s === "on" }),
  fan: (s, a) => ({
    power: s === "on",
    fan_speed: num(a.percentage),
    oscillation: typeof a.oscillating === "boolean" ? a.oscillating : null,
    direction: str(a.direction),
    fan_preset: str(a.preset_mode),
  }),
  climate: (s, a) => ({
    power: s !== "off",
    hvac_mode: s,
    target_temperature: num(a.temperature),
    temperature: num(a.current_temperature),
    fan_mode: str(a.fan_mode),
    climate_preset: str(a.preset_mode),
    swing: str(a.swing_mode),
    hvac_action: str(a.hvac_action),
  }),
  cover: (s, a) => ({ cover: s, position: num(a.current_position) }), // open | closed | opening | closing
  lock: (s) => ({ lock: s }), // locked | unlocked | locking | unlocking | jammed | open
  media_player: (s) => ({ power: !["off", "standby"].includes(s) }),
  input_number: (s) => ({ number: num(Number(s)) }),
  number: (s) => ({ number: num(Number(s)) }),
  sensor: (s, a) => {
    const n = Number(s);
    return { sensor: { value: s !== "" && Number.isFinite(n) ? n : s, unit: str(a.unit_of_measurement), deviceClass: str(a.device_class) } };
  },
  binary_sensor: (s, a) => ({ binary_sensor: s === "on", device_class: str(a.device_class) }),
};

/** Unavailable/unknown entities have no meaningful values; return an empty view. */
export function normalizeState(domain: string, state: string, attributes: Record<string, unknown>): NormalizedState {
  if (state === "unavailable" || state === "unknown") return {};
  return NORMALIZERS[domain]?.(state, attributes) ?? {};
}
