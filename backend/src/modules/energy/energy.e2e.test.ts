import { beforeEach, describe, expect, test } from "bun:test";
import { changeState, createWorld, homeWithHa, type World } from "../../testing/world";
import { startOfLocalDay, toKwh, toWatts } from "./energy.service";

describe("units and the start of the day", () => {
  test("watts and kilowatt-hours are normalised", () => {
    expect([toWatts(1.5, "kW"), toWatts(800, "W"), toWatts(2500, "mW"), toWatts(0.002, "MW")]).toEqual([1500, 800, 2.5, 2000]);
    expect([toKwh(2500, "Wh"), toKwh(1.2, "kWh"), toKwh(0.003, "MWh")]).toEqual([2.5, 1.2, 3]);
  });
  test("today starts at midnight in the household's time zone", () => {
    const t = Date.parse("2026-11-05T17:30:00Z");
    expect(startOfLocalDay(t, "UTC")).toBe(Date.parse("2026-11-05T00:00:00Z"));
    expect(startOfLocalDay(t, "Asia/Kolkata")).toBe(Date.parse("2026-11-04T18:30:00Z")); // 11 pm there is still the 5th, and the 5th began at 18:30 UTC on the 4th
  });
});

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
const NOON = Date.parse("2026-11-05T12:00:00Z");
const hour = (iso: string, change: number) => ({ start: Date.parse(iso), end: Date.parse(iso) + 3_600_000, change });
const power = (watts: number | string, unit = "W") => changeState(w.gw, "sensor.kettle_plug_power", String(watts), { friendly_name: "Kettle plug Power", device_class: "power", unit_of_measurement: unit });
const get = async (path: string, b = h.admin) => (await b.call("GET", path)).json;

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
  w.clock.now = NOON;
  await h.admin.login();
  // Kettle: kWh sensor. Floor lamp: Wh sensor (40000 Wh etc.), so conversion matters.
  w.gw.statistics["sensor.kettle_plug_energy"] = { hour: [hour("2026-11-05T01:00:00Z", 0.4), hour("2026-11-05T07:00:00Z", 1.1), hour("2026-11-05T11:00:00Z", 0.5), hour("2026-11-04T20:00:00Z", 9)] };
  w.gw.statistics["sensor.floor_lamp_energy"] = { hour: [hour("2026-11-05T09:00:00Z", 300), hour("2026-11-05T10:00:00Z", 200)] }; // Wh
});

describe("summary", () => {
  test("adds up the draw now and today's use so far (kWh), and names the biggest users", async () => {
    power(1350);
    const s = await get("/energy/summary");
    expect(s).toMatchObject({ nowWatts: 1350, todayKwh: 2.5, statisticsAvailable: true, monitoredDevices: 2 });
    expect(s.topToday).toEqual([{ thingId: expect.any(String), name: "Kettle plug", watts: 1350, todayKwh: 2 }, { thingId: expect.any(String), name: "Floor lamp", watts: null, todayKwh: 0.5 }]);
    expect(w.gw.statisticsCalls.at(-1)).toMatchObject({ period: "hour", from: Date.parse("2026-11-05T00:00:00Z") }); // only today, so yesterday's 9 kWh is not in it
  });

  test("a different time zone moves midnight; kilowatts are converted", async () => {
    await h.admin.call("PATCH", "/household", { timezone: "America/New_York" }); // midnight there was 05:00 UTC
    power(1.5, "kW");
    const s = await get("/energy/summary");
    expect(s.nowWatts).toBe(1500);
    expect(s.todayKwh).toBe(1.6 + 0.5); // 07:00, 11:00 for the kettle (1.1 + 0.5) and 09:00, 10:00 for the lamp (0.5)
    expect(w.gw.statisticsCalls.at(-1)!.from).toBe(Date.parse("2026-11-05T05:00:00Z"));
  });

  test("if Home Assistant cannot give statistics the live draw is still shown, and it says so", async () => {
    power(900);
    w.gw.setStatus("reconnecting");
    expect(await get("/energy/summary")).toMatchObject({ nowWatts: 900, todayKwh: null, statisticsAvailable: false });
  });

  test("devices you cannot see are left out of your totals", async () => {
    power(1000);
    const meera = await h.join("Meera", { role: "member" });
    const meeraId = (await meera.call("GET", "/users/me")).json.id;
    expect((await get("/energy/summary", meera)).todayKwh).toBe(2.5);
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "switch.kettle_plug", subjectType: "member", subjectId: meeraId, effect: "deny" });
    expect(await get("/energy/summary", meera)).toMatchObject({ nowWatts: 0, todayKwh: 0.5, monitoredDevices: 1 });
    expect((await get("/energy/summary")).todayKwh).toBe(2.5); // the admin still sees everything
  });

  test("guests have no energy figures", async () => {
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    for (const p of ["/energy/summary", "/energy/history", "/energy/devices"]) expect((await lakshmi.call("GET", p)).status).toBe(403);
  });
});

