import type { CapabilitySource, DeviceCapability } from "./types";

const has = (features: number, bit: number) => (features & bit) !== 0;
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const features = (a: Record<string, unknown>) => Number(a.supported_features ?? 0);

const COLOR_MODES = new Set(["hs", "xy", "rgb", "rgbw", "rgbww"]);

type Detector = (a: Record<string, unknown>) => DeviceCapability[];

const power = (ops = ["turn_on", "turn_off", "toggle"]): DeviceCapability => ({
  name: "power", readable: true, controllable: true, operations: ops,
});

/** Capabilities come from real attributes and supported_features, never from the domain alone. */
const DETECTORS: Record<string, Detector> = {
  light: (a) => {
    const modes = list(a.supported_color_modes);
    const caps = [power()];
    if (modes.some((m) => m !== "onoff")) {
      caps.push({ name: "brightness", readable: true, controllable: true, operations: ["set_brightness"], metadata: { min: 1, max: 100, unit: "%" } });
    }
    if (modes.includes("color_temp")) {
      caps.push({ name: "color_temperature", readable: true, controllable: true, operations: ["set_color_temperature"], metadata: { minKelvin: a.min_color_temp_kelvin, maxKelvin: a.max_color_temp_kelvin } });
    }
    if (modes.some((m) => COLOR_MODES.has(m))) {
      caps.push({ name: "color", readable: true, controllable: true, operations: ["set_color"] });
    }
    return caps;
  },
  switch: () => [power()],
  input_boolean: () => [power()],
  fan: (a) => {
    const f = features(a);
    const caps = [power()];
    if (has(f, 1)) caps.push({ name: "fan_speed", readable: true, controllable: true, operations: ["set_speed"], metadata: { step: a.percentage_step } });
    if (has(f, 2)) caps.push({ name: "oscillation", readable: true, controllable: true, operations: ["set_oscillation"] });
    if (has(f, 4)) caps.push({ name: "direction", readable: true, controllable: true, operations: ["set_direction"] });
    if (has(f, 8)) caps.push({ name: "fan_preset", readable: true, controllable: true, operations: ["set_preset_mode"], metadata: { presets: list(a.preset_modes) } });
    return caps;
  },
  climate: (a) => {
    const f = features(a);
    const caps: DeviceCapability[] = [];
    const modes = list(a.hvac_modes);
    if (modes.length) caps.push({ name: "hvac_mode", readable: true, controllable: true, operations: ["set_hvac_mode"], metadata: { modes } });
    if (has(f, 1)) caps.push({ name: "target_temperature", readable: true, controllable: true, operations: ["set_temperature"], metadata: { min: a.min_temp, max: a.max_temp, step: a.target_temp_step } });
    if (has(f, 8)) caps.push({ name: "fan_mode", readable: true, controllable: true, operations: ["set_fan_mode"], metadata: { modes: list(a.fan_modes) } });
    if (has(f, 16)) caps.push({ name: "climate_preset", readable: true, controllable: true, operations: ["set_preset_mode"], metadata: { presets: list(a.preset_modes) } });
    if (has(f, 32)) caps.push({ name: "swing", readable: true, controllable: true, operations: ["set_swing_mode"], metadata: { modes: list(a.swing_modes) } });
    caps.push({ name: "temperature", readable: true, controllable: false, operations: [] });
    return caps;
  },
  cover: (a) => {
    const f = features(a);
    const ops: string[] = [];
    if (has(f, 1)) ops.push("open");
    if (has(f, 2)) ops.push("close");
    if (has(f, 8)) ops.push("stop");
    const caps: DeviceCapability[] = [{ name: "cover", readable: true, controllable: ops.length > 0, operations: ops }];
    if (has(f, 4)) caps.push({ name: "position", readable: true, controllable: true, operations: ["set_position"], metadata: { min: 0, max: 100, unit: "%" } });
    return caps;
  },
  lock: (a) => [{ name: "lock", readable: true, controllable: true, operations: has(features(a), 1) ? ["lock", "unlock", "open"] : ["lock", "unlock"], metadata: { sensitive: true } }],
  scene: () => [{ name: "scene", readable: true, controllable: true, operations: ["activate"] }],
  script: () => [{ name: "script", readable: true, controllable: true, operations: ["run"] }],
  input_number: (a) => [{ name: "number", readable: true, controllable: true, operations: ["set_value"], metadata: { min: a.min, max: a.max, step: a.step } }],
  number: (a) => [{ name: "number", readable: true, controllable: true, operations: ["set_value"], metadata: { min: a.min, max: a.max, step: a.step } }],
  media_player: () => [power(["turn_on", "turn_off"])],
  sensor: (a) => [{ name: "sensor", readable: true, controllable: false, operations: [], metadata: { deviceClass: a.device_class, unit: a.unit_of_measurement } }],
  binary_sensor: (a) => [{ name: "binary_sensor", readable: true, controllable: false, operations: [], metadata: { deviceClass: a.device_class } }],
  camera: () => [{ name: "camera", readable: true, controllable: false, operations: [] }],
};

