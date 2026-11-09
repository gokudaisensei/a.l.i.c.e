import { beforeEach, describe, expect, test } from "bun:test";
import { createWorld, homeWithHa, type World } from "../../testing/world";
import { downsample, parseRange } from "./history.service";

describe("thinning a long history", () => {
  const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ at: 1000 + i * 10, v: i }));
  test("small histories are untouched", () => {
    expect(downsample(pts(5), 10)).toEqual(pts(5));
  });
  test("large ones are cut to the limit, in order, keeping the first point and the last state of each slice", () => {
    const out = downsample(pts(1000), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out[0]).toEqual(pts(1000)[0]!);
    expect(out.at(-1)).toEqual(pts(1000).at(-1)!); // the final state is never lost
    expect(out.every((p, i) => i === 0 || p.at > out[i - 1]!.at)).toBe(true);
    expect(out.every((p) => pts(1000).some((q) => q.at === p.at && q.v === p.v))).toBe(true); // nothing is invented
  });
});

describe("time ranges", () => {
  test("default to the last day, accept ISO times and epoch milliseconds, and refuse nonsense", () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    expect(parseRange(undefined, undefined, now)).toEqual({ from: now - 86_400_000, to: now });
    expect(parseRange("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z", now)).toEqual({ from: Date.parse("2026-11-01T00:00:00Z"), to: Date.parse("2026-11-02T00:00:00Z") });
    expect(parseRange(String(now - 1000), String(now), now)).toEqual({ from: now - 1000, to: now });
    expect(() => parseRange("2026-11-02T00:00:00Z", "2026-11-01T00:00:00Z", now)).toThrow(/before/);
    expect(() => parseRange("2026-09-01T00:00:00Z", "2026-11-01T00:00:00Z", now)).toThrow(/31 days/);
    expect(() => parseRange("yesterday-ish", undefined, now)).toThrow(/not a time/);
  });
});

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
const T0 = 1_700_000_000_000;
const lamp = (state: string, brightness: number | null, at: number) => ({ at, state, attributes: { supported_color_modes: ["brightness"], brightness } });
const thing = async (name: string) => (await h.admin.call("GET", "/devices")).json.devices.find((d: any) => d.name === name).id as string;

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
  w.gw.history["light.floor_lamp"] = [lamp("off", null, T0 - 3600_000), lamp("on", 128, T0 - 1800_000), lamp("on", 255, T0 - 600_000), lamp("unavailable", null, T0 - 60_000)];
  w.gw.history["sensor.kettle_plug_power"] = [{ at: T0 - 300_000, state: "0", attributes: { device_class: "power", unit_of_measurement: "W" } }, { at: T0 - 120_000, state: "1400", attributes: { device_class: "power", unit_of_measurement: "W" } }];
});

describe("a device's history", () => {
  test("shows the main entity over the last day with application-level values", async () => {
    const r = (await h.admin.call("GET", `/history/devices/${await thing("Floor lamp")}`)).json;
    expect(r).toMatchObject({ entityId: "light.floor_lamp", name: "Floor lamp", from: T0 - 86_400_000, to: T0, totalPoints: 4, downsampled: false });
    expect(r.points.map((p: any) => [p.state, p.values.brightness ?? null, p.availability])).toEqual([["off", null, "available"], ["on", 50, "available"], ["on", 100, "available"], ["unavailable", null, "unavailable"]]);
    expect(r.points[1].values).toMatchObject({ power: true, brightness: 50 });
    expect(w.gw.historyCalls.at(-1)).toMatchObject({ ids: ["light.floor_lamp"], from: T0 - 86_400_000, to: T0 });
  });

  test("another entity of the same device can be asked for, such as its power reading", async () => {
    const r = (await h.admin.call("GET", `/history/devices/${await thing("Kettle plug")}?entityId=sensor.kettle_plug_power`)).json;
    expect(r.points.map((p: any) => p.values.sensor.value)).toEqual([0, 1400]);
    expect(r.points[0].values.sensor).toMatchObject({ unit: "W", deviceClass: "power" });
    expect(r.name).toBe("Kettle plug Power");
  });

  test("a time window can be given, and long histories are thinned and say so", async () => {
    w.gw.history["light.floor_lamp"] = Array.from({ length: 400 }, (_, i) => lamp(i % 2 ? "on" : "off", 100, T0 - 400_000 + i * 1000));
    const id = await thing("Floor lamp");
    const r = (await h.admin.call("GET", `/history/devices/${id}?maxPoints=50`)).json;
    expect(r).toMatchObject({ totalPoints: 400, downsampled: true });
    expect(r.points.length).toBeLessThanOrEqual(50);
    const win = (await h.admin.call("GET", `/history/devices/${id}?from=${T0 - 100_000}&to=${T0}`)).json;
    expect(win.totalPoints).toBe(100);
    expect(w.gw.historyCalls.at(-1)).toMatchObject({ from: T0 - 100_000, to: T0 });
  });

  test("bad requests are explained", async () => {
    const id = await thing("Floor lamp");
    expect((await h.admin.call("GET", `/history/devices/${id}?from=nope`)).json.error.code).toBe("validation_error");
    expect((await h.admin.call("GET", `/history/devices/${id}?from=${T0}&to=${T0 - 1}`)).status).toBe(400);
    expect((await h.admin.call("GET", `/history/devices/${id}?from=${T0 - 40 * 86_400_000}&to=${T0}`)).status).toBe(400);
    expect((await h.admin.call("GET", `/history/devices/${id}?entityId=light.ceiling_lights`)).status).toBe(404); // not part of this device
    expect((await h.admin.call("GET", "/history/devices/thing_nope")).status).toBe(404);
    expect((await h.admin.call("GET", `/history/devices/${id}?maxPoints=5`)).status).toBe(422);
  });

  test("Home Assistant being unreachable is a 503, not a crash", async () => {
    w.gw.setStatus("reconnecting");
    expect((await h.admin.call("GET", `/history/devices/${await thing("Floor lamp")}`)).json.error.code).toBe("ha_unreachable");
  });
});

describe("who can look", () => {
  test("members can; guests cannot at all", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    const id = await thing("Floor lamp");
    expect((await meera.call("GET", `/history/devices/${id}`)).status).toBe(200);
    expect((await lakshmi.call("GET", `/history/devices/${id}`)).status).toBe(403);
  });

  test("a device denied to someone is not there for them, and neither are entities they cannot see", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const meeraId = (await meera.call("GET", "/users/me")).json.id;
    const lampId = await thing("Floor lamp");
    const kettleId = await thing("Kettle plug");
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "light.floor_lamp", subjectType: "member", subjectId: meeraId, effect: "deny" });
    expect((await meera.call("GET", `/history/devices/${lampId}`)).status).toBe(404);
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "sensor.kettle_plug_power", subjectType: "member", subjectId: meeraId, effect: "deny" });
    expect((await meera.call("GET", `/history/devices/${kettleId}?entityId=sensor.kettle_plug_power`)).status).toBe(404);
    expect((await meera.call("GET", `/history/devices/${kettleId}`)).status).toBe(200); // the plug itself is still hers
  });
});
