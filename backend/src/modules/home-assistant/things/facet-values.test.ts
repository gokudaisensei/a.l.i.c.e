import { describe, expect, test } from "bun:test";
import { homeInventory } from "./fixtures/home";
import { describeFacet, describeThingFacets, type FacetInput } from "./facet-values";
import { buildThings } from "./thing-builder";

const f = (o: Partial<FacetInput>): FacetInput => ({ key: "k", entityId: "binary_sensor.x", domain: "binary_sensor", deviceClass: null, name: "Thing", state: "on", ...o });

describe("device_class gives a fixed meaning to on/off", () => {
  test.each([
    ["door", "on", "open", "warn"], ["door", "off", "closed", "ok"],
    ["window", "on", "open", "warn"], ["garage_door", "off", "closed", "ok"],
    ["lock", "on", "unlocked", "warn"], ["lock", "off", "locked", "ok"], // binary_sensor lock: on means unlocked
    ["motion", "on", "detected", "neutral"], ["motion", "off", "clear", "neutral"],
    ["tamper", "on", "tampered", "alert"], ["smoke", "on", "detected", "alert"], ["moisture", "on", "wet", "alert"],
    ["occupancy", "on", "occupied", "neutral"], ["presence", "off", "away", "neutral"],
  ])("%s %s -> %s (%s)", (deviceClass, state, value, tone) => {
    expect(describeFacet(f({ deviceClass, state }))).toMatchObject({ value, tone, ambiguous: false, basis: "device_class" });
  });
});

describe("name tokens settle polarity when there is no device_class", () => {
  test("'closed' in the name: on means closed", () => {
    expect(describeFacet(f({ name: "Camera shutter closed", state: "on" }))).toMatchObject({ value: "closed", label: "Closed", basis: "name", ambiguous: false });
    expect(describeFacet(f({ name: "Camera shutter closed", state: "off" }))).toMatchObject({ value: "open" });
  });
  test("'open' in the name: on means open", () => {
    expect(describeFacet(f({ name: "Shutter open", state: "on" }))).toMatchObject({ value: "open" });
  });
  test("muted", () => {
    expect(describeFacet(f({ key: "mic_muted", name: "Microphone muted", state: "on" }))).toMatchObject({ value: "muted", tone: "warn", sensitive: true });
    expect(describeFacet(f({ name: "Microphone muted", state: "off" }))).toMatchObject({ value: "unmuted", tone: "ok" });
  });
  test("'unmuted' is not read as muted", () => {
    expect(describeFacet(f({ name: "Mic unmuted", state: "on" }))).toMatchObject({ value: "unmuted" });
  });
});

describe("ambiguity is reported, not guessed", () => {
  test("'Camera shutter' with no polarity word is ambiguous and says On/Off", () => {
    expect(describeFacet(f({ key: "privacy_shutter", name: "Camera shutter", state: "off" }))).toMatchObject({ ambiguous: true, value: "off", label: "Off", tone: "neutral", basis: "none", sensitive: true });
  });
  test("an override resolves it, and the opposite is derived", () => {
    const on = describeFacet(f({ key: "privacy_shutter", name: "Camera shutter", state: "on", onMeans: "closed" }));
    const off = describeFacet(f({ key: "privacy_shutter", name: "Camera shutter", state: "off", onMeans: "closed" }));
    expect(on).toMatchObject({ value: "closed", ambiguous: false, basis: "override", active: true });
    expect(off).toMatchObject({ value: "open", ambiguous: false, active: false });
  });
  test("an override beats device_class and names", () => {
    expect(describeFacet(f({ deviceClass: "door", state: "on", onMeans: "closed" }))).toMatchObject({ value: "closed", basis: "override" });
  });
  test("an unknown override value gets a 'not X' opposite", () => {
    expect(describeFacet(f({ state: "off", onMeans: "tilted" }))).toMatchObject({ value: "not tilted" });
  });
});

describe("other states", () => {
  test("enum sensors report their own value", () => {
    expect(describeFacet(f({ domain: "sensor", state: "open" }))).toMatchObject({ value: "open", label: "Open", tone: "warn", basis: "state", active: null });
    expect(describeFacet(f({ domain: "sensor", state: "tilted" }))).toMatchObject({ value: "tilted", tone: "ok" });
  });
  test("unavailable, unknown and missing entities are 'unknown', never a guess", () => {
    for (const state of ["unavailable", "unknown", undefined]) {
      expect(describeFacet(f({ deviceClass: "door", state }))).toMatchObject({ value: "unknown", label: "Unavailable", active: null });
    }
  });
});

describe("describeThingFacets joins the state cache and overrides", () => {
  const echo = buildThings(homeInventory(), "c1").find((t) => t.deviceIds.includes("echo"))!;
  const lookup = (state: string) => (id: string) => (id === "binary_sensor.echo_show_camera_shutter" ? ({ state } as never) : undefined);

  test("the Echo shutter is ambiguous until the user says what 'on' means", () => {
    expect(describeThingFacets(echo, lookup("on"))[0]).toMatchObject({ key: "privacy_shutter", ambiguous: true, label: "On" });
    const ov = { entities: { "binary_sensor.echo_show_camera_shutter": { onMeans: "closed" } } };
    expect(describeThingFacets(echo, lookup("on"), ov)[0]).toMatchObject({ value: "closed", label: "Closed", sensitive: true, ambiguous: false });
    expect(describeThingFacets(echo, lookup("off"), ov)[0]).toMatchObject({ value: "open" });
  });

  test("a Thing with a door-class facet needs no override", () => {
    const things = buildThings(homeInventory(), "c1");
    const door = things.find((t) => t.name === "Front door sensor")!;
    // The door sensor is promoted to primary, so it has no facets; describe its primary as a facet-like input directly.
    expect(door.facets).toHaveLength(0);
    expect(describeFacet(f({ deviceClass: door.primary!.deviceClass, state: "on", key: "door", entityId: door.primary!.entityId }))).toMatchObject({ value: "open" });
  });
});
