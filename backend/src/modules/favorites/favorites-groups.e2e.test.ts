import { beforeEach, describe, expect, test } from "bun:test";
import { changeState, createWorld, homeWithHa, type World } from "../../testing/world";
import type { Browser } from "../../testing/http";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;

const devices = async (b: Browser, qs = "") => (await b.call("GET", `/devices${qs}`)).json.devices as any[];
const id = async (b: Browser, name: string) => (await devices(b)).find((d) => d.name === name).id as string;
const settle = (ids: string[]) => Promise.all(ids.map((i) => w.services.commands.done(i)));

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("favorites", () => {
  test("a person's favorites keep their order, flag the devices, and filter the list", async () => {
    const [kettle, lamp] = [await id(h.admin, "Kettle plug"), await id(h.admin, "Floor lamp")];
    const put = await h.admin.call("PUT", "/favorites", { thingIds: [kettle, lamp] });
    expect(put.json.devices.map((d: any) => d.name)).toEqual(["Kettle plug", "Floor lamp"]);
    expect((await h.admin.call("GET", "/favorites")).json.devices.map((d: any) => d.name)).toEqual(["Kettle plug", "Floor lamp"]);
    expect((await devices(h.admin, "?favorite=true")).map((d) => d.name)).toEqual(["Kettle plug", "Floor lamp"]);
    const all = await devices(h.admin);
    expect(all.find((d) => d.name === "Kettle plug").favorite).toBe(true);
    expect(all.find((d) => d.name === "Echo Show").favorite).toBe(false);
    await h.admin.call("PUT", "/favorites", { thingIds: [lamp, kettle] });
    expect((await h.admin.call("GET", "/favorites")).json.devices.map((d: any) => d.name)).toEqual(["Floor lamp", "Kettle plug"]);
    expect((await h.admin.call("PUT", "/favorites", { thingIds: [] })).json.devices).toEqual([]);
  });

  test("favorites are personal, only cover what you can see, and cap at 50", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const kettle = await id(h.admin, "Kettle plug");
    await h.admin.call("PUT", "/favorites", { thingIds: [kettle] });
    expect((await meera.call("GET", "/favorites")).json.devices).toEqual([]);
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    expect((await lakshmi.call("PUT", "/favorites", { thingIds: [kettle] })).status).toBe(404); // not visible to a guest
    expect((await h.admin.call("PUT", "/favorites", { thingIds: Array.from({ length: 51 }, (_, i) => `thing_${i}`) })).status).toBe(422);
    expect((await h.admin.call("PUT", "/favorites", { thingIds: ["thing_nope"] })).status).toBe(404);
  });

  test("favorites survive a resync and a merge, and a hidden device drops out of the list", async () => {
    const [kettle, door, lamp] = [await id(h.admin, "Kettle plug"), await id(h.admin, "Front door sensor"), await id(h.admin, "Floor lamp")];
    await h.admin.call("PUT", "/favorites", { thingIds: [door, lamp] });
    await h.admin.call("POST", "/ha/connection/resync");
    expect((await h.admin.call("GET", "/favorites")).json.devices).toHaveLength(2);
    await h.admin.call("POST", "/devices/merge", { ids: [kettle, door] }); // the door sensor is absorbed into the kettle Thing
    expect((await h.admin.call("GET", "/favorites")).json.devices.map((d: any) => d.name)).toEqual(["Kettle plug", "Floor lamp"]);
    await h.admin.call("POST", `/devices/${lamp}/hide`);
    expect((await h.admin.call("GET", "/favorites")).json.devices.map((d: any) => d.name)).toEqual(["Kettle plug"]);
  });
});

