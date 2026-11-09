import { beforeEach, describe, expect, test } from "bun:test";
import type { Browser } from "../../testing/http";
import { changeState, createWorld, homeWithHa, type World } from "../../testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;

const arrive = (over: object = {}) => ({
  version: 1, trigger: { type: "arrive", person: "anyone" }, conditions: [{ type: "dark" }],
  actions: [{ type: "device", entityId: "light.ceiling_lights", action: "turn_on" }, { type: "device", entityId: "light.floor_lamp", action: "set_brightness", parameters: { brightness_pct: 70 } }],
  ...over,
});
const create = (body: object = {}, who = h.admin) => who.call("POST", "/automations", { name: "Lights on when I get home", definition: arrive(), ...body });
/** Admin token stored and Home Assistant following the household mode. */
async function ready() {
  await h.withAdminToken();
  await w.sync();
  await h.admin.call("POST", "/ha/connection/resync");
  await w.sync();
}
const kettleId = async () => (await h.admin.call("GET", "/devices")).json.devices.find((d: any) => d.name === "Kettle plug").id as string;

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("saving automations", () => {
  test("without an admin token it is saved and explained, and goes to Home Assistant once a token is added", async () => {
    const res = await create();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ name: "Lights on when I get home", enabled: true, summary: "When someone gets home, if it is dark, turn on Ceiling lights and set Floor lamp to 70%." });
    expect(res.json.haAutomation).toMatchObject({ status: "not_synced", error: expect.stringMatching(/admin token/) });
    await ready();
    const got = (await h.admin.call("GET", `/automations/${res.json.id}`)).json;
    expect(got.haAutomation).toMatchObject({ status: "synced", entityId: expect.stringMatching(/^automation\.alice_auto_/) });
    const cfg = [...w.configApi.automations.values()][0]!;
    expect(cfg.alias).toBe("Alice: Lights on when I get home");
    expect(cfg.trigger).toEqual([{ platform: "state", entity_id: ["person.gokul", "person.meera"], to: "home" }]);
    expect(cfg.condition).toEqual([{ condition: "state", entity_id: "sun.sun", state: "below_horizon" }]);
    expect(cfg.action).toHaveLength(2);
  });

  test("it is checked: shape, devices you can see, people, sensors, power limits, modes, notified users", async () => {
    await ready();
    const code = async (def: object) => (await create({ definition: def })).json.error?.code;
    expect(await code({ version: 1 })).toBe("validation_error");
    expect(await code(arrive({ actions: [{ type: "device", entityId: "light.nope", action: "turn_on" }] }))).toBe("unknown_entity");
    expect(await code(arrive({ actions: [{ type: "device", entityId: "switch.kettle_plug", action: "set_brightness", parameters: { brightness_pct: 5 } }] }))).toBe("unsupported_operation");
    expect(await code(arrive({ trigger: { type: "arrive", person: "person.stranger" } }))).toBe("unknown_entity");
    expect(await code(arrive({ trigger: { type: "door_opens", entityId: "light.floor_lamp" } }))).toBe("validation_error");
    expect(await code(arrive({ trigger: { type: "door_opens", entityId: "binary_sensor.nope" } }))).toBe("unknown_entity");
    expect(await code(arrive({ trigger: { type: "power_over_limit", entityId: "switch.kettle_plug" } }))).toBe("no_power_limit");
    expect(await code(arrive({ actions: [{ type: "scene", sceneId: "scn_nope" }] }))).toBe("not_found");
    expect(await code(arrive({ actions: [{ type: "notify", message: "x", userIds: ["usr_stranger"] }] }))).toBe("validation_error");
    expect((await create({ name: "  " })).json.error.code).toBe("validation_error");
  });

  test("a mode condition or action needs Home Assistant to be following the household mode", async () => {
    await h.withAdminToken(); // helper not created yet
    expect((await create({ definition: arrive({ conditions: [{ type: "mode", mode: "home" }] }) })).json.error.code).toBe("mode_not_mirrored");
    await w.sync(); await h.admin.call("POST", "/ha/connection/resync");
    const ok = await create({ definition: arrive({ conditions: [{ type: "mode", mode: "home" }], actions: [{ type: "mode", mode: "night" }] }) });
    expect(ok.status).toBe(200);
    expect(ok.json.summary).toBe("When someone gets home, if the mode is Home, switch to Night mode.");
    await w.sync();
    expect([...w.configApi.automations.values()][0]!.condition).toEqual([{ condition: "state", entity_id: "input_select.alice_household_mode", state: "home" }]);
  });

  test("a sensitive action needs a fresh passkey to save, since it will run with nobody there to confirm", async () => {
    const def = arrive({ trigger: { type: "time", at: "22:30" }, actions: [{ type: "device", entityId: "lock.front_door", action: "unlock" }] });
    expect((await create({ definition: def })).status).toBe(200);
    w.clock.now += 6 * 60_000;
    expect((await create({ definition: def })).json.error.code).toBe("step_up_required");
  });

  test("guests cannot see or save automations; members can", async () => {
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    expect((await lakshmi.call("GET", "/automations")).status).toBe(403);
    expect((await create({}, lakshmi)).status).toBe(403);
    const meera = await h.join("Meera", { role: "member" });
    expect((await create({}, meera)).status).toBe(200);
  });
});