describe("history", () => {
  test("hourly figures for a day, summed across devices, with a line per device", async () => {
    const r = await get(`/energy/history?from=${Date.parse("2026-11-05T00:00:00Z")}&to=${NOON}`);
    expect(r).toMatchObject({ resolution: "hour", totalKwh: 2.5 });
    expect(r.series).toEqual([
      { start: Date.parse("2026-11-05T01:00:00Z"), kwh: 0.4 }, { start: Date.parse("2026-11-05T07:00:00Z"), kwh: 1.1 },
      { start: Date.parse("2026-11-05T09:00:00Z"), kwh: 0.3 }, { start: Date.parse("2026-11-05T10:00:00Z"), kwh: 0.2 }, { start: Date.parse("2026-11-05T11:00:00Z"), kwh: 0.5 },
    ]);
    expect(r.devices.map((d: any) => [d.name, d.kwh])).toEqual([["Kettle plug", 2], ["Floor lamp", 0.5]]);
  });

  test("daily figures and the limits on each resolution", async () => {
    w.gw.statistics["sensor.kettle_plug_energy"]!.day = [{ start: Date.parse("2026-11-04T00:00:00Z"), end: Date.parse("2026-11-05T00:00:00Z"), change: 9.5 }];
    const r = await get(`/energy/history?resolution=day&from=${Date.parse("2026-11-01T00:00:00Z")}&to=${NOON}`);
    expect(r).toMatchObject({ resolution: "day", totalKwh: 9.5 });
    expect((await h.admin.call("GET", `/energy/history?from=${NOON - 8 * 86_400_000}&to=${NOON}`)).json.error.message).toMatch(/at most 7 days/i);
    expect((await h.admin.call("GET", `/energy/history?resolution=day&from=${NOON - 400 * 86_400_000}&to=${NOON}`)).status).toBe(400);
    expect((await h.admin.call("GET", `/energy/history?from=${NOON}&to=${NOON - 1}`)).status).toBe(400);
    expect((await h.admin.call("GET", "/energy/history?resolution=minute")).status).toBe(422);
  });

  test("Home Assistant being unreachable is a clear 503", async () => {
    w.gw.setStatus("reconnecting");
    expect((await h.admin.call("GET", "/energy/history")).json.error.code).toBe("ha_unreachable");
  });
});

describe("per device", () => {
  test("power now, energy today and where each is against its power limit", async () => {
    const kettle = (await get("/devices")).devices.find((d: any) => d.name === "Kettle plug");
    await h.admin.call("PATCH", `/devices/${kettle.id}/settings`, { powerLimitW: 2000 });
    power(1500);
    const r = await get("/energy/devices");
    expect(r.statisticsAvailable).toBe(true);
    expect(r.devices).toEqual([
      { thingId: kettle.id, name: "Kettle plug", watts: 1500, todayKwh: 2, limitW: 2000, percentOfLimit: 75 },
      { thingId: expect.any(String), name: "Floor lamp", watts: null, todayKwh: 0.5, limitW: null, percentOfLimit: null },
    ]);
  });

  test("devices without a meter are not listed", async () => {
    const names = (await get("/energy/devices")).devices.map((d: any) => d.name);
    expect(names).toEqual(["Kettle plug", "Floor lamp"]);
    expect(names).not.toContain("Echo Show");
  });
});