describe("groups", () => {
  async function lights() {
    const [lamp, ceiling] = [await id(h.admin, "Floor lamp"), await id(h.admin, "Ceiling lights")];
    const g = await h.admin.call("POST", "/groups", { name: "Living room lights", icon: "bulb", thingIds: [lamp, ceiling] });
    return { lamp, ceiling, group: g.json };
  }

  test("create, read, rename, change members, delete", async () => {
    const { lamp, ceiling, group } = await lights();
    expect(group).toMatchObject({ name: "Living room lights", icon: "bulb" });
    expect(group.devices.map((d: any) => d.name)).toEqual(["Floor lamp", "Ceiling lights"]);
    expect((await h.admin.call("GET", "/groups")).json.groups).toHaveLength(1);
    const kettle = await id(h.admin, "Kettle plug");
    const upd = await h.admin.call("PATCH", `/groups/${group.id}`, { name: "Lights and kettle", thingIds: [lamp, ceiling, kettle] });
    expect(upd.json.devices).toHaveLength(3);
    expect((await h.admin.call("PATCH", `/groups/${group.id}`, { name: "  " })).json.error.code).toBe("validation_error");
    expect((await h.admin.call("DELETE", `/groups/${group.id}`)).status).toBe(200);
    expect((await h.admin.call("GET", `/groups/${group.id}`)).status).toBe(404);
  });

  test("a group runs one operation on every device that supports it, as you; the rest are listed as skipped", async () => {
    const { lamp, ceiling, group } = await lights();
    const kettle = await id(h.admin, "Kettle plug");
    await h.admin.call("PATCH", `/groups/${group.id}`, { thingIds: [lamp, ceiling, kettle] });
    const res = await h.admin.call("POST", `/groups/${group.id}/commands`, { action: "turn_on" });
    expect(res.status).toBe(202);
    expect(res.json.commands.map((c: any) => c.entityId).sort()).toEqual(["light.ceiling_lights", "light.floor_lamp", "switch.kettle_plug"]);
    expect((await settle(res.json.commands.map((c: any) => c.id))).every((c) => c.state === "confirmed")).toBe(true);
    expect(res.json.commands[0]).not.toHaveProperty("haContextId");

    const dim = await h.admin.call("POST", `/groups/${group.id}/commands`, { action: "set_brightness", parameters: { brightness_pct: 40 } });
    expect(dim.json.commands).toHaveLength(2); // the kettle plug cannot dim
    expect(dim.json.skipped).toHaveLength(1);
    expect(dim.json.skipped[0].reason).toMatch(/Kettle plug cannot/);
    await settle(dim.json.commands.map((c: any) => c.id));

    expect((await h.admin.call("POST", `/groups/${group.id}/commands`, { action: "open" })).json.error.code).toBe("unsupported_operation");
  });

  test("a device is not limited to its main entity: the first entity that can do the operation is used", async () => {
    const echo = await id(h.admin, "Echo Show");
    const g = (await h.admin.call("POST", "/groups", { name: "Screens", thingIds: [echo] })).json;
    // The Echo's main entity is its media player; the microphone mute is a separate switch that supports turn_on/turn_off too,
    // so "turn_on" goes to the media player (first), and an operation only a control supports reaches that control.
    const on = await h.admin.call("POST", `/groups/${g.id}/commands`, { action: "turn_on" });
    expect(on.json.commands.map((c: any) => c.entityId)).toEqual(["media_player.echo_show"]);
    await settle(on.json.commands.map((c: any) => c.id));
    const all = await h.admin.call("POST", `/groups/${g.id}/commands`, { action: "turn_off", target: "all" });
    expect(all.json.commands.map((c: any) => c.entityId).sort()).toEqual(["media_player.echo_show", "switch.echo_show_microphone_mute"]);
    const vol = await h.admin.call("POST", `/groups/${g.id}/commands`, { action: "set_value", parameters: { value: 55 } });
    expect(vol.json.commands.map((c: any) => c.entityId)).toEqual(["number.echo_show_volume"]); // only a control can do this
    await settle([...all.json.commands, ...vol.json.commands].map((c: any) => c.id));
  });

  test("members can make groups; guests cannot, and they only see groups that hold something of theirs", async () => {
    const { lamp, group } = await lights();
    const meera = await h.join("Meera", { role: "member" });
    expect((await meera.call("POST", "/groups", { name: "Mine", thingIds: [lamp] })).status).toBe(200);
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    expect((await lakshmi.call("POST", "/groups", { name: "No", thingIds: [] })).status).toBe(403);
    expect((await lakshmi.call("GET", "/groups")).json.groups).toEqual([]);
    expect((await lakshmi.call("GET", `/groups/${group.id}`)).status).toBe(404);
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "light.floor_lamp", subjectType: "role", subjectId: "guest", effect: "allow" });
    const seen = (await lakshmi.call("GET", "/groups")).json.groups;
    expect(seen.map((g: any) => g.name).sort()).toEqual(["Living room lights", "Mine"]);
    expect(seen[0].devices.map((d: any) => d.name)).toEqual(["Floor lamp"]); // the ceiling lights are not theirs, so not listed
  });

  test("a guest acting on a group only touches what is theirs", async () => {
    const { group } = await lights();
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "light.floor_lamp", subjectType: "role", subjectId: "guest", effect: "allow" });
    const res = await lakshmi.call("POST", `/groups/${group.id}/commands`, { action: "turn_off" });
    expect(res.json.commands.map((c: any) => c.entityId)).toEqual(["light.floor_lamp"]);
    await settle(res.json.commands.map((c: any) => c.id));
    expect(w.gw.states.find((s) => s.entity_id === "light.ceiling_lights")!.state).toBe("off"); // untouched (it started off) and never targeted
    changeState(w.gw, "light.ceiling_lights", "on");
    await lakshmi.call("POST", `/groups/${group.id}/commands`, { action: "turn_off" });
    expect(w.gw.states.find((s) => s.entity_id === "light.ceiling_lights")!.state).toBe("on");
  });

  test("you cannot put a device you cannot see into a group", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const meeraId = (await meera.call("GET", "/users/me")).json.id;
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "light.floor_lamp", subjectType: "member", subjectId: meeraId, effect: "deny" });
    const lamp = await id(h.admin, "Floor lamp");
    expect((await meera.call("POST", "/groups", { name: "Sneaky", thingIds: [lamp] })).status).toBe(404);
  });

  test("sensitive operations in a group still need your passkey", async () => {
    const lock = await id(h.admin, "Front door");
    const g = (await h.admin.call("POST", "/groups", { name: "Doors", thingIds: [lock] })).json;
    w.clock.now += 6 * 60_000;
    const res = await h.admin.call("POST", `/groups/${g.id}/commands`, { action: "unlock" });
    const done = await settle(res.json.commands.map((c: any) => c.id));
    expect(done[0]!.failure!.code).toBe("step_up_required");
  });
});
