import { beforeEach, describe, expect, test } from "bun:test";
import { FakeSocket } from "@/testing/fake-socket";
import type { Browser } from "@/testing/http";
import { changeState, createWorld, homeWithHa, type World } from "@/testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
let n = 0;

const feed = async (b: Browser, qs = "") => (await b.call("GET", `/activity${qs}`)).json;
const texts = async (b: Browser, qs = "") => (await feed(b, qs)).items.map((i: any) => (i.actor ? `${i.actor.name} ` : "") + i.summary);
const thing = async (b: Browser, name: string) => (await b.call("GET", "/devices")).json.devices.find((d: any) => d.name === name);
const run = async (b: Browser, name: string, action: string, parameters?: object) => {
  const t = await thing(b, name);
  const res = await b.call("POST", `/devices/${t.id}/commands`, { action, parameters });
  await w.services.commands.done(res.json.id);
  w.clock.now += 1000;
};
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

describe("what gets written", () => {
  test("a person's command reads as a sentence about them; failures and no-ops are not logged", async () => {
    const meera = await h.join("Meera", { role: "member" });
    await run(meera, "Floor lamp", "set_brightness", { brightness_pct: 30 });
    await run(meera, "Kettle plug", "turn_off"); // it already is off: nothing happened
    const bad = await thing(meera, "Kettle plug");
    await meera.call("POST", `/devices/${bad.id}/commands`, { action: "set_brightness", parameters: { brightness_pct: 5 } }); // not supported: fails
    await new Promise((r) => setTimeout(r, 10));
    expect(await texts(h.admin)).toEqual(["Meera set Floor lamp to 30%"]);
    expect((await feed(h.admin)).items[0]).toMatchObject({ kind: "device", actor: { name: "Meera" }, thingId: expect.stringMatching(/^thing_/), tone: "info" });
  });

  test("scenes, routines, modes, automations and alerts each leave an entry", async () => {
    const scene = (await h.admin.call("POST", "/scenes", { name: "Movie night", actions: [{ entityId: "light.floor_lamp", action: "turn_off" }] })).json;
    await Promise.all((await h.admin.call("POST", `/scenes/${scene.id}/activate`)).json.commands.map((c: any) => w.services.commands.done(c.id)));
    w.clock.now += 1000;
    const routine = (await h.admin.call("POST", "/routines", { name: "Goodnight", steps: [{ type: "device", entityId: "light.ceiling_lights", action: "turn_off" }, { type: "mode", mode: "night" }] })).json;
    await h.admin.call("POST", `/routines/${routine.id}/execute`);
    await w.services.routines.finished((await h.admin.call("GET", "/routines/runs")).json.runs[0].id);
    w.clock.now += 1000;
    await h.admin.call("PUT", "/household/mode", { mode: "vacation" });
    const all = await texts(h.admin);
    expect(all).toContain("Gokul ran the “Movie night” scene");
    expect(all).toContain("Gokul ran the “Goodnight” routine");
    expect(all).toContain("Gokul switched to Night mode"); // the routine's own mode step
    expect(all).toContain("Gokul switched to Vacation mode");
    // alert
    const kettle = await thing(h.admin, "Kettle plug");
    await h.admin.call("PATCH", `/devices/${kettle.id}/settings`, { powerLimitW: 1500 });
    changeState(w.gw, "sensor.kettle_plug_power", "1400", { friendly_name: "Kettle plug Power", device_class: "power", unit_of_measurement: "W" });
    const alert = (await feed(h.admin)).items.find((i: any) => i.kind === "alert");
    expect(alert).toMatchObject({ tone: "warn", summary: "Kettle plug is at 93% of its 1,500 W limit" });
  });

  test("a routine that did not fully work says so", async () => {
    const normal = w.gw.onCallService!;
    w.gw.onCallService = (c) => { if (c.target?.entity_id === "light.floor_lamp") throw new Error("nope"); return normal(c); };
    const routine = (await h.admin.call("POST", "/routines", { name: "Try", steps: [{ type: "device", entityId: "light.floor_lamp", action: "turn_off" }] })).json;
    await h.admin.call("POST", `/routines/${routine.id}/execute`);
    await w.services.routines.finished((await h.admin.call("GET", "/routines/runs")).json.runs[0].id);
    expect((await feed(h.admin)).items[0]).toMatchObject({ kind: "routine", tone: "warn", summary: "ran the “Try” routine, but not everything worked" });
  });

  test("only linked people are announced arriving and leaving; the mode changed from Home Assistant has no actor", async () => {
    await h.admin.call("PUT", `/household/people/${(await h.admin.call("GET", "/users/me")).json.id}`, { personEntityId: "person.gokul" });
    changeState(w.gw, "person.gokul", "not_home");
    changeState(w.gw, "person.meera", "not_home"); // nobody has linked this one
    changeState(w.gw, "person.gokul", "home");
    expect((await texts(h.admin, "?kind=presence"))).toEqual(["Gokul got home", "Gokul left"]);
  });

  test("a door that moved by hand is logged once; one Alice moved is logged once, not twice", async () => {
    changeState(w.gw, "lock.front_door", "unlocked"); // someone turned the key
    expect((await feed(h.admin)).items[0]).toMatchObject({ kind: "lock", tone: "warn", summary: "Front door unlocked", actor: null });
    w.clock.now += 1000;
    await run(h.admin, "Front door", "lock");
    const lockEntries = (await texts(h.admin)).filter((x: string) => /Front door/.test(x));
    expect(lockEntries).toEqual(["Gokul locked Front door", "Front door unlocked"]);
  });

  test("an automation running in Home Assistant is logged by name", async () => {
    await h.withAdminToken(); await w.sync(); await h.admin.call("POST", "/ha/connection/resync"); await w.sync();
    const a = (await h.admin.call("POST", "/automations", { name: "Evening lights", definition: { version: 1, trigger: { type: "time", at: "18:00" }, conditions: [], actions: [{ type: "device", entityId: "light.floor_lamp", action: "turn_on" }] } })).json;
    await w.sync();
    const entity = (await h.admin.call("GET", `/automations/${a.id}`)).json.haAutomation.entityId;
    w.gw.emitEvent("automation_triggered", { entity_id: entity });
    w.gw.emitEvent("automation_triggered", { entity_id: "automation.not_ours" });
    expect(await texts(h.admin, "?kind=automation")).toEqual(["The “Evening lights” automation ran"]);
  });
});