describe("running in Home Assistant", () => {
  test("scenes and routines an automation calls are put in Home Assistant first", async () => {
    await ready();
    const scene = (await h.admin.call("POST", "/scenes", { name: "Movie", actions: [{ entityId: "light.floor_lamp", action: "turn_off" }] })).json;
    await w.sync();
    const { scenes } = await import("../../core/database/schema");
    w.db.update(scenes).set({ syncStatus: "failed" }).run();
    w.configApi.calls.length = 0;
    await create({ definition: arrive({ actions: [{ type: "scene", sceneId: scene.id }] }) });
    await w.sync();
    expect(w.configApi.calls.filter((c) => /^put/.test(c)).map((c) => c.split(":")[0])).toEqual(["putScript", "putAutomation"]);
    expect([...w.configApi.automations.values()][0]!.action).toEqual([{ service: expect.stringMatching(/^script\.alice_scene_/), continue_on_error: true }]);
  });

  test("enable and disable are applied to Home Assistant; delete removes it", async () => {
    await ready();
    const a = (await create({})).json;
    await w.sync();
    const entity = [...w.configApi.enabled.keys()][0]!;
    expect(w.configApi.enabled.get(entity)).toBe(true);
    expect((await h.admin.call("POST", `/automations/${a.id}/disable`)).json.enabled).toBe(false);
    await w.sync();
    expect(w.configApi.enabled.get(entity)).toBe(false);
    await h.admin.call("POST", `/automations/${a.id}/enable`);
    await w.sync();
    expect(w.configApi.enabled.get(entity)).toBe(true);
    expect((await h.admin.call("DELETE", `/automations/${a.id}`)).status).toBe(200);
    await w.sync();
    expect(w.configApi.automations.size).toBe(0);
    expect((await h.admin.call("GET", `/automations/${a.id}`)).status).toBe(404);
  });

  test("editing recompiles it", async () => {
    await ready();
    const a = (await create({})).json;
    await w.sync();
    const upd = await h.admin.call("PATCH", `/automations/${a.id}`, { name: "Evening lights", definition: arrive({ trigger: { type: "sunset", offsetMinutes: -30 }, conditions: [] }) });
    expect(upd.json.summary).toBe("When 30 minutes before the sun sets, turn on Ceiling lights and set Floor lamp to 70%.");
    await w.sync();
    const cfg = [...w.configApi.automations.values()][0]!;
    expect(cfg.alias).toBe("Alice: Evening lights");
    expect(cfg.trigger).toEqual([{ platform: "sun", event: "sunset", offset: "-00:30:00" }]);
  });

  test("a power trigger follows the device's power limit", async () => {
    await ready();
    const id = await kettleId();
    await h.admin.call("PATCH", `/devices/${id}/settings`, { powerLimitW: 1500 });
    await create({ name: "Guard", definition: { version: 1, trigger: { type: "power_over_limit", entityId: "switch.kettle_plug" }, conditions: [], actions: [{ type: "device", entityId: "switch.kettle_plug", action: "turn_off" }, { type: "notify", message: "Kettle was left on" }] } });
    await w.sync();
    expect([...w.configApi.automations.values()][0]!.trigger).toEqual([{ platform: "numeric_state", entity_id: "sensor.kettle_plug_power", above: 1350 }]);
    await h.admin.call("PATCH", `/devices/${id}/settings`, { powerLimitW: 2000 });
    await w.sync();
    expect([...w.configApi.automations.values()][0]!.trigger).toEqual([{ platform: "numeric_state", entity_id: "sensor.kettle_plug_power", above: 1800 }]);
  });

  test("when Home Assistant runs it the run is recorded; other automations are ignored", async () => {
    await ready();
    const a = (await create({})).json;
    await w.sync();
    const entityId = (await h.admin.call("GET", `/automations/${a.id}`)).json.haAutomation.entityId;
    w.clock.now += 5000;
    w.gw.emitEvent("automation_triggered", { entity_id: entityId, source: "state of person.meera" });
    w.gw.emitEvent("automation_triggered", { entity_id: "automation.someone_elses" });
    const runs = (await h.admin.call("GET", `/automations/${a.id}/runs`)).json.runs;
    expect(runs).toEqual([{ id: expect.any(String), triggeredAt: w.clock.now, source: "state of person.meera" }]);
    expect((await h.admin.call("GET", `/automations/${a.id}`)).json.lastTriggeredAt).toBe(w.clock.now);
  });

  test("a failure shows its reason and a resync retries it", async () => {
    await ready();
    const { httpError } = await import("../../testing/fake-config-api");
    w.configApi.failWith = httpError(400);
    const a = (await create({})).json;
    await w.sync();
    expect((await h.admin.call("GET", `/automations/${a.id}`)).json.haAutomation).toMatchObject({ status: "failed", error: "HA said 400" });
    w.configApi.failWith = null;
    await h.admin.call("POST", "/admin/config-sync/resync");
    await w.sync();
    expect((await h.admin.call("GET", `/automations/${a.id}`)).json.haAutomation.status).toBe("synced");
  });

  test("with nobody set up in Home Assistant an automation about arriving is refused up front", async () => {
    await ready();
    w.gw.states = w.gw.states.filter((s) => !s.entity_id.startsWith("person."));
    await h.admin.call("POST", "/ha/connection/resync");
    expect((await create({})).json.error.code).toBe("no_people");
  });
});

