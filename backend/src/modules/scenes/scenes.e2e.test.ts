import { beforeEach, describe, expect, test } from "bun:test";
import { auditLog } from "@/core/database/schema";
import { changeState, createWorld, homeWithHa, type World } from "@/testing/world";
import type { Browser } from "@/testing/http";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;

const settle = (cmds: any[]) => Promise.all(cmds.map((c) => w.services.commands.done(c.id)));
const stateOf = (id: string) => w.gw.states.find((s) => s.entity_id === id)!.state;
const movie = {
  name: "Movie night",
  actions: [
    { entityId: "light.floor_lamp", action: "set_brightness", parameters: { brightness_pct: 15 } },
    { entityId: "light.ceiling_lights", action: "turn_off" },
    { entityId: "switch.kettle_plug", action: "turn_off" },
  ],
};

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("saving scenes", () => {
  test("a member saves a scene; it reads back with its actions", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const res = await meera.call("POST", "/scenes", { ...movie, icon: "play", description: "Dim the room" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ name: "Movie night", icon: "play", description: "Dim the room", lastRunAt: null });
    expect(res.json.actions).toHaveLength(3);
    expect((await h.admin.call("GET", "/scenes")).json.scenes.map((s: any) => s.name)).toEqual(["Movie night"]);
  });

  test("every action is checked when saving: real, visible, supported, well-formed", async () => {
    const post = (actions: any[], who: Browser = h.admin) => who.call("POST", "/scenes", { name: "X", actions });
    expect((await post([{ entityId: "light.nope", action: "turn_on" }])).json.error.code).toBe("unknown_entity");
    expect((await post([{ entityId: "switch.kettle_plug", action: "set_brightness", parameters: { brightness_pct: 50 } }])).json.error.code).toBe("unsupported_operation");
    expect((await post([{ entityId: "light.floor_lamp", action: "set_brightness", parameters: { brightness_pct: 500 } }])).json.error.code).toBe("invalid_parameters");
    expect((await post([])).status).toBe(422);
    expect((await h.admin.call("POST", "/scenes", { name: "  ", actions: movie.actions })).json.error.code).toBe("validation_error");
    const meera = await h.join("Meera", { role: "member" });
    const meeraId = (await meera.call("GET", "/users/me")).json.id;
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "light.floor_lamp", subjectType: "member", subjectId: meeraId, effect: "deny" });
    expect((await post([{ entityId: "light.floor_lamp", action: "turn_on" }], meera)).json.error.code).toBe("unknown_entity"); // blocked for her, so it does not exist
  });

  test("a scene that unlocks a door needs a fresh passkey to save", async () => {
    const body = { name: "Open up", actions: [{ entityId: "lock.front_door", action: "unlock" }] };
    expect((await h.admin.call("POST", "/scenes", body)).status).toBe(200); // just signed in, so stepped up
    w.clock.now += 6 * 60_000;
    expect((await h.admin.call("POST", "/scenes", body)).json.error.code).toBe("step_up_required");
  });

  test("guests cannot save scenes; admins and members can edit and delete", async () => {
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    expect((await lakshmi.call("POST", "/scenes", movie)).status).toBe(403);
    const s = (await h.admin.call("POST", "/scenes", movie)).json;
    const upd = await h.admin.call("PATCH", `/scenes/${s.id}`, { name: "Cinema", actions: [{ entityId: "light.ceiling_lights", action: "turn_off" }] });
    expect(upd.json).toMatchObject({ name: "Cinema" });
    expect(upd.json.actions).toHaveLength(1);
    expect((await lakshmi.call("DELETE", `/scenes/${s.id}`)).status).toBe(403);
    expect((await h.admin.call("DELETE", `/scenes/${s.id}`)).status).toBe(200);
    expect((await h.admin.call("GET", `/scenes/${s.id}`)).status).toBe(404);
  });
});

describe("activating scenes", () => {
  test("starts every action at once, returns 202, and every command confirms", async () => {
    const s = (await h.admin.call("POST", "/scenes", movie)).json;
    const res = await h.admin.call("POST", `/scenes/${s.id}/activate`);
    expect(res.status).toBe(202);
    expect(res.json.commands).toHaveLength(3);
    expect(res.json.skipped).toEqual([]);
    expect((await settle(res.json.commands)).map((c) => c.state)).toEqual(["confirmed", "confirmed", "confirmed"]);
    expect(stateOf("light.floor_lamp")).toBe("on");
    expect(stateOf("switch.kettle_plug")).toBe("off");
    expect((await h.admin.call("GET", `/scenes/${s.id}`)).json.lastRunAt).toBe(w.clock.now);
  });

  test("a device that has since disappeared is skipped, the rest still run", async () => {
    const s = (await h.admin.call("POST", "/scenes", movie)).json;
    w.gw.states = w.gw.states.filter((x) => x.entity_id !== "switch.kettle_plug");
    await h.admin.call("POST", "/ha/connection/resync");
    const res = await h.admin.call("POST", `/scenes/${s.id}/activate`);
    expect(res.json.commands).toHaveLength(2);
    expect(res.json.skipped).toEqual([{ action: { entityId: "switch.kettle_plug", action: "turn_off" }, reason: "That device no longer exists" }]);
    await settle(res.json.commands);
  });

  test("a scene runs as whoever activates it: a guest only moves what is theirs, and does not see the rest", async () => {
    const s = (await h.admin.call("POST", "/scenes", movie)).json;
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    expect((await lakshmi.call("GET", "/scenes")).json.scenes).toEqual([]);
    expect((await lakshmi.call("POST", `/scenes/${s.id}/activate`)).status).toBe(404); // nothing in it is theirs
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "light.floor_lamp", subjectType: "role", subjectId: "guest", effect: "allow" });
    changeState(w.gw, "light.ceiling_lights", "on");
    const list = (await lakshmi.call("GET", "/scenes")).json.scenes;
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("actions"); // they learn the scene exists, not what is in it
    const res = await lakshmi.call("POST", `/scenes/${s.id}/activate`);
    expect(res.status).toBe(202);
    expect(res.json.commands.map((c: any) => c.entityId)).toEqual(["light.floor_lamp"]);
    expect(res.json.skipped.map((x: any) => x.reason)).toEqual(["Not available to you", "Not available to you"]);
    await settle(res.json.commands);
    expect(stateOf("light.ceiling_lights")).toBe("on"); // the scene wanted it off, but it is not the guest's to switch
  });

  test("sensitive actions in a scene need the activator's passkey, even if the author had one", async () => {
    const s = (await h.admin.call("POST", "/scenes", { name: "Open up", actions: [{ entityId: "lock.front_door", action: "unlock" }] })).json;
    const meera = await h.join("Meera", { role: "member" });
    w.clock.now += 6 * 60_000;
    const res = await meera.call("POST", `/scenes/${s.id}/activate`);
    const [cmd] = await settle(res.json.commands);
    expect(cmd!.failure!.code).toBe("step_up_required");
    expect(stateOf("lock.front_door")).toBe("locked");
  });

  test("saving and activating are audited", async () => {
    const s = (await h.admin.call("POST", "/scenes", movie)).json;
    await settle((await h.admin.call("POST", `/scenes/${s.id}/activate`)).json.commands);
    const actions = w.db.select().from(auditLog).all().map((a) => a.action);
    expect(actions).toContain("scenes.created");
    expect(actions).toContain("scenes.activated");
    expect((await h.admin.call("GET", "/scenes/scn_nope")).status).toBe(404);
  });
});
