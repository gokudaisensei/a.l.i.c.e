import { beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { buildApp } from "@/app";
import { createTestDb } from "@/core/database/client";
import { haConnections } from "@/core/database/schema";
import { HaAuthError } from "../home-assistant/clients/ha-ws-gateway";
import { FakeGateway, state } from "../home-assistant/testing";
import { createServices } from "@/services";
import { Browser } from "@/testing/http";
import { fakeHa, SEAL_KEYS } from "@/testing/world";

const KEY = randomBytes(32).toString("base64");
const TOKEN = "fake-long-lived-token-1234567890";
const MIN = 60_000;

let now: number;
let db: ReturnType<typeof createTestDb>;
let gw: FakeGateway;
let services: ReturnType<typeof createServices>;
let app: ReturnType<typeof buildApp>;
const tokensSeen: string[] = [];

beforeEach(() => {
  now = 1_700_000_000_000;
  db = createTestDb();
  gw = fakeHa();
  tokensSeen.length = 0;
  services = createServices(db, {
    now: () => now, secretsKey: KEY, adminSealPublicKey: SEAL_KEYS.publicKey,
    auth: { rpId: "localhost", rpName: "Alice", origin: "http://localhost:3000", sessionTtlHours: 24 },
    gatewayFactory: (cfg) => {
      tokensSeen.push(cfg.token);
      if (cfg.token.startsWith("bad-")) { const b = new FakeGateway(); b.connectFailures = [new HaAuthError()]; return b; }
      return gw;
    },
  });
  app = buildApp(services);
});

const browser = () => new Browser(app);

/** Admin with Home Assistant connected. */
async function homeWithHa() {
  const admin = browser();
  await admin.register("Gokul");
  const put = await admin.call("PUT", "/ha/connection", { baseUrl: "http://homeassistant.local:8123", token: TOKEN });
  return { admin, put };
}
const byName = (list: any[], name: string) => list.find((d) => d.name === name);
const settle = (id: string) => services.commands.done(id);

describe("Home Assistant connection setup", () => {
  test("nothing configured yet: no devices, and the connection says so", async () => {
    const admin = browser();
    await admin.register("Gokul");
    expect((await admin.call("GET", "/ha/connection")).json).toEqual({ configured: false });
    expect((await admin.call("GET", "/devices")).json.devices).toEqual([]);
  });

  test("saving tests the credentials first, connects, stores the token encrypted, and never returns it", async () => {
    const { put } = await homeWithHa();
    expect(put.status).toBe(200);
    expect(put.json).toMatchObject({ configured: true, status: "connected", haVersion: "2026.10.4", baseUrl: "http://homeassistant.local:8123" });
    expect(put.json.entities).toBeGreaterThan(10);
    expect(JSON.stringify(put.json)).not.toContain(TOKEN);
    const row = db.select().from(haConnections).get()!;
    expect(row.operationalTokenEnc).not.toContain(TOKEN);
    expect(row.operationalTokenEnc.startsWith("v1.")).toBe(true);
  });

  test("bad input is refused with a clear reason: rejected token, bad URL, link-local address, no step-up, not an admin", async () => {
    const admin = browser();
    await admin.register("Gokul");
    expect((await admin.call("PUT", "/ha/connection", { baseUrl: "http://ha.local:8123", token: "bad-token-1234567890" })).json.error.code).toBe("ha_token_rejected");
    expect((await admin.call("PUT", "/ha/connection", { baseUrl: "not a url", token: TOKEN })).json.error.code).toBe("validation_error");
    expect((await admin.call("PUT", "/ha/connection", { baseUrl: "ftp://ha.local", token: TOKEN })).json.error.code).toBe("validation_error");
    expect((await admin.call("PUT", "/ha/connection", { baseUrl: "http://169.254.169.254/latest", token: TOKEN })).json.error.code).toBe("validation_error");
    expect((await admin.call("PUT", "/ha/connection", { baseUrl: "http://user:pw@ha.local", token: TOKEN })).json.error.code).toBe("validation_error");
    now += 6 * MIN;
    expect((await admin.call("PUT", "/ha/connection", { baseUrl: "http://ha.local:8123", token: TOKEN })).json.error.code).toBe("step_up_required");
    expect(db.select().from(haConnections).all()).toHaveLength(0);
  });

  test("a member cannot touch the connection", async () => {
    const { admin } = await homeWithHa();
    const inv = await admin.call("POST", "/household/invitations", { role: "member" });
    const meera = browser();
    await meera.register("Meera", inv.json.code);
    expect((await meera.call("GET", "/ha/connection")).status).toBe(403);
    expect((await meera.call("PUT", "/ha/connection", { baseUrl: "http://ha.local", token: TOKEN })).status).toBe(403);
    expect((await meera.call("POST", "/ha/connection/test", { baseUrl: "http://ha.local", token: TOKEN })).status).toBe(403);
  });

  test("the admin token is stored separately, verified, and the connection can be resynced and removed", async () => {
    const { admin } = await homeWithHa();
    expect((await admin.call("PUT", "/ha/connection/admin-token", { token: "bad-admin-token-1234567890" })).json.error.code).toBe("ha_token_rejected");
    expect((await admin.call("PUT", "/ha/connection/admin-token", { token: "admin-token-1234567890" })).status).toBe(200);
    expect((await admin.call("GET", "/ha/connection")).json.adminTokenSet).toBe(true);
    gw.states = [...gw.states, state("switch.new_one", "off", { friendly_name: "New one" })];
    expect((await admin.call("POST", "/ha/connection/resync")).json.entities).toBe(gw.states.length);
    expect((await admin.call("DELETE", "/ha/connection")).status).toBe(200);
    expect((await admin.call("GET", "/ha/connection")).json.configured).toBe(false);
    expect((await admin.call("GET", "/devices")).json.devices).toEqual([]);
  });

  test("after a restart the stored connection comes back by decrypting the token", async () => {
    await homeWithHa();
    tokensSeen.length = 0;
    const again = createServices(db, { now: () => now, secretsKey: KEY, gatewayFactory: (cfg) => { tokensSeen.push(cfg.token); return gw; } });
    again.ha.startAll();
    await Bun.sleep(50);
    expect(tokensSeen).toEqual([TOKEN]);
    expect(again.manager.statuses()[0]).toMatchObject({ status: "connected" });
    // Without the key nothing starts, and nothing throws.
    const keyless = createServices(db, { now: () => now, secretsKey: null, gatewayFactory: () => gw });
    keyless.ha.startAll();
    expect(keyless.manager.statuses()).toEqual([]);
  });
});

describe("devices (Things) over HTTP", () => {
  test("lists Things with clean names, live values and ambiguous facets flagged", async () => {
    const { admin } = await homeWithHa();
    const { devices } = (await admin.call("GET", "/devices")).json;
    const names = devices.map((d: any) => d.name);
    expect(names).toContain("Echo Show");
    expect(names).toContain("Floor lamp");
    expect(names).not.toContain("Hue Bridge"); // config-only, hidden
    const echo = byName(devices, "Echo Show");
    expect(echo.primary).toMatchObject({ entityId: "media_player.echo_show", domain: "media_player" });
    expect(echo.others.map((e: any) => e.entityId)).toEqual(["camera.echo_show_camera"]);
    expect(echo.controls.map((e: any) => e.name).sort()).toEqual(["Microphone mute", "Volume"]);
    expect(echo.facets).toHaveLength(1);
    expect(echo.facets[0]).toMatchObject({ key: "privacy_shutter", ambiguous: true, sensitive: true });
    expect(echo.diagnosticCount).toBe(3);
    expect(echo.diagnostics).toBeUndefined();
    expect(byName(devices, "Floor lamp").primary.values).toMatchObject({ power: true });
    expect((await admin.call("GET", `/devices/${echo.id}?include=diagnostics`)).json.diagnostics).toHaveLength(3);
  });

  test("filters by area, type and free text (names and aliases)", async () => {
    const { admin } = await homeWithHa();
    const names = async (qs: string) => (await admin.call("GET", `/devices?${qs}`)).json.devices.map((d: any) => d.name);
    expect(await names("area=living")).toEqual(["Ceiling lights", "Floor lamp"]);
    expect(await names("type=lock")).toEqual(["Front door"]);
    expect(await names("q=living%20room%20bulb")).toEqual(["Ceiling lights", "Floor lamp"]); // aliases add synonyms and the area
    expect(await names("q=kettle")).toEqual(["Kettle plug"]);
    const areas = (await admin.call("GET", "/areas")).json.areas;
    expect(areas.find((a: any) => a.id === "living")).toMatchObject({ name: "Living room", deviceCount: 2 });
    expect((await admin.call("GET", "/areas/kitchen/devices")).json.devices.map((d: any) => d.name)).toEqual(["Echo Show", "Kettle plug"]);
  });

  test("a facet override survives a resync: saying 'on means closed' resolves the shutter", async () => {
    const { admin } = await homeWithHa();
    const echo = byName((await admin.call("GET", "/devices")).json.devices, "Echo Show");
    expect((await admin.call("PUT", "/entities/binary_sensor.echo_show_camera_shutter/role", { onMeans: "Closed" })).status).toBe(200);
    await admin.call("POST", "/ha/connection/resync");
    const facet = (await admin.call("GET", `/devices/${echo.id}`)).json.facets[0];
    expect(facet).toMatchObject({ value: "open", ambiguous: false, basis: "override" }); // fixture state is "off"
    gw.emitState(state("binary_sensor.echo_show_camera_shutter", "on"), state("binary_sensor.echo_show_camera_shutter", "off"));
    expect((await admin.call("GET", `/devices/${echo.id}`)).json.facets[0]).toMatchObject({ value: "closed", label: "Closed" });
  });

  test("rename, hide and unhide are overrides; admins can still see hidden devices on request", async () => {
    const { admin } = await homeWithHa();
    const lamp = byName((await admin.call("GET", "/devices")).json.devices, "Floor lamp");
    expect((await admin.call("PATCH", `/devices/${lamp.id}/name`, { name: "Reading lamp" })).json).toMatchObject({ name: "Reading lamp", nameSource: "override" });
    expect((await admin.call("PATCH", `/devices/${lamp.id}/name`, { name: null })).json.name).toBe("Floor lamp");
    await admin.call("POST", `/devices/${lamp.id}/hide`);
    expect((await admin.call("GET", "/devices")).json.devices.map((d: any) => d.name)).not.toContain("Floor lamp");
    expect((await admin.call("GET", "/devices?includeHidden=true")).json.devices.map((d: any) => d.name)).toContain("Floor lamp");
    await admin.call("POST", `/devices/${lamp.id}/unhide`);
    expect((await admin.call("GET", "/devices")).json.devices.map((d: any) => d.name)).toContain("Floor lamp");
    expect((await admin.call("PATCH", "/devices/thing_nope/name", { name: "x" })).status).toBe(404);
  });

  test("merge and split Things (step-up required)", async () => {
    const { admin } = await homeWithHa();
    const list = async () => (await admin.call("GET", "/devices")).json.devices;
    const [kettle, door] = [byName(await list(), "Kettle plug"), byName(await list(), "Front door sensor")];
    expect((await admin.call("POST", "/devices/merge", { ids: [kettle.id] })).status).toBe(422);
    expect((await admin.call("POST", "/devices/merge", { ids: [kettle.id, door.id] })).status).toBe(200);
    const merged = byName(await list(), "Kettle plug");
    expect(merged.id).toBe(kettle.id); // keeps the first one's id
    expect(await list()).toHaveLength((await list()).length);
    expect(byName(await list(), "Front door sensor")).toBeUndefined();
    expect(merged.sensors.map((s: any) => s.entityId).sort()).toEqual(["sensor.front_door_sensor_battery", "sensor.kettle_plug_power"]);
    expect((await admin.call("POST", `/devices/${merged.id}/split`, { entityIds: ["binary_sensor.front_door_sensor_door"] })).status).toBe(200);
    expect(byName(await list(), "Kettle plug").sensors).toHaveLength(2);
    now += 6 * MIN;
    expect((await admin.call("POST", "/devices/merge", { ids: [kettle.id, door.id] })).json.error.code).toBe("step_up_required");
  });
});

describe("commands over HTTP", () => {
  test("turning a device on: 202, then confirmed by the observed state; default target is the primary", async () => {
    const { admin } = await homeWithHa();
    const kettle = byName((await admin.call("GET", "/devices")).json.devices, "Kettle plug");
    const res = await admin.call("POST", `/devices/${kettle.id}/commands`, { action: "turn_on" });
    expect(res.status).toBe(202);
    expect(res.json).toMatchObject({ entityId: "switch.kettle_plug", action: "turn_on", state: "pending" });
    await settle(res.json.id);
    const done = (await admin.call("GET", `/commands/${res.json.id}`)).json;
    expect(done).toMatchObject({ state: "confirmed", confirmedBy: "state", requestedBy: expect.any(String) });
    expect(byName((await admin.call("GET", "/devices")).json.devices, "Kettle plug").primary.values.power).toBe(true);
  });

  test("a control entity of the Thing can be named; entities of other Things and bad operations are refused", async () => {
    const { admin } = await homeWithHa();
    const { devices } = (await admin.call("GET", "/devices")).json;
    const echo = byName(devices, "Echo Show");
    const mute = await admin.call("POST", `/devices/${echo.id}/commands`, { entityId: "switch.echo_show_microphone_mute", action: "turn_on" });
    expect((await settle(mute.json.id)).state).toBe("confirmed");
    const other = await admin.call("POST", `/devices/${echo.id}/commands`, { entityId: "switch.kettle_plug", action: "turn_on" });
    expect(other.json.error.code).toBe("entity_not_in_thing");
    const bad = await admin.call("POST", `/devices/${byName(devices, "Kettle plug").id}/commands`, { action: "set_brightness", parameters: { brightness_pct: 50 } });
    expect((await settle(bad.json.id)).failure!.code).toBe("unsupported_operation");
    expect((await admin.call("POST", `/devices/${echo.id}/commands`, {})).status).toBe(422);
    expect((await admin.call("POST", "/devices/thing_nope/commands", { action: "turn_on" })).status).toBe(404);
  });

  test("brightness in percent, end to end", async () => {
    const { admin } = await homeWithHa();
    const lamp = byName((await admin.call("GET", "/devices")).json.devices, "Floor lamp");
    const res = await admin.call("POST", `/devices/${lamp.id}/commands`, { action: "set_brightness", parameters: { brightness_pct: 30 } });
    expect((await settle(res.json.id)).state).toBe("confirmed");
    expect(byName((await admin.call("GET", "/devices")).json.devices, "Floor lamp").primary.values.brightness).toBe(30);
  });

  test("unlocking needs a fresh passkey; with one it works, and the setting can change that", async () => {
    const { admin } = await homeWithHa();
    const door = byName((await admin.call("GET", "/devices")).json.devices, "Front door");
    now += 6 * MIN;
    const refused = await admin.call("POST", `/devices/${door.id}/commands`, { action: "unlock" });
    expect((await settle(refused.json.id)).failure!.code).toBe("step_up_required");
    await admin.stepUp();
    expect((await settle((await admin.call("POST", `/devices/${door.id}/commands`, { action: "unlock" })).json.id)).state).toBe("confirmed");
    await admin.call("PUT", "/admin/security/sensitive-operations", { rules: [{ domain: "lock", action: "unlock", sensitive: false }] });
    now += 6 * MIN;
    expect((await settle((await admin.call("POST", `/devices/${door.id}/commands`, { action: "lock" })).json.id)).state).toBe("confirmed");
    expect((await settle((await admin.call("POST", `/devices/${door.id}/commands`, { action: "unlock" })).json.id)).state).toBe("confirmed"); // no step-up needed any more
  });

  test("who can read commands: the sender and admins; admins can list them all; finished commands cannot be cancelled", async () => {
    const { admin } = await homeWithHa();
    const inv = await admin.call("POST", "/household/invitations", { role: "member" });
    const meera = browser();
    await meera.register("Meera", inv.json.code);
    const lamp = byName((await admin.call("GET", "/devices")).json.devices, "Floor lamp");
    const mine = await meera.call("POST", `/devices/${lamp.id}/commands`, { action: "turn_off" });
    await settle(mine.json.id);
    const adminCmd = await admin.call("POST", `/devices/${lamp.id}/commands`, { action: "turn_on" });
    await settle(adminCmd.json.id);
    expect((await meera.call("GET", `/commands/${mine.json.id}`)).status).toBe(200);
    expect((await meera.call("GET", `/commands/${adminCmd.json.id}`)).status).toBe(404);
    expect((await admin.call("GET", `/commands/${mine.json.id}`)).status).toBe(200);
    expect((await meera.call("GET", "/commands")).status).toBe(403);
    expect((await admin.call("GET", "/commands?state=confirmed")).json.commands).toHaveLength(2);
    expect((await admin.call("POST", `/commands/${mine.json.id}/cancel`)).status).toBe(409);
  });

  test("commands survive in the database; ones interrupted by a restart are marked failed", async () => {
    const { admin } = await homeWithHa();
    const lamp = byName((await admin.call("GET", "/devices")).json.devices, "Floor lamp");
    await settle((await admin.call("POST", `/devices/${lamp.id}/commands`, { action: "turn_off" })).json.id);
    const store = (services.commands as any).store;
    const stuck = { ...store.list()[0], id: "cmd_stuck", state: "dispatched", finishedAt: null, failure: null };
    store.create(stuck);
    expect(services.commands.recoverInterrupted()).toBe(1);
    expect(store.get("cmd_stuck")).toMatchObject({ state: "failed", failure: { code: "interrupted" } });
    expect(store.list({ state: "confirmed" })).toHaveLength(1);
  });
});

describe("who sees which devices", () => {
  async function household() {
    const { admin } = await homeWithHa();
    const connectionId = (await admin.call("GET", "/ha/connection")).json.id;
    const join = async (name: string, body: object) => {
      const inv = await admin.call("POST", "/household/invitations", body);
      const b = browser();
      await b.register(name, inv.json.code);
      return b;
    };
    return { admin, connectionId, meera: await join("Meera", { role: "member" }), lakshmi: await join("Lakshmi", { role: "guest", guestAccessHours: 48 }) };
  }
  const names = async (b: Browser) => (await b.call("GET", "/devices")).json.devices.map((d: any) => d.name);

  test("a guest sees nothing until a device is allowed for guests, and then only that device", async () => {
    const { admin, connectionId, lakshmi } = await household();
    expect(await names(lakshmi)).toEqual([]);
    expect((await lakshmi.call("GET", "/areas")).json.areas.every((a: any) => a.deviceCount === 0)).toBe(true);
    await admin.call("POST", "/permissions/policies", { connectionId, entityId: "switch.kettle_plug", subjectType: "role", subjectId: "guest", effect: "allow" });
    expect(await names(lakshmi)).toEqual(["Kettle plug"]);
    const kettle = (await lakshmi.call("GET", "/devices")).json.devices[0];
    expect(kettle.sensors).toEqual([]); // the power sensor was not given to guests, so it is not even listed
    expect(kettle.diagnostics).toBeUndefined();
    expect((await lakshmi.call("GET", "/areas")).json.areas.find((a: any) => a.id === "kitchen").deviceCount).toBe(1);
  });

  test("devices a guest cannot see are 404, not 403, and cannot be controlled", async () => {
    const { admin, connectionId, lakshmi } = await household();
    await admin.call("POST", "/permissions/policies", { connectionId, entityId: "switch.kettle_plug", subjectType: "role", subjectId: "guest", effect: "allow", operations: ["turn_on", "turn_off"] });
    const all = (await admin.call("GET", "/devices")).json.devices;
    const echo = byName(all, "Echo Show");
    expect((await lakshmi.call("GET", `/devices/${echo.id}`)).status).toBe(404);
    expect((await lakshmi.call("POST", `/devices/${echo.id}/commands`, { action: "turn_on" })).status).toBe(404);
    expect((await lakshmi.call("GET", "/devices?includeHidden=true")).json.devices).toHaveLength(1);
    const kettle = byName(all, "Kettle plug");
    expect((await settle((await lakshmi.call("POST", `/devices/${kettle.id}/commands`, { action: "turn_on" })).json.id)).state).toBe("confirmed");
  });

  test("a guest cannot rename, hide, merge or reconfigure anything", async () => {
    const { admin, connectionId, lakshmi } = await household();
    await admin.call("POST", "/permissions/policies", { connectionId, entityId: "switch.kettle_plug", subjectType: "role", subjectId: "guest", effect: "allow" });
    const kettle = (await lakshmi.call("GET", "/devices")).json.devices[0];
    expect((await lakshmi.call("PATCH", `/devices/${kettle.id}/name`, { name: "Mine" })).status).toBe(403);
    expect((await lakshmi.call("POST", `/devices/${kettle.id}/hide`)).status).toBe(403);
    expect((await lakshmi.call("PUT", "/entities/switch.kettle_plug/role", { role: "sensor" })).status).toBe(403);
  });

  test("a deny policy removes a device for a member but not for an admin", async () => {
    const { admin, connectionId, meera } = await household();
    expect(await names(meera)).toContain("Floor lamp");
    const meeraId = (await meera.call("GET", "/users/me")).json.id;
    await admin.call("POST", "/permissions/policies", { connectionId, entityId: "light.floor_lamp", subjectType: "member", subjectId: meeraId, effect: "deny" });
    expect(await names(meera)).not.toContain("Floor lamp");
    expect(await names(admin)).toContain("Floor lamp");
    const lamp = byName((await admin.call("GET", "/devices")).json.devices, "Floor lamp");
    expect((await meera.call("GET", `/devices/${lamp.id}`)).status).toBe(404);
  });

  test("members can rename but not hide or merge", async () => {
    const { meera } = await household();
    const lamp = byName((await meera.call("GET", "/devices")).json.devices, "Floor lamp");
    expect((await meera.call("PATCH", `/devices/${lamp.id}/name`, { name: "Desk lamp" })).json.name).toBe("Desk lamp");
    expect((await meera.call("POST", `/devices/${lamp.id}/hide`)).status).toBe(403);
    expect((await meera.call("POST", "/devices/merge", { ids: [lamp.id, lamp.id] })).status).toBe(403);
  });

  test("an expired guest loses access to everything", async () => {
    const { admin, connectionId, lakshmi } = await household();
    await admin.call("POST", "/permissions/policies", { connectionId, entityId: "switch.kettle_plug", subjectType: "role", subjectId: "guest", effect: "allow" });
    expect(await names(lakshmi)).toEqual(["Kettle plug"]);
    now += 49 * 60 * MIN;
    expect((await lakshmi.call("GET", "/devices")).status).toBe(401); // the 24h session has lapsed too
    const fresh = browser(); fresh.device = lakshmi.device;
    expect((await fresh.login()).json.error.code).toBe("access_expired");
  });
});
