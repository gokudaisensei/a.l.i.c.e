import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import { auditLog } from "../../core/database/schema";
import { MODE_HELPER_ENTITY } from "../home-assistant/config-ops";
import { FakeSocket } from "../../testing/fake-socket";
import type { Browser } from "../../testing/http";
import { changeState, createWorld, homeWithHa, type World } from "../../testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
let n = 0;

const mode = async (b: Browser = h.admin) => (await b.call("GET", "/household/mode")).json;
const helperState = () => w.gw.states.find((s) => s.entity_id === MODE_HELPER_ENTITY)?.state;
/** Admin token stored, helper created by the worker, and Home Assistant's inventory refreshed so Alice sees it. */
async function mirrorOn() {
  await h.withAdminToken();
  await w.sync();
  await h.admin.call("POST", "/ha/connection/resync");
}
/** Moves the clock and signs everyone back in (sessions last 24 hours). */
const at = async (iso: string, ...others: Browser[]) => { w.clock.now = Date.parse(iso); for (const b of [h.admin, ...others]) await b.login(); };
function attach(b: Browser, ...resources: string[]) {
  const session = w.services.auth.getSession(b.cookie.split("=")[1]!)!;
  const s = new FakeSocket(`s${++n}`);
  w.services.realtime.connect(s, session, w.services.households.getMembership(session.userId)!);
  for (const r of resources) w.services.realtime.receive(s.id, JSON.stringify({ type: "subscribe", resource: r }));
  return s;
}

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("mode mirror: Home Assistant follows the household mode", () => {
  test("it says why it is not active, then becomes active once the worker has created the helper", async () => {
    expect((await mode()).mirror).toEqual({ status: "unavailable", reason: expect.stringMatching(/admin token/) });
    await h.withAdminToken();
    expect((await mode()).mirror.status).toBe("waiting");
    await w.sync();
    await h.admin.call("POST", "/ha/connection/resync");
    expect((await mode()).mirror).toEqual({ status: "active", reason: null });
    expect(w.configApi.modeHelperOptions).toEqual(["home", "away", "night", "vacation"]);
  });

  test("a mode set in Alice is set on the helper in Home Assistant", async () => {
    await mirrorOn();
    await h.admin.call("PUT", "/household/mode", { mode: "night" });
    expect(helperState()).toBe("night");
    await h.admin.call("PUT", "/household/mode", { mode: "vacation" });
    expect(helperState()).toBe("vacation");
  });

  test("a mode chosen in Home Assistant becomes Alice's mode, with no echo back", async () => {
    await mirrorOn();
    w.gw.calls.length = 0;
    changeState(w.gw, MODE_HELPER_ENTITY, "away");
    const m = await mode();
    expect(m).toMatchObject({ mode: "away", changedBy: null });
    expect(w.gw.calls).toEqual([]); // Alice did not call back into Home Assistant
    const row = w.db.select().from(auditLog).where(eq(auditLog.action, "household.mode_changed")).all().at(-1)!;
    expect(row).toMatchObject({ actorType: "system", detail: { from: "home", to: "away" } });
  });

  test("something that is not a mode is ignored, and a helper that agrees changes nothing", async () => {
    await mirrorOn();
    changeState(w.gw, MODE_HELPER_ENTITY, "party");
    changeState(w.gw, MODE_HELPER_ENTITY, "home");
    expect((await mode()).mode).toBe("home");
    expect(w.db.select().from(auditLog).where(eq(auditLog.action, "household.mode_changed")).all()).toHaveLength(0);
  });

  test("a helper that did not exist yet does not reset the mode: Alice's mode is pushed to it", async () => {
    await h.admin.call("PUT", "/household/mode", { mode: "night" });
    await mirrorOn(); // the new helper starts as "home"
    expect((await mode()).mode).toBe("night");
    expect(helperState()).toBe("night");
  });

  test("on a reconnect, Alice's mode wins over whatever the helper drifted to", async () => {
    await mirrorOn();
    await h.admin.call("PUT", "/household/mode", { mode: "night" });
    w.gw.states = w.gw.states.map((s) => (s.entity_id === MODE_HELPER_ENTITY ? { ...s, state: "home" } : s)); // changed while Alice was away
    await h.admin.call("POST", "/ha/connection/resync");
    expect(helperState()).toBe("night");
    expect((await mode()).mode).toBe("night");
  });

  test("a failed push to Home Assistant does not stop Alice's mode from changing", async () => {
    await mirrorOn();
    const normal = w.gw.onCallService!;
    w.gw.onCallService = (c) => { if (c.service === "select_option") throw new Error("HA is busy"); return normal(c); };
    expect((await h.admin.call("PUT", "/household/mode", { mode: "away" })).json.mode).toBe("away");
  });
});

