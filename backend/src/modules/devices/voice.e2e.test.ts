import { beforeEach, describe, expect, test } from "bun:test";
import { httpError } from "@/testing/fake-config-api";
import { createWorld, homeWithHa, type World } from "@/testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;

const device = async (name: string) => (await h.admin.call("GET", "/devices")).json.devices.find((d: any) => d.name === name);
const expose = async (name: string, voiceExposed: boolean) => h.admin.call("PATCH", `/devices/${(await device(name)).id}/settings`, { voiceExposed });

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("voice exposure reaches Home Assistant's Assist", () => {
  test("without an admin token the flag is stored and the reason is shown", async () => {
    const r = await expose("Floor lamp", true);
    expect(r.json.settings).toMatchObject({ voiceExposed: true, voiceSync: { status: "none", error: expect.stringMatching(/admin token/) } });
    expect(w.configApi.exposed.size).toBe(0);
  });

  test("with an admin token the change is queued, applied by the worker, and shown as synced; turning it off un-exposes", async () => {
    await h.withAdminToken();
    await w.sync();
    expect((await expose("Floor lamp", true)).json.settings.voiceSync.status).toBe("pending");
    await w.sync();
    expect((await device("Floor lamp")).settings).toMatchObject({ voiceExposed: true, voiceSync: { status: "synced", error: null } });
    expect(w.configApi.exposed.get("light.floor_lamp")).toBe(true);
    await expose("Floor lamp", false);
    await w.sync();
    expect(w.configApi.exposed.get("light.floor_lamp")).toBe(false);
    expect((await device("Floor lamp")).settings.voiceSync.status).toBe("synced");
  });

  test("exposures set before there was an admin token are sent when one is added", async () => {
    await expose("Floor lamp", true);
    await expose("Kettle plug", true);
    await h.withAdminToken();
    await w.sync();
    expect([...w.configApi.exposed].sort()).toEqual([["light.floor_lamp", true], ["switch.kettle_plug", true]]);
    expect((await device("Kettle plug")).settings.voiceSync.status).toBe("synced");
  });

  test("a failure is shown with its reason and a resync retries it", async () => {
    await h.withAdminToken();
    await w.sync();
    w.configApi.failWith = httpError(403);
    await expose("Floor lamp", true);
    await w.sync();
    expect((await device("Floor lamp")).settings.voiceSync).toEqual({ status: "failed", error: "HA said 403" });
    w.configApi.failWith = null;
    await h.admin.call("POST", "/admin/config-sync/resync");
    await w.sync();
    expect((await device("Floor lamp")).settings.voiceSync.status).toBe("synced");
  });

  test("changing only the power limit does not touch voice exposure", async () => {
    await h.withAdminToken();
    await w.sync();
    const id = (await device("Kettle plug")).id;
    await h.admin.call("PATCH", `/devices/${id}/settings`, { powerLimitW: 1500 });
    await w.sync();
    expect(w.configApi.exposed.size).toBe(0);
    expect((await device("Kettle plug")).settings).toMatchObject({ powerLimitW: 1500, voiceSync: { status: "none" } });
  });
});
