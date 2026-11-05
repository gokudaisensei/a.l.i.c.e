import { describe, expect, test } from "bun:test";
import { homeInventory } from "./fixtures/home";
import { buildThings } from "./thing-builder";

const things = () => buildThings(homeInventory(), "c1");
const byName = (n: string) => things().find((t) => t.name === n)!;
const ids = (xs: { entityId: string }[]) => xs.map((x) => x.entityId).sort();

describe("Echo-style ESPHome device", () => {
  const echo = () => byName("Echo Show");

  test("one Thing; media player is primary, camera is a second primary", () => {
    expect(echo().primary?.entityId).toBe("media_player.echo_show");
    expect(ids(echo().others)).toEqual(["camera.echo_show_camera"]);
    expect(echo().kind).toBe("device");
    expect(echo().areaId).toBe("kitchen");
  });

  test("mic mute and volume are controls with clean names", () => {
    expect(ids(echo().controls)).toEqual(["number.echo_show_volume", "switch.echo_show_microphone_mute"]);
    expect(echo().controls.map((c) => c.name).sort()).toEqual(["Microphone mute", "Volume"]);
  });

  test("camera shutter is a facet attached to the primary, not a device or control", () => {
    const [shutter] = echo().facets;
    expect(echo().facets).toHaveLength(1);
    expect(shutter).toMatchObject({ entityId: "binary_sensor.echo_show_camera_shutter", key: "privacy_shutter", attachedTo: "media_player.echo_show", name: "Camera shutter" });
    expect(things().some((t) => t.primary?.entityId === shutter!.entityId)).toBe(false);
  });

  test("wifi, uptime and restart are hidden diagnostics, not controls or sensors", () => {
    expect(ids(echo().diagnostics)).toEqual(["button.echo_show_restart", "sensor.echo_show_uptime", "sensor.echo_show_wifi_signal"]);
    expect(echo().sensors.map((s) => s.entityId)).not.toContain("sensor.echo_show_wifi_signal");
  });

  test("the same hardware seen via a second integration (same MAC) merges into the Thing", () => {
    expect(echo().deviceIds.sort()).toEqual(["echo", "echo_alexa"]);
    expect(ids(echo().sensors)).toEqual(["sensor.kitchen_display_next_alarm"]);
    expect(things().filter((t) => t.deviceIds.includes("echo_alexa"))).toHaveLength(1);
  });
});

describe("other household shapes", () => {
  test("area prefix is dropped from names and kept in aliases", () => {
    const lamp = byName("Floor lamp");
    expect(lamp.sourceName).toBe("Living room Floor lamp");
    expect(lamp.nameSource).toBe("computed");
    expect(lamp.aliases).toContain("living room floor lamp");
  });

  test("bulbs stay separate Things linked to their hub", () => {
    const bridge = byName("Hue Bridge");
    expect(byName("Floor lamp").hubThingId).toBe(bridge.id);
    expect(byName("Ceiling lights").hubThingId).toBe(bridge.id);
    expect(bridge.hubThingId).toBeNull();
    expect(bridge.hidden).toBe(true); // only config entities, so not a card of its own
    expect(bridge.primary).toBeNull();
  });

  test("a plug's switch is promoted to primary; power stays a sensor", () => {
    const plug = byName("Kettle plug");
    expect(plug.primary).toMatchObject({ entityId: "switch.kettle_plug", role: "primary" });
    expect(ids(plug.sensors)).toEqual(["sensor.kettle_plug_power"]);
  });

  test("a door contact sensor is promoted to primary with battery as a sensor", () => {
    const door = byName("Front door sensor");
    expect(door.primary?.entityId).toBe("binary_sensor.front_door_sensor_door");
    expect(ids(door.sensors)).toEqual(["sensor.front_door_sensor_battery"]);
  });

  test("service devices and device-less helpers get the right kind", () => {
    expect(byName("Sun").kind).toBe("service");
    const helper = byName("Movie mode");
    expect(helper.kind).toBe("virtual");
    expect(helper.primary?.entityId).toBe("input_boolean.movie_mode");
  });

  test("scrubs artifacts from device-less YAML entities", () => {
    expect(byName("Outdoor Temp").primary?.entityId).toBe("sensor.outdoor_temp_2");
  });

  test("Thing ids are stable across rebuilds and distinct per connection", () => {
    const a = buildThings(homeInventory(), "c1").map((t) => t.id);
    expect(buildThings(homeInventory(), "c1").map((t) => t.id)).toEqual(a);
    expect(buildThings(homeInventory(), "c2").map((t) => t.id)).not.toEqual(a);
  });
});

describe("user overrides beat automatic decisions", () => {
  const inv = homeInventory();

  test("rename and hide a Thing", () => {
    const t = buildThings(inv, "c1", { things: { "device:echo": { displayName: "Kitchen screen", hidden: true } } });
    const echo = t.find((x) => x.deviceIds.includes("echo"))!;
    expect(echo).toMatchObject({ name: "Kitchen screen", nameSource: "override", hidden: true });
  });

  test("force a role and rename an entity", () => {
    const t = buildThings(inv, "c1", { entities: { "sensor.echo_show_uptime": { role: "sensor", displayName: "Running for" } } });
    const echo = t.find((x) => x.deviceIds.includes("echo"))!;
    expect(echo.sensors.find((s) => s.entityId === "sensor.echo_show_uptime")).toMatchObject({ name: "Running for", roleReason: "set by user" });
    expect(echo.diagnostics.map((d) => d.entityId)).not.toContain("sensor.echo_show_uptime");
  });

  test("split an entity into its own Thing; merge two Things (keeps first id)", () => {
    const split = buildThings(inv, "c1", { splits: ["number.echo_show_volume"] });
    expect(split.find((x) => x.entityIds.includes("number.echo_show_volume"))!.entityIds).toEqual(["number.echo_show_volume"]);

    const before = buildThings(inv, "c1");
    const kettle = before.find((t) => t.name === "Kettle plug")!;
    const merged = buildThings(inv, "c1", { merges: [["device:kettle", "device:front_contact"]] });
    const m = merged.find((t) => t.deviceIds.includes("kettle"))!;
    expect(m.deviceIds.sort()).toEqual(["front_contact", "kettle"]);
    expect(m.id).toBe(kettle.id);
  });

  test("re-attach a facet to a chosen entity", () => {
    const t = buildThings(inv, "c1", { entities: { "binary_sensor.echo_show_camera_shutter": { attachTo: "camera.echo_show_camera" } } });
    const echo = t.find((x) => x.deviceIds.includes("echo"))!;
    expect(echo.facets[0]!.attachedTo).toBe("camera.echo_show_camera");
  });
});
