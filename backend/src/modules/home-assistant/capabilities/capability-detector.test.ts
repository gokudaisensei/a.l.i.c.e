import { describe, expect, test } from "bun:test";
import { detectCapabilities, resolveOperation, supportsOperation } from "./capability-detector";

const caps = (domain: string, attributes: Record<string, unknown>) => detectCapabilities({ entityId: `${domain}.x`, domain, attributes });
const names = (c: ReturnType<typeof caps>) => c.map((x) => x.name);

describe("detectCapabilities", () => {
  test("on/off-only light has no brightness", () => {
    expect(names(caps("light", { supported_color_modes: ["onoff"] }))).toEqual(["power"]);
  });
  test("dimmable light gets brightness; color light gets color; tunable white gets color temperature", () => {
    expect(names(caps("light", { supported_color_modes: ["brightness"] }))).toEqual(["power", "brightness"]);
    expect(names(caps("light", { supported_color_modes: ["color_temp", "hs"] }))).toEqual(["power", "brightness", "color_temperature", "color"]);
  });
  test("fan features come from supported_features bits", () => {
    expect(names(caps("fan", { supported_features: 1 | 2 }))).toEqual(["power", "fan_speed", "oscillation"]);
    expect(names(caps("fan", { supported_features: 0 }))).toEqual(["power"]);
  });
  test("climate exposes only what the device supports", () => {
    const c = caps("climate", { supported_features: 1 | 8, hvac_modes: ["off", "cool"], fan_modes: ["low"] });
    expect(names(c)).toEqual(["hvac_mode", "target_temperature", "fan_mode", "temperature"]);
  });
  test("cover operations follow feature bits", () => {
    const c = caps("cover", { supported_features: 1 | 2 | 4 });
    expect(c[0]!.operations).toEqual(["open", "close"]);
    expect(names(c)).toContain("position");
  });
  test("lock is flagged sensitive", () => {
    expect(caps("lock", {})[0]!.metadata).toEqual({ sensitive: true });
  });
  test("sensors are read-only; unknown domains fall back to read-only state", () => {
    expect(caps("sensor", {})[0]!.controllable).toBe(false);
    expect(caps("weird", {})[0]!).toMatchObject({ name: "state", controllable: false });
  });
});

describe("resolveOperation", () => {
  test("maps application operations to HA services", () => {
    expect(resolveOperation("light", "set_brightness", { brightness_pct: 60 })).toEqual({ domain: "light", service: "turn_on", data: { brightness_pct: 60 } });
    expect(resolveOperation("lock", "unlock")).toEqual({ domain: "lock", service: "unlock", data: {} });
    expect(resolveOperation("cover", "close")).toEqual({ domain: "cover", service: "close_cover", data: {} });
  });
  test("returns null for unsupported operations", () => {
    expect(resolveOperation("sensor", "turn_on")).toBeNull();
    expect(resolveOperation("light", "explode")).toBeNull();
  });
  test("supportsOperation checks controllable capabilities", () => {
    const c = caps("light", { supported_color_modes: ["onoff"] });
    expect(supportsOperation(c, "turn_on")).toBe(true);
    expect(supportsOperation(c, "set_brightness")).toBe(false);
  });
});
