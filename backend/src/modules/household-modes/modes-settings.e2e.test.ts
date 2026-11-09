import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog } from "../../core/database/schema";
import { FakeSocket } from "../../testing/fake-socket";
import type { Browser } from "../../testing/http";
import { createWorld, homeWithHa, type World } from "../../testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
let n = 0;

function attach(b: Browser) {
  const session = w.services.auth.getSession(b.cookie.split("=")[1]!)!;
  const s = new FakeSocket(`s${++n}`);
  w.services.realtime.connect(s, session, w.services.households.getMembership(session.userId)!);
  w.services.realtime.receive(s.id, JSON.stringify({ type: "subscribe", resource: "household" }));
  return s;
}
const devices = async (b: Browser) => (await b.call("GET", "/devices")).json.devices as any[];

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("household mode", () => {
  test("starts as home; a member changes it; the new mode shows everywhere, with who changed it", async () => {
    expect((await h.admin.call("GET", "/household/mode")).json).toMatchObject({ mode: "home", changedAt: null, changedBy: null });
    const meera = await h.join("Meera", { role: "member" });
    w.clock.now += 1000;
    const put = await meera.call("PUT", "/household/mode", { mode: "night" });
    expect(put.json).toMatchObject({ mode: "night", changedAt: w.clock.now, changedBy: { displayName: "Meera" } });
    expect((await h.admin.call("GET", "/household/mode")).json.mode).toBe("night");
    expect((await h.admin.call("GET", "/household")).json.mode).toBe("night");
  });

  test("guests cannot change it; unknown modes are refused; unchanged modes do nothing", async () => {
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    expect((await lakshmi.call("PUT", "/household/mode", { mode: "away" })).status).toBe(403);
    expect((await lakshmi.call("GET", "/household/mode")).json.mode).toBe("home"); // guests may see the mode, not change it
    expect((await h.admin.call("PUT", "/household/mode", { mode: "party" })).json.error.code).toBe("validation_error");
    const before = w.db.select().from(auditLog).where(eq(auditLog.action, "household.mode_changed")).all().length;
    await h.admin.call("PUT", "/household/mode", { mode: "home" }); // already home
    expect(w.db.select().from(auditLog).where(eq(auditLog.action, "household.mode_changed")).all()).toHaveLength(before);
  });

  test("a change is pushed to everyone following the household, and audited with from and to", async () => {
    const admin = attach(h.admin);
    const meeraB = await h.join("Meera", { role: "member" });
    const meera = attach(meeraB);
    await h.admin.call("PUT", "/household/mode", { mode: "vacation" });
    for (const s of [admin, meera]) expect(s.of("household.mode_changed")[0]).toMatchObject({ data: { mode: "vacation", previous: "home" } });
    const row = w.db.select().from(auditLog).where(eq(auditLog.action, "household.mode_changed")).get()!;
    expect(row.detail).toEqual({ from: "home", to: "vacation" });
    await h.admin.call("PUT", "/household/mode", { mode: "vacation" });
    expect(admin.of("household.mode_changed")).toHaveLength(1);
  });
});

describe("device settings", () => {
  test("an admin sets a power limit and voice exposure; they show on the device and survive a resync", async () => {
    const heater = (await devices(h.admin)).find((d) => d.name === "Kettle plug");
    expect(heater.settings).toEqual({ powerLimitW: null, voiceExposed: false, voiceSync: { status: "none", error: null } });
    const res = await h.admin.call("PATCH", `/devices/${heater.id}/settings`, { powerLimitW: 1500, voiceExposed: true });
    expect(res.json.settings).toMatchObject({ powerLimitW: 1500, voiceExposed: true });
    await h.admin.call("POST", "/ha/connection/resync");
    expect((await devices(h.admin)).find((d) => d.name === "Kettle plug").settings).toMatchObject({ powerLimitW: 1500, voiceExposed: true });
    expect((await h.admin.call("PATCH", `/devices/${heater.id}/settings`, { powerLimitW: null })).json.settings).toMatchObject({ powerLimitW: null, voiceExposed: true });
  });

  test("only admins can change settings, and bad values are refused", async () => {
    const kettle = (await devices(h.admin)).find((d) => d.name === "Kettle plug");
    const meera = await h.join("Meera", { role: "member" });
    expect((await meera.call("PATCH", `/devices/${kettle.id}/settings`, { voiceExposed: true })).status).toBe(403);
    expect((await h.admin.call("PATCH", `/devices/${kettle.id}/settings`, { powerLimitW: 0 })).json.error.code).toBe("validation_error");
    expect((await h.admin.call("PATCH", `/devices/${kettle.id}/settings`, { powerLimitW: 1_000_000 })).json.error.code).toBe("validation_error");
    expect((await h.admin.call("PATCH", `/devices/${kettle.id}/settings`, {})).json.error.code).toBe("validation_error");
    expect((await h.admin.call("PATCH", `/devices/${kettle.id}/settings`, { entityId: "light.floor_lamp", voiceExposed: true })).json.error.code).toBe("entity_not_in_thing");
    expect((await h.admin.call("PATCH", "/devices/thing_nope/settings", { voiceExposed: true })).status).toBe(404);
  });
});
