import { beforeEach, describe, expect, test } from "bun:test";
import { httpError } from "../../testing/fake-config-api";
import { createWorld, homeWithHa, type World } from "../../testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;

const scene = (name = "Movie night") => ({ name, actions: [{ entityId: "light.floor_lamp", action: "set_brightness", parameters: { brightness_pct: 15 } }, { entityId: "switch.kettle_plug", action: "turn_off" }] });
const scripts = () => [...w.configApi.scripts.keys()];

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("scenes and routines also live in Home Assistant", () => {
  test("without an admin token the scene still works in Alice and says what is missing; nothing is queued", async () => {
    const res = await h.admin.call("POST", "/scenes", scene());
    expect(res.json.haScript).toMatchObject({ status: "not_synced", error: expect.stringMatching(/admin token/) });
    expect(w.services.configJobs.status(w.db.select().from((await import("../../core/database/schema")).households).get()!.id).pendingJobs).toBe(0);
    const act = await h.admin.call("POST", `/scenes/${res.json.id}/activate`);
    expect(act.status).toBe(202); // Alice's own runner still works
    await Promise.all(act.json.commands.map((c: any) => w.services.commands.done(c.id)));
  });

  test("with an admin token a new scene is queued, written to Home Assistant as a script, and marked synced", async () => {
    await h.withAdminToken();
    const res = await h.admin.call("POST", "/scenes", scene());
    expect(res.json.haScript.status).toBe("pending");
    await w.sync();
    const got = (await h.admin.call("GET", `/scenes/${res.json.id}`)).json;
    expect(got.haScript).toMatchObject({ status: "synced", error: null, entityId: expect.stringMatching(/^script\.alice_scene_/), syncedAt: expect.any(Number) });
    const [objectId] = scripts();
    const cfg = w.configApi.scripts.get(objectId!)!;
    expect(cfg.alias).toBe("Alice scene: Movie night");
    expect((cfg.sequence[0] as { parallel: unknown[] }).parallel).toEqual([
      { service: "light.turn_on", target: { entity_id: "light.floor_lamp" }, data: { brightness_pct: 15 }, continue_on_error: true },
      { service: "switch.turn_off", target: { entity_id: "switch.kettle_plug" }, continue_on_error: true },
    ]);
    expect(w.configApi.reloads).toEqual(["script"]);
  });

  test("editing a scene replaces the script; deleting it removes the script", async () => {
    await h.withAdminToken();
    const s = (await h.admin.call("POST", "/scenes", scene())).json;
    await w.sync();
    await h.admin.call("PATCH", `/scenes/${s.id}`, { name: "Cinema", actions: [{ entityId: "light.ceiling_lights", action: "turn_off" }] });
    await w.sync();
    expect(scripts()).toHaveLength(1);
    expect(w.configApi.scripts.get(scripts()[0]!)!.alias).toBe("Alice scene: Cinema");
    await h.admin.call("DELETE", `/scenes/${s.id}`);
    await w.sync();
    expect(scripts()).toEqual([]);
  });

  test("a routine becomes a script too, and the scenes it uses are put in Home Assistant first", async () => {
    await h.withAdminToken();
    const s = (await h.admin.call("POST", "/scenes", scene())).json;
    await w.sync();
    const { scenes } = await import("../../core/database/schema");
    w.db.update(scenes).set({ syncStatus: "failed" }).run(); // pretend the scene's last attempt failed
    w.configApi.calls.length = 0;
    const r = (await h.admin.call("POST", "/routines", { name: "Goodnight", steps: [{ type: "scene", sceneId: s.id }, { type: "delay", seconds: 30 }, { type: "device", entityId: "light.floor_lamp", action: "turn_off" }, { type: "mode", mode: "night" }] })).json;
    expect(r.haScript.status).toBe("pending");
    await w.sync();
    expect(w.configApi.calls.filter((c) => c.startsWith("putScript")).map((c) => c.split(":")[1]!.split("_")[1])).toEqual(["scene", "routine"]); // scene first
    const routineScript = w.configApi.scripts.get(scripts().find((x) => x.startsWith("alice_routine_"))!)!;
    expect(routineScript.sequence.map((x) => ("service" in x ? x.service : Object.keys(x)[0]))).toEqual([expect.stringMatching(/^script\.alice_scene_/), "delay", "light.turn_off", "input_select.select_option"]);
    expect((await h.admin.call("GET", `/routines/${r.id}`)).json.haScript.status).toBe("synced");
    expect((await h.admin.call("GET", `/scenes/${s.id}`)).json.haScript.status).toBe("synced");
  });

  test("adding the admin token later sends everything that was waiting", async () => {
    const s = (await h.admin.call("POST", "/scenes", scene())).json;
    const r = (await h.admin.call("POST", "/routines", { name: "R", steps: [{ type: "device", entityId: "light.floor_lamp", action: "turn_off" }] })).json;
    expect(s.haScript.status).toBe("not_synced");
    await h.withAdminToken();
    await w.sync();
    expect((await h.admin.call("GET", `/scenes/${s.id}`)).json.haScript.status).toBe("synced");
    expect((await h.admin.call("GET", `/routines/${r.id}`)).json.haScript.status).toBe("synced");
    expect(scripts()).toHaveLength(2);
  });

  test("a failure is shown with its reason and can be retried", async () => {
    await h.withAdminToken();
    w.configApi.failWith = httpError(403);
    const s = (await h.admin.call("POST", "/scenes", scene())).json;
    await w.sync();
    expect((await h.admin.call("GET", `/scenes/${s.id}`)).json.haScript).toMatchObject({ status: "failed", error: "HA said 403" });
    expect((await h.admin.call("GET", "/admin/config-sync")).json).toMatchObject({ failedJobs: 0 }); // applied, so no longer waiting
    w.configApi.failWith = null;
    expect((await h.admin.call("POST", "/admin/config-sync/resync")).json.queued).toBe(1);
    await w.sync();
    expect((await h.admin.call("GET", `/scenes/${s.id}`)).json.haScript.status).toBe("synced");
  });

  test("the sync status endpoint says whether changes can be applied; it is for admins", async () => {
    let st = (await h.admin.call("GET", "/admin/config-sync")).json;
    expect(st).toMatchObject({ connected: true, adminTokenSet: false, workerOnline: false, canApply: false });
    await h.withAdminToken();
    await h.admin.call("POST", "/scenes", scene());
    st = (await h.admin.call("GET", "/admin/config-sync")).json;
    expect(st).toMatchObject({ adminTokenSet: true, pendingJobs: 2, canApply: false }); // the scene, and the mode helper queued with the token
    await w.sync();
    expect((await h.admin.call("GET", "/admin/config-sync")).json).toMatchObject({ workerOnline: true, pendingJobs: 0, canApply: true });
    const meera = await h.join("Meera", { role: "member" });
    expect((await meera.call("GET", "/admin/config-sync")).status).toBe(403);
    expect((await meera.call("POST", "/admin/config-sync/resync")).status).toBe(403);
  });

  test("guests never see sync details", async () => {
    await h.withAdminToken();
    const s = (await h.admin.call("POST", "/scenes", scene())).json;
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "light.floor_lamp", subjectType: "role", subjectId: "guest", effect: "allow" });
    const guest = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    const seen = (await guest.call("GET", "/scenes")).json.scenes[0];
    expect(seen).toMatchObject({ id: s.id });
    expect(seen).not.toHaveProperty("haScript");
  });
});