describe("reading the timeline", () => {
  test("newest first, in pages that do not skip or repeat, filterable by kind", async () => {
    for (let i = 0; i < 9; i++) { await h.admin.call("PUT", "/household/mode", { mode: i % 2 ? "home" : "night" }); w.clock.now += 1000; }
    await run(h.admin, "Floor lamp", "turn_off");
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const r: any = await feed(h.admin, `?limit=4${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`);
      ids.push(...r.items.map((i: any) => i.id));
      cursor = r.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect((await texts(h.admin))[0]).toBe("Gokul turned off Floor lamp");
    expect((await texts(h.admin, "?kind=mode"))).toHaveLength(9);
    expect((await h.admin.call("GET", "/activity?limit=500")).status).toBe(422);
  });

  test("'new since your last visit' is per person and cleared by looking", async () => {
    const meera = await h.join("Meera", { role: "member" });
    await h.admin.call("PUT", "/household/mode", { mode: "night" }); w.clock.now += 1000;
    await run(h.admin, "Floor lamp", "turn_off");
    expect((await feed(meera)).newCount).toBe(2);
    expect((await feed(meera)).items.every((i: any) => i.new)).toBe(true);
    await meera.call("POST", "/activity/seen");
    w.clock.now += 1000;
    await h.admin.call("PUT", "/household/mode", { mode: "home" });
    const after = await feed(meera);
    expect(after.newCount).toBe(1);
    expect(after.items.map((i: any) => i.new)).toEqual([true, false, false]);
    expect((await feed(h.admin)).newCount).toBe(3); // Gokul never looked
  });

  test("guests have no timeline; entries about a device you cannot see are not shown to you", async () => {
    const meeraB = await h.join("Meera", { role: "member" });
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    expect((await lakshmi.call("GET", "/activity")).status).toBe(403);
    await run(h.admin, "Floor lamp", "turn_off");
    await run(h.admin, "Kettle plug", "turn_on");
    await h.admin.call("PUT", "/household/mode", { mode: "night" });
    const meeraId = (await meeraB.call("GET", "/users/me")).json.id;
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "light.floor_lamp", subjectType: "member", subjectId: meeraId, effect: "deny" });
    expect(await texts(meeraB)).toEqual(["Gokul switched to Night mode", "Gokul turned on Kettle plug"]);
    expect((await feed(meeraB)).newCount).toBe(2);
    expect(await texts(h.admin)).toHaveLength(3);
  });

  test("a device an admin hid from lists is hidden from other people's timeline, not the admin's", async () => {
    const meera = await h.join("Meera", { role: "member" });
    await run(h.admin, "Floor lamp", "turn_off");
    await h.admin.call("POST", `/devices/${(await thing(h.admin, "Floor lamp")).id}/hide`);
    expect(await texts(meera)).toEqual([]);
    expect(await texts(h.admin)).toEqual(["Gokul turned off Floor lamp"]);
  });

  test("a device's own history is only about it, and only for people who can see it", async () => {
    const meera = await h.join("Meera", { role: "member" });
    await run(h.admin, "Floor lamp", "turn_off");
    await run(h.admin, "Kettle plug", "turn_on");
    await h.admin.call("PUT", "/household/mode", { mode: "night" });
    const lamp = await thing(h.admin, "Floor lamp");
    expect((await h.admin.call("GET", `/devices/${lamp.id}/activity`)).json.items.map((i: any) => i.summary)).toEqual(["turned off Floor lamp"]);
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    expect((await lakshmi.call("GET", `/devices/${lamp.id}/activity`)).status).toBe(404);
    expect((await meera.call("GET", `/devices/${lamp.id}/activity`)).json.items).toHaveLength(1);
    expect((await h.admin.call("GET", "/devices/thing_nope/activity")).status).toBe(404);
  });

  test("entries older than 90 days are removed", async () => {
    await h.admin.call("PUT", "/household/mode", { mode: "night" });
    w.clock.now += 91 * 24 * 3_600_000;
    await h.admin.login();
    await h.admin.call("PUT", "/household/mode", { mode: "home" });
    expect(w.services.activity.prune()).toBe(1);
    expect((await feed(h.admin)).items).toHaveLength(1);
  });
});

describe("live over /ws", () => {
  test("new entries are pushed to followers, each only what they may see", async () => {
    const meeraB = await h.join("Meera", { role: "member" });
    const meeraId = (await meeraB.call("GET", "/users/me")).json.id;
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "light.floor_lamp", subjectType: "member", subjectId: meeraId, effect: "deny" });
    const admin = attach(h.admin, "activity"); const meera = attach(meeraB, "activity"); const nobody = attach(meeraB);
    await run(h.admin, "Floor lamp", "turn_off");
    await h.admin.call("PUT", "/household/mode", { mode: "night" });
    expect(admin.of("activity.created").map((m: any) => m.data.summary)).toEqual(["turned off Floor lamp", "switched to Night mode"]);
    expect(meera.of("activity.created").map((m: any) => m.data.summary)).toEqual(["switched to Night mode"]);
    expect(nobody.of("activity.created")).toHaveLength(0);
    expect(admin.of("activity.created")[0]).toMatchObject({ data: { actor: { name: "Gokul" }, kind: "device", new: true } });
  });
});
