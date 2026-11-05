import { describe, expect, test } from "bun:test";
import { normalizeState } from "./state-normalizer";
import { resolveOperation } from "./capability-detector";

describe("normalizeState", () => {
  test("light: brightness 0-255 becomes percent; color and mode are grouped", () => {
    const n = normalizeState("light", "on", { brightness: 76, color_temp_kelvin: 4166, rgb_color: [255, 210, 174], hs_color: [26.7, 31.9], color_mode: "color_temp" });
    expect(n).toEqual({ power: true, brightness: 30, color_temperature: 4166, color: { rgb: [255, 210, 174], hs: [26.7, 31.9] }, color_mode: "color_temp" });
  });

  test("light that is off has null attributes, not zeros", () => {
    expect(normalizeState("light", "off", { brightness: null, color_temp_kelvin: null, rgb_color: null, hs_color: null, color_mode: null }))
      .toEqual({ power: false, brightness: null, color_temperature: null, color: null, color_mode: null });
  });

  test("brightness round-trips: the percent we read is the percent we set", () => {
    for (const pct of [1, 10, 30, 50, 80, 100]) {
      const ha = Math.round((pct / 100) * 255); // what HA stores after brightness_pct
      expect(normalizeState("light", "on", { brightness: ha }).brightness).toBe(pct);
    }
    expect(resolveOperation("light", "set_brightness", { brightness_pct: 30 })!.data).toEqual({ brightness_pct: 30 });
  });

  test("fan, climate, cover, lock", () => {
    expect(normalizeState("fan", "on", { percentage: 66, oscillating: true, direction: "forward", preset_mode: null }))
      .toEqual({ power: true, fan_speed: 66, oscillation: true, direction: "forward", fan_preset: null });
    expect(normalizeState("climate", "cool", { temperature: 24, current_temperature: 25.6, fan_mode: "low", hvac_action: "cooling" }))
      .toMatchObject({ power: true, hvac_mode: "cool", target_temperature: 24, temperature: 25.6, fan_mode: "low", hvac_action: "cooling" });
    expect(normalizeState("climate", "off", {})).toMatchObject({ power: false, hvac_mode: "off" });
    expect(normalizeState("cover", "open", { current_position: 70 })).toEqual({ cover: "open", position: 70 });
    expect(normalizeState("lock", "locked", {})).toEqual({ lock: "locked" });
  });

  test("sensors parse numbers and keep units; binary sensors become booleans", () => {
    expect(normalizeState("sensor", "21.5", { unit_of_measurement: "°C", device_class: "temperature" })).toEqual({ sensor: { value: 21.5, unit: "°C", deviceClass: "temperature" } });
    expect(normalizeState("sensor", "idle", {})).toEqual({ sensor: { value: "idle", unit: null, deviceClass: null } });
    expect(normalizeState("binary_sensor", "on", { device_class: "door" })).toEqual({ binary_sensor: true, device_class: "door" });
  });

  test("unavailable or unknown entities and unknown domains yield an empty view", () => {
    expect(normalizeState("light", "unavailable", { brightness: 10 })).toEqual({});
    expect(normalizeState("light", "unknown", {})).toEqual({});
    expect(normalizeState("weird", "on", {})).toEqual({});
  });
});