describe("mode suggestions", () => {
  const suggestion = async (b: Browser = h.admin) => (await mode(b)).suggestion;
  const people = (state: string) => { for (const p of ["person.gokul", "person.meera"]) changeState(w.gw, p, state); };

  test("at night, a house in Home mode is offered Night mode, with the time in the household's time zone", async () => {
    await at("2026-11-05T22:40:00Z");
    expect(await suggestion()).toMatchObject({ id: "mode:night", title: "Switch to Night mode?", reason: "It is 10:40 pm.", action: { type: "set_mode", mode: "night" } });
    await h.admin.call("PATCH", "/household", { timezone: "Asia/Kolkata" }); // 4:10 am there, still night
    expect((await suggestion()).reason).toBe("It is 4:10 am.");
    await at("2026-11-05T13:00:00Z"); // 6:30 pm in Kolkata: evening, nothing to suggest
    expect(await suggestion()).toBeNull();
  });

  test("when everyone has left, Away is suggested; when someone returns to an Away house, Home is", async () => {
    await at("2026-11-05T13:00:00Z");
    expect(await suggestion()).toBeNull();
    people("not_home");
    expect(await suggestion()).toMatchObject({ id: "mode:away", reason: "Everyone has left." });
    await h.admin.call("PUT", "/household/mode", { mode: "away" });
    expect(await suggestion()).toBeNull();
    changeState(w.gw, "person.meera", "home");
    expect(await suggestion()).toMatchObject({ id: "mode:home", reason: "Someone just got home." });
  });

  test("in the morning a Night house is offered Home", async () => {
    await at("2026-11-05T06:30:00Z");
    await h.admin.call("PUT", "/household/mode", { mode: "night" });
    expect(await suggestion()).toMatchObject({ id: "mode:home", reason: "It is morning." });
  });

  test("'not now' hides it for a while, then it comes back; taking it up clears it", async () => {
    await at("2026-11-05T22:40:00Z");
    expect((await h.admin.call("POST", "/insights/mode:night/dismiss")).status).toBe(200);
    expect(await suggestion()).toBeNull();
    expect((await h.admin.call("GET", "/insights")).json.insights).toEqual([]);
    expect((await h.admin.call("POST", "/insights/mode:night/dismiss")).status).toBe(404); // nothing to dismiss now
    w.clock.now += 7 * 3_600_000; // still night? 5:40 am is morning, so use a night time again
    await at("2026-11-06T23:00:00Z");
    expect(await suggestion()).toMatchObject({ id: "mode:night" });
    await h.admin.call("PUT", "/household/mode", { mode: "night" });
    expect(await suggestion()).toBeNull();
  });

  test("with no people known there is no 'everyone left' suggestion; guests see no suggestions", async () => {
    await at("2026-11-05T13:00:00Z");
    w.gw.states = w.gw.states.filter((s) => !s.entity_id.startsWith("person."));
    await h.admin.call("POST", "/ha/connection/resync");
    expect(await suggestion()).toBeNull();
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    await at("2026-11-05T22:40:00Z", lakshmi);
    expect((await mode(lakshmi)).suggestion).toBeNull();
    expect((await lakshmi.call("GET", "/insights")).status).toBe(403);
  });

  test("clients following the household are told when the suggestion changes", async () => {
    await at("2026-11-05T13:00:00Z");
    const s = attach(h.admin, "household");
    people("not_home");
    expect(s.of("insights.changed").length).toBeGreaterThan(0);
    const before = s.of("insights.changed").length;
    changeState(w.gw, "person.gokul", "not_home"); // no change to the suggestion
    expect(s.of("insights.changed")).toHaveLength(before);
    await h.admin.call("PUT", "/household/mode", { mode: "away" });
    expect(s.of("insights.changed").length).toBeGreaterThan(before);
  });
});