describe("previewing", () => {
  test("shows the sentence, what Home Assistant would get, and warnings, and saves nothing", async () => {
    const r = await h.admin.call("POST", "/automations/preview", { name: "Try", definition: arrive() });
    expect(r.status).toBe(200);
    expect(r.json.summary).toBe("When someone gets home, if it is dark, turn on Ceiling lights and set Floor lamp to 70%.");
    expect(r.json.haConfig.alias).toBe("Alice: Try");
    expect(r.json.warnings).toEqual([expect.stringMatching(/admin token/)]);
    expect((await h.admin.call("GET", "/automations")).json.automations).toEqual([]);
    await ready();
    expect((await h.admin.call("POST", "/automations/preview", { definition: arrive() })).json.warnings).toEqual([]);
    expect((await h.admin.call("POST", "/automations/preview", { definition: { version: 1 } })).status).toBe(400);
  });

  test("a saved automation can be tested the same way", async () => {
    const a = (await create({})).json;
    const t = await h.admin.call("POST", `/automations/${a.id}/test`);
    expect(t.json.summary).toBe(a.summary);
    expect(t.json.haConfig.trigger[0].to).toBe("home");
  });
});

describe("notifications from automations", () => {
  test("a notify action reaches the household's inbox through Home Assistant", async () => {
    await ready();
    await create({ definition: arrive({ actions: [{ type: "notify", title: "Welcome", message: "Someone got home" }] }) });
    await w.sync();
    const action = [...w.configApi.automations.values()][0]!.action[0] as { event: string; event_data: Record<string, unknown> };
    w.gw.emitEvent(action.event, action.event_data); // Home Assistant fires exactly what we gave it
    const inbox = (await h.admin.call("GET", "/notifications")).json.notifications;
    expect(inbox[0]).toMatchObject({ kind: "automation", title: "Welcome", body: "Someone got home" });
  });
});

