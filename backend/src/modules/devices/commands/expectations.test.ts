import { describe, expect, test } from "bun:test";
import { expectationFor, validateParameters } from "./expectations";

describe("validateParameters", () => {
  test("requires and type-checks parameters", () => {
    expect(validateParameters("turn_on")).toBeNull();
    expect(validateParameters("set_brightness", {})).toMatch(/needs/);
    expect(validateParameters("set_brightness", { brightness_pct: "30" })).toMatch(/number/);
    expect(validateParameters("set_brightness", { brightness_pct: 0 })).toMatch(/between/);
    expect(validateParameters("set_brightness", { brightness_pct: 30 })).toBeNull();
    expect(validateParameters("set_color", { rgb: [1, 2] })).toMatch(/rgb|r, g, b/);
    expect(validateParameters("set_color", { rgb: [255, 0, 10] })).toBeNull();
  });
});

describe("expectationFor", () => {
  test("brightness tolerates HA's rounding by one percent", () => {
    const x = expectationFor("light", "set_brightness", { brightness_pct: 30 })!;
    expect(x.matches({ power: true, brightness: 30 })).toBe(true);
    expect(x.matches({ power: true, brightness: 31 })).toBe(true);
    expect(x.matches({ power: true, brightness: 40 })).toBe(false);
    expect(x.matches({ power: false, brightness: 30 })).toBe(false);
  });
  test("power, lock, cover, climate", () => {
    expect(expectationFor("light", "turn_off")!.matches({ power: false })).toBe(true);
    expect(expectationFor("lock", "unlock")!.matches({ lock: "unlocked" })).toBe(true);
    expect(expectationFor("lock", "unlock")!.matches({ lock: "locked" })).toBe(false);
    expect(expectationFor("lock", "open")!.requested).toEqual({ lock: "open" });
    expect(expectationFor("cover", "close")!.matches({ cover: "closing" })).toBe(false); // wait until it is actually closed
    expect(expectationFor("climate", "set_temperature", { temperature: 24 })!.matches({ target_temperature: 24 })).toBe(true);
    expect(expectationFor("climate", "set_preset_mode", { preset_mode: "eco" })!.requested).toEqual({ climate_preset: "eco" });
    expect(expectationFor("fan", "set_preset_mode", { preset_mode: "auto" })!.requested).toEqual({ fan_preset: "auto" });
  });
  test("toggle depends on the state before; nothing observable for scenes", () => {
    expect(expectationFor("switch", "toggle", {}, { power: true })!.requested).toEqual({ power: false });
    expect(expectationFor("switch", "toggle", {}, {})).toBeNull();
    expect(expectationFor("scene", "activate")).toBeNull();
    expect(expectationFor("cover", "stop")).toBeNull();
  });
});
