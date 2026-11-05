import { beforeEach, describe, expect, test } from "bun:test";
import { createWorld, homeWithHa, type World } from "@/testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;

const verify = async () => { await h.admin.call("POST", "/admin/config-sync/verify"); await w.sync(); };
const sceneBody = { name: "Movie", actions: [{ entityId: "light.floor_lamp", action: "set_brightness", parameters: { brightness_pct: 15 } }, { entityId: "switch.kettle_plug", action: "turn_off" }] };
const sceneStatus = async (id: string) => (await h.admin.call("GET", `/scenes/${id}`)).json.haScript;
const automation = { version: 1, trigger: { type: "arrive", person: "anyone" }, conditions: [{ type: "dark" }], actions: [{ type: "device", entityId: "light.ceiling_lights", action: "turn_on" }] };
const inbox = async () => (await h.admin.call("GET", "/notifications")).json.notifications as any[];

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
  await h.withAdminToken();
  await w.sync();
  await h.admin.call("POST", "/ha/connection/resync");
  await w.sync();
});

describe("noticing changes made in Home Assistant", () => {
  test("things nobody touched are not reported, even though Home Assistant rewrites them", async () => {
    const s = (await h.admin.call("POST", "/scenes", sceneBody)).json;
    const r = (await h.admin.call("POST", "/routines", { name: "R", steps: [{ type: "scene", sceneId: s.id }, { type: "delay", seconds: 5 }, { type: "mode", mode: "night" }] })).json;
    const a = (await h.admin.call("POST", "/automations", { name: "A", definition: automation })).json;
    await w.sync();
    await verify();
    expect((await sceneStatus(s.id)).status).toBe("synced");
    expect((await h.admin.call("GET", `/routines/${r.id}`)).json.haScript.status).toBe("synced");
    expect((await h.admin.call("GET", `/automations/${a.id}`)).json.haAutomation.status).toBe("synced");
    expect((await h.admin.call("GET", "/admin/config-sync")).json.drifted).toBe(0);
    expect(await inbox()).toEqual([]);
  });

  test("an edited script is marked drifted, admins are told once, and a resync puts it back", async () => {
    const s = (await h.admin.call("POST", "/scenes", sceneBody)).json;
    await w.sync();
    const [objectId] = [...w.configApi.scripts.keys()];
    (w.configApi.scripts.get(objectId!)!.sequence[0] as any).parallel[0].data.brightness_pct = 90; // someone edited it in Home Assistant
    await verify();
    expect(await sceneStatus(s.id)).toMatchObject({ status: "drifted", error: "It was changed in Home Assistant" });
    expect((await h.admin.call("GET", "/admin/config-sync")).json.drifted).toBe(1);
    expect((await inbox())[0]).toMatchObject({ kind: "config_drift", title: "Changed in Home Assistant", body: expect.stringContaining("“Movie” was edited or removed") });
    await verify(); // still drifted: no second notification
    expect((await inbox()).filter((n) => n.kind === "config_drift")).toHaveLength(1);
    expect((await h.admin.call("POST", "/admin/config-sync/resync")).json.queued).toBeGreaterThan(0);
    await w.sync();
    expect((await sceneStatus(s.id)).status).toBe("synced");
    expect((w.configApi.scripts.get(objectId!)!.sequence[0] as any).parallel[0].data.brightness_pct).toBe(15);
    await verify();
    expect((await sceneStatus(s.id)).status).toBe("synced");
  });

  test("removed from Home Assistant, and fixed by hand there: both are noticed", async () => {
    const s = (await h.admin.call("POST", "/scenes", sceneBody)).json;
    await w.sync();
    const [objectId] = [...w.configApi.scripts.keys()];
    const original = structuredClone(w.configApi.scripts.get(objectId!)!);
    w.configApi.scripts.delete(objectId!);
    await verify();
    expect(await sceneStatus(s.id)).toMatchObject({ status: "drifted", error: "It was removed from Home Assistant" });
    w.configApi.scripts.set(objectId!, original); // someone restores it themselves
    await verify();
    expect(await sceneStatus(s.id)).toMatchObject({ status: "synced", error: null });
  });

  test("an automation edited, removed or switched off in Home Assistant is noticed", async () => {
    const a = (await h.admin.call("POST", "/automations", { name: "Evening", definition: automation })).json;
    await w.sync();
    const status = async () => (await h.admin.call("GET", `/automations/${a.id}`)).json.haAutomation;
    const [id] = [...w.configApi.automations.keys()];
    w.configApi.enabled.set(`automation.${id}`, false);
    await verify();
    expect(await status()).toMatchObject({ status: "drifted", error: "It was switched on or off in Home Assistant" });
    await h.admin.call("POST", "/admin/config-sync/resync"); await w.sync();
    expect((await status()).status).toBe("synced");
    expect(w.configApi.enabled.get(`automation.${id}`)).toBe(true);
    (w.configApi.automations.get(id!)!.action[0] as any).target.entity_id = "light.somewhere_else";
    await verify();
    expect((await status()).error).toBe("It was changed in Home Assistant");
    await h.admin.call("POST", "/admin/config-sync/resync"); await w.sync();
    w.configApi.automations.delete(id!);
    await verify();
    expect((await status()).error).toBe("It was removed from Home Assistant");
    expect((await inbox()).filter((n) => n.kind === "config_drift")).toHaveLength(3);
  });

  test("items that are not in Home Assistant yet are not checked; with nothing to check nothing is queued", async () => {
    expect((await h.admin.call("POST", "/admin/config-sync/verify")).json.queued).toBe(false);
    w.configApi.failWith = new Error("down");
    await h.admin.call("POST", "/scenes", sceneBody);
    expect((await h.admin.call("POST", "/admin/config-sync/verify")).json.queued).toBe(false); // the scene is pending, not synced
  });

  test("a failed check says nothing about the items, and only admins can ask for one", async () => {
    const s = (await h.admin.call("POST", "/scenes", sceneBody)).json;
    await w.sync();
    const meera = await h.join("Meera", { role: "member" });
    expect((await meera.call("POST", "/admin/config-sync/verify")).status).toBe(403);
    w.configApi.failWith = new Error("HA is restarting");
    await verify();
    expect((await sceneStatus(s.id)).status).toBe("synced");
  });

  test("the periodic check covers every household with a connection", async () => {
    const s = (await h.admin.call("POST", "/scenes", sceneBody)).json;
    await w.sync();
    w.configApi.scripts.clear();
    w.services.sync.verifyAll();
    await w.sync();
    expect((await sceneStatus(s.id)).status).toBe("drifted");
  });
});