describe("tied to the household's people", () => {
  const idOf = async (b: Browser) => (await b.call("GET", "/users/me")).json.id as string;
  const link = (userId: string, person: string) => h.admin.call("PUT", `/household/people/${userId}`, { personEntityId: person });

  test("'when Meera gets home' follows whichever person she is linked to", async () => {
    await ready();
    const meera = await h.join("Meera", { role: "member" });
    const def = arrive({ trigger: { type: "arrive", userId: await idOf(meera) }, conditions: [] });
    expect((await create({ definition: def })).json.error.code).toBe("person_not_linked");
    await link(await idOf(meera), "person.meera");
    const a = await create({ definition: def });
    expect(a.json.summary).toBe("When Meera gets home, turn on Ceiling lights and set Floor lamp to 70%.");
    await w.sync();
    expect([...w.configApi.automations.values()][0]!.trigger).toEqual([{ platform: "state", entity_id: ["person.meera"], to: "home" }]);
    await link(await idOf(meera), "person.gokul"); // she is now tracked by another person entity
    await w.sync();
    expect([...w.configApi.automations.values()][0]!.trigger).toEqual([{ platform: "state", entity_id: ["person.gokul"], to: "home" }]);
    expect((await create({ definition: arrive({ trigger: { type: "arrive", userId: "usr_stranger" } }) })).json.error.code).toBe("not_found");
  });

  test("'someone gets home' picks up a new person without anyone re-saving it", async () => {
    await ready();
    await create({});
    await w.sync();
    expect((([...w.configApi.automations.values()][0]!.trigger[0]) as { entity_id: string[] }).entity_id).toEqual(["person.gokul", "person.meera"]);
    const { state } = await import("../home-assistant/testing");
    w.gw.states = [...w.gw.states, state("person.arjun", "home", { friendly_name: "Arjun" })];
    await h.admin.call("POST", "/ha/connection/resync"); // Home Assistant now has a third person
    await w.sync();
    expect((([...w.configApi.automations.values()][0]!.trigger[0]) as { entity_id: string[] }).entity_id).toEqual(["person.gokul", "person.meera", "person.arjun"]);
  });

  test("once people are linked, 'someone' means linked household members, and unrelated changes resend nothing", async () => {
    await ready();
    await create({});
    await w.sync();
    await link(await idOf(h.admin), "person.gokul");
    await w.sync();
    expect((([...w.configApi.automations.values()][0]!.trigger[0]) as { entity_id: string[] }).entity_id).toEqual(["person.gokul"]);
    w.configApi.calls.length = 0;
    await h.admin.call("POST", "/ha/connection/resync"); // nothing about the automation changed
    await w.sync();
    expect(w.configApi.calls.filter((c) => c.startsWith("putAutomation"))).toEqual([]);
  });
});

describe("sensitive actions run without anyone to confirm them", () => {
  const unlock = { version: 1, trigger: { type: "time", at: "22:30" }, conditions: [], actions: [{ type: "device", entityId: "lock.front_door", action: "unlock" }] };

  test("only an admin can save one, the view says what is sensitive, and admins (not members) are told each time it runs", async () => {
    await ready();
    const meera = await h.join("Meera", { role: "member" });
    expect((await create({ definition: unlock }, meera)).json.error.code).toBe("forbidden");
    const a = await create({ name: "Open up", definition: unlock });
    expect(a.status).toBe(200);
    expect(a.json.sensitiveActions).toEqual(["unlock Front door"]);
    await w.sync();
    const entityId = (await h.admin.call("GET", `/automations/${a.json.id}`)).json.haAutomation.entityId;
    w.gw.emitEvent("automation_triggered", { entity_id: entityId });
    await Bun.sleep(20);
    const adminInbox = (await h.admin.call("GET", "/notifications")).json.notifications;
    expect(adminInbox[0]).toMatchObject({ kind: "sensitive_automation", title: "“Open up” ran", body: "It ran automatically and did this: unlock Front door." });
    expect((await meera.call("GET", "/notifications")).json.notifications).toEqual([]);
    expect((await h.admin.call("GET", "/automations")).json.automations[0].sensitiveActions).toEqual(["unlock Front door"]);
  });

  test("an ordinary automation says nothing special; a rule change shows up on automations that already exist", async () => {
    await ready();
    const a = await create({});
    expect(a.json.sensitiveActions).toEqual([]);
    await h.admin.call("PUT", "/admin/security/sensitive-operations", { rules: [{ domain: "light", action: "turn_on", sensitive: true }] });
    expect((await h.admin.call("GET", `/automations/${a.json.id}`)).json.sensitiveActions).toEqual(["turn on Ceiling lights"]);
  });

  test("a member can still save and edit automations that are not sensitive", async () => {
    const meera = await h.join("Meera", { role: "member" });
    expect((await create({}, meera)).status).toBe(200);
  });
});