export function detectCapabilities(src: CapabilitySource): DeviceCapability[] {
  const detect = DETECTORS[src.domain];
  return detect ? detect(src.attributes) : [{ name: "state", readable: true, controllable: false, operations: [] }];
}

export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

type Resolver = (p: Record<string, unknown>) => { service: string; data?: Record<string, unknown> };
const simple = (service: string): Resolver => () => ({ service });

/** Maps an application-level operation to the HA service call that implements it. */
const RESOLVERS: Record<string, Record<string, Resolver>> = {
  light: {
    turn_on: simple("turn_on"), turn_off: simple("turn_off"), toggle: simple("toggle"),
    set_brightness: (p) => ({ service: "turn_on", data: { brightness_pct: p.brightness_pct } }),
    set_color_temperature: (p) => ({ service: "turn_on", data: { color_temp_kelvin: p.kelvin } }),
    set_color: (p) => ({ service: "turn_on", data: { rgb_color: p.rgb } }),
  },
  fan: {
    turn_on: simple("turn_on"), turn_off: simple("turn_off"), toggle: simple("toggle"),
    set_speed: (p) => ({ service: "set_percentage", data: { percentage: p.percentage } }),
    set_oscillation: (p) => ({ service: "oscillate", data: { oscillating: p.oscillating } }),
    set_direction: (p) => ({ service: "set_direction", data: { direction: p.direction } }),
    set_preset_mode: (p) => ({ service: "set_preset_mode", data: { preset_mode: p.preset_mode } }),
  },
  climate: {
    set_hvac_mode: (p) => ({ service: "set_hvac_mode", data: { hvac_mode: p.hvac_mode } }),
    set_temperature: (p) => ({ service: "set_temperature", data: { temperature: p.temperature } }),
    set_fan_mode: (p) => ({ service: "set_fan_mode", data: { fan_mode: p.fan_mode } }),
    set_preset_mode: (p) => ({ service: "set_preset_mode", data: { preset_mode: p.preset_mode } }),
    set_swing_mode: (p) => ({ service: "set_swing_mode", data: { swing_mode: p.swing_mode } }),
    turn_on: simple("turn_on"), turn_off: simple("turn_off"),
  },
  cover: {
    open: simple("open_cover"), close: simple("close_cover"), stop: simple("stop_cover"),
    set_position: (p) => ({ service: "set_cover_position", data: { position: p.position } }),
  },
  lock: { lock: simple("lock"), unlock: simple("unlock"), open: simple("open") },
  scene: { activate: simple("turn_on") },
  script: { run: simple("turn_on") },
  input_number: { set_value: (p) => ({ service: "set_value", data: { value: p.value } }) },
  number: { set_value: (p) => ({ service: "set_value", data: { value: p.value } }) },
};
for (const d of ["switch", "input_boolean", "media_player"]) {
  RESOLVERS[d] = { turn_on: simple("turn_on"), turn_off: simple("turn_off"), toggle: simple("toggle") };
}

export function resolveOperation(domain: string, operation: string, params: Record<string, unknown> = {}): ServiceCall | null {
  const r = RESOLVERS[domain]?.[operation];
  if (!r) return null;
  const { service, data } = r(params);
  return { domain, service, data: Object.fromEntries(Object.entries(data ?? {}).filter(([, v]) => v !== undefined)) };
}

export function supportsOperation(caps: DeviceCapability[], operation: string) {
  return caps.some((c) => c.controllable && c.operations.includes(operation));
}
