import { describe, expect, test } from "bun:test";
import { buildAliases, cleanEntityName, cleanThingName, fixCase, scrub, stripPrefix } from "./name-cleaner";

describe("helpers", () => {
  test("stripPrefix only strips whole words", () => {
    expect(stripPrefix("Kitchen Floor lamp", "Kitchen")).toBe("Floor lamp");
    expect(stripPrefix("Kitchenette lamp", "Kitchen")).toBe("Kitchenette lamp");
    expect(stripPrefix("Kitchen", "Kitchen")).toBe("Kitchen"); // never strips to nothing
  });
  test("scrub removes artifacts but keeps real numbers", () => {
    expect(scrub("outdoor_temp_2")).toBe("outdoor temp");
    expect(scrub("Light None")).toBe("Light");
    expect(scrub("Bedroom 10")).toBe("Bedroom 10");
  });
  test("fixCase only touches single-case text and keeps acronyms", () => {
    expect(fixCase("outdoor temp")).toBe("Outdoor temp".replace("temp", "Temp"));
    expect(fixCase("living room tv")).toBe("Living Room TV");
    expect(fixCase("Living room")).toBe("Living room"); // mixed case is deliberate
  });
});

describe("cleanEntityName", () => {
  const base = { sourceName: "", ownName: null, hasEntityName: true, deviceName: "Echo Show", areaName: "Kitchen" };
  test("drops the device name HA prepends", () => {
    expect(cleanEntityName({ ...base, sourceName: "Echo Show Microphone mute", ownName: "Microphone mute" })).toBe("Microphone mute");
  });
  test("returns null when the entity is the device", () => {
    expect(cleanEntityName({ ...base, sourceName: "Echo Show", ownName: null })).toBeNull();
  });
  test("strips device then area prefixes for entities without has_entity_name", () => {
    expect(cleanEntityName({ sourceName: "Living room Floor lamp", ownName: null, hasEntityName: false, deviceName: null, areaName: "Living room" })).toBe("Floor lamp");
  });
});

describe("cleanThingName / aliases", () => {
  test("strips the area prefix", () => {
    expect(cleanThingName("Living room Floor lamp", "Living room")).toBe("Floor lamp");
    expect(cleanThingName("Echo Show", "Kitchen")).toBe("Echo Show");
  });
  test("aliases include area-qualified and synonym phrases", () => {
    const a = buildAliases("Floor lamp", "Living room", "light");
    expect(a).toContain("floor lamp");
    expect(a).toContain("living room floor lamp");
    expect(a).toContain("living room bulb"); // synonym not already in the name
    expect(a).not.toContain("living room lamp"); // "lamp" is already in the name
  });
});
