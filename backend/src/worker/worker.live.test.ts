/**
 * The config-worker and everything it feeds, against the real mock Home Assistant (bun run ha:up && bun run ha:bootstrap).
 * Skipped when HA_TOKEN is not set. These tests prove what the fakes cannot: that Home Assistant accepts what we write,
 * and that scenes, routines, automations, the mode helper and voice exposure really work from inside Home Assistant.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createConnection, createLongLivedTokenAuth } from "home-assistant-js-websocket";
import pino from "pino";
import { buildApp } from "../app";
import { createTestDb } from "../core/database/client";
import type { AppEvent } from "../core/events/app-events";
import { InMemoryEventBus } from "../core/events/event-bus";
import { createServices } from "../services";
import { Browser } from "../testing/http";
import { SEAL_KEYS, SECRETS_KEY, TEST_AUTH } from "../testing/world";
import { ConfigWorker } from "./config-worker";
import { HaAdminApi } from "./ha-admin-api";

const url = process.env.HA_URL;
const token = process.env.HA_TOKEN;
const run = url && token ? describe : describe.skip;

const until = async (pred: () => boolean | Promise<boolean>, what: string, ms = 8000) => {
  const end = Date.now() + ms;
  while (!(await pred())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};

run("config-worker against the mock Home Assistant", () => {
  const db = createTestDb();
  const services = createServices(db, { auth: TEST_AUTH, bus: new InMemoryEventBus<AppEvent>(), secretsKey: SECRETS_KEY, adminSealPublicKey: SEAL_KEYS.publicKey });
  const app = buildApp(services);
  const admin = new Browser(app);
  const worker = new ConfigWorker({ db, privateKeyPem: SEAL_KEYS.privateKey, apiFactory: (u, t) => new HaAdminApi(u, t), log: pino({ level: "silent" }), retryDelayMs: 0 });
  const pump = async () => { await worker.drain(); services.configJobs.applyResults(); };
  const created = { scenes: [] as string[], routines: [] as string[], automations: [] as string[] };

  const ha = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${url}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };
  const haState = async (id: string) => (await ha("GET", `/api/states/${id}`)).json?.state as string | undefined;
  const callHa = (domain: string, service: string, data: object) => ha("POST", `/api/services/${domain}/${service}`, data);
  const cache = () => services.manager.statuses().length ? services.manager.forHousehold(services.manager.statuses()[0]!.householdId)[0]!.cache : null;
  const mode = async () => (await admin.call("GET", "/household/mode")).json;
  const things = async () => (await admin.call("GET", "/devices")).json.devices as any[];

  beforeAll(async () => {
    await admin.register("Gokul");
    expect((await admin.call("PUT", "/ha/connection", { baseUrl: url, token })).status).toBe(200);
    // The onboarding user is the owner, so the long-lived token is an admin token.
    expect((await admin.call("PUT", "/ha/connection/admin-token", { token })).status).toBe(200);
    await callHa("input_boolean", "turn_off", { entity_id: ["input_boolean.test_switch", "input_boolean.test_switch_2"] });
  }, 30_000);

  afterAll(async () => {
    for (const id of created.automations) await admin.call("DELETE", `/automations/${id}`);
    for (const id of created.routines) await admin.call("DELETE", `/routines/${id}`);
    for (const id of created.scenes) await admin.call("DELETE", `/scenes/${id}`);
    await pump();
    await callHa("input_boolean", "turn_off", { entity_id: ["input_boolean.test_switch", "input_boolean.test_switch_2"] });
    await services.manager.stopAll();
  });

  test("the mode helper is created in Home Assistant and follows the household mode both ways", async () => {
    await pump(); // helper.ensure_mode_select
    await until(async () => (await mode()).mirror.status === "active", "the helper to appear");
    expect(await haState("input_select.alice_household_mode")).toBe("home");

    await admin.call("PUT", "/household/mode", { mode: "night" });
    await until(async () => (await haState("input_select.alice_household_mode")) === "night", "HA to follow Alice");

    await callHa("input_select", "select_option", { entity_id: "input_select.alice_household_mode", option: "vacation" });
    await until(async () => (await mode()).mode === "vacation", "Alice to follow HA");
    expect((await mode()).changedBy).toBeNull(); // changed from Home Assistant
    await admin.call("PUT", "/household/mode", { mode: "home" });
    await until(async () => (await haState("input_select.alice_household_mode")) === "home", "reset");
  });

  test("a scene becomes a script in Home Assistant and runs from there, without Alice", async () => {
    const lamp = (await things()).find((d) => d.primary?.entityId === "light.bed_light");
    const pct = lamp.primary.values.brightness === 20 ? 30 : 20;
    const scene = (await admin.call("POST", "/scenes", { name: "Live scene", actions: [{ entityId: "light.bed_light", action: "set_brightness", parameters: { brightness_pct: pct } }, { entityId: "input_boolean.test_switch_2", action: "turn_on" }] })).json;
    created.scenes.push(scene.id);
    await pump();
    const synced = (await admin.call("GET", `/scenes/${scene.id}`)).json.haScript;
    const scriptId = synced.entityId as string; // read before asserting: some matchers rewrite the object they are given
    expect(synced).toMatchObject({ status: "synced", error: null });
    expect(scriptId).toMatch(/^script\.alice_scene_/);
    await until(async () => (await haState(scriptId)) === "off", "the script to appear in HA (idle)");

    await callHa("script", "turn_on", { entity_id: scriptId }); // Home Assistant runs it, as from a dashboard button
    await until(async () => (await things()).find((d) => d.primary?.entityId === "light.bed_light").primary.values.brightness === pct, "the light to change");
    await until(async () => (await haState("input_boolean.test_switch_2")) === "on", "the switch to turn on");
    await callHa("input_boolean", "turn_off", { entity_id: "input_boolean.test_switch_2" });
  });

  test("a routine with a wait and a mode change runs inside Home Assistant", async () => {
    const scene = (await admin.call("POST", "/scenes", { name: "Switch on", actions: [{ entityId: "input_boolean.test_switch_2", action: "turn_on" }] })).json;
    created.scenes.push(scene.id);
    const routine = (await admin.call("POST", "/routines", { name: "Live routine", steps: [{ type: "scene", sceneId: scene.id }, { type: "delay", seconds: 1 }, { type: "mode", mode: "away" }] })).json;
    created.routines.push(routine.id);
    await pump();
    const hs = (await admin.call("GET", `/routines/${routine.id}`)).json.haScript;
    expect(hs.status).toBe("synced");
    await callHa("script", "turn_on", { entity_id: hs.entityId });
    await until(async () => (await haState("input_boolean.test_switch_2")) === "on", "the scene step");
    expect((await mode()).mode).toBe("home"); // the wait has not ended
    await until(async () => (await mode()).mode === "away", "the mode step, after the wait", 10_000);
    await admin.call("PUT", "/household/mode", { mode: "home" });
    await callHa("input_boolean", "turn_off", { entity_id: "input_boolean.test_switch_2" });
  });

  test("an automation runs inside Home Assistant when its trigger happens, and Alice records the run", async () => {
    const a = await admin.call("POST", "/automations", {
      name: "Live door",
      definition: { version: 1, trigger: { type: "door_opens", entityId: "binary_sensor.test_door" }, conditions: [{ type: "mode", mode: "home" }], actions: [{ type: "device", entityId: "input_boolean.test_switch_2", action: "turn_on" }] },
    });
    expect(a.status).toBe(200);
    created.automations.push(a.json.id);
    await pump();
    const got = (await admin.call("GET", `/automations/${a.json.id}`)).json;
    const automationId = got.haAutomation.entityId as string;
    expect(got.haAutomation.status).toBe("synced");
    expect(automationId).toMatch(/^automation\./);
    await until(async () => (await haState(automationId)) === "on", "the automation to be loaded and on");

    await callHa("input_boolean", "turn_on", { entity_id: "input_boolean.test_switch" }); // the "door" opens
    await until(async () => (await haState("input_boolean.test_switch_2")) === "on", "the automation to act");
    await until(async () => (await admin.call("GET", `/automations/${a.json.id}/runs`)).json.runs.length === 1, "the run to be recorded");

    // Disabled in Alice means disabled in Home Assistant.
    await callHa("input_boolean", "turn_off", { entity_id: ["input_boolean.test_switch", "input_boolean.test_switch_2"] });
    await admin.call("POST", `/automations/${a.json.id}/disable`);
    await pump();
    await until(async () => (await haState(automationId)) === "off", "the automation to be disabled");
    await callHa("input_boolean", "turn_on", { entity_id: "input_boolean.test_switch" });
    await Bun.sleep(600);
    expect(await haState("input_boolean.test_switch_2")).toBe("off");
    await callHa("input_boolean", "turn_off", { entity_id: "input_boolean.test_switch" });
  });

  test("voice exposure is applied in Home Assistant's Assist", async () => {
    const lamp = (await things()).find((d) => d.primary?.entityId === "light.bed_light");
    await admin.call("PATCH", `/devices/${lamp.id}/settings`, { voiceExposed: true });
    await pump();
    expect((await things()).find((d) => d.primary?.entityId === "light.bed_light").settings.voiceSync).toEqual({ status: "synced", error: null });
    const conn = await createConnection({ auth: createLongLivedTokenAuth(url!, token!) });
    try {
      const r = await conn.sendMessagePromise<{ exposed_entities: Record<string, { conversation?: boolean }> }>({ type: "homeassistant/expose_entity/list" });
      expect(r.exposed_entities["light.bed_light"]?.conversation).toBe(true);
      await admin.call("PATCH", `/devices/${lamp.id}/settings`, { voiceExposed: false });
      await pump();
      const after = await conn.sendMessagePromise<{ exposed_entities: Record<string, { conversation?: boolean }> }>({ type: "homeassistant/expose_entity/list" });
      expect(after.exposed_entities["light.bed_light"]?.conversation).not.toBe(true);
    } finally { conn.close(); }
  });

  test("deleting a scene removes its script from Home Assistant", async () => {
    const scene = (await admin.call("POST", "/scenes", { name: "Short lived", actions: [{ entityId: "input_boolean.test_switch_2", action: "turn_off" }] })).json;
    await pump();
    const entityId = (await admin.call("GET", `/scenes/${scene.id}`)).json.haScript.entityId;
    await until(async () => (await haState(entityId)) === "off", "the script to appear");
    await admin.call("DELETE", `/scenes/${scene.id}`);
    await pump();
    await until(async () => (await ha("GET", `/api/states/${entityId}`)).status === 404, "the script to disappear");
  });

  test("edits and removals made inside Home Assistant are noticed, and untouched items are not flagged (real rewriting included)", async () => {
    const verify = async () => { await admin.call("POST", "/admin/config-sync/verify"); await pump(); };
    const scene = (await admin.call("POST", "/scenes", { name: "Drift scene", actions: [{ entityId: "light.bed_light", action: "set_brightness", parameters: { brightness_pct: 40 } }, { entityId: "input_boolean.test_switch_2", action: "turn_on" }] })).json;
    created.scenes.push(scene.id);
    const routine = (await admin.call("POST", "/routines", { name: "Drift routine", steps: [{ type: "scene", sceneId: scene.id }, { type: "delay", seconds: 2 }, { type: "device", entityId: "input_boolean.test_switch_2", action: "turn_off" }] })).json;
    created.routines.push(routine.id);
    const auto = (await admin.call("POST", "/automations", { name: "Drift automation", definition: { version: 1, trigger: { type: "door_opens", entityId: "binary_sensor.test_door" }, conditions: [{ type: "someone_home" }, { type: "days", days: "weekdays" }], actions: [{ type: "device", entityId: "input_boolean.test_switch_2", action: "turn_on" }, { type: "notify", message: "Drift test" }] } })).json;
    created.automations.push(auto.id);
    await pump();
    const status = async () => ({
      scene: (await admin.call("GET", `/scenes/${scene.id}`)).json.haScript,
      routine: (await admin.call("GET", `/routines/${routine.id}`)).json.haScript,
      automation: (await admin.call("GET", `/automations/${auto.id}`)).json.haAutomation,
    });
    const before = await status();
    expect([before.scene.status, before.routine.status, before.automation.status]).toEqual(["synced", "synced", "synced"]);

    await verify(); // nothing was touched: Home Assistant's own rewriting must not look like a change
    const clean = await status();
    expect([clean.scene.status, clean.routine.status, clean.automation.status]).toEqual(["synced", "synced", "synced"]);

    // Someone edits the scene's script in Home Assistant.
    const sceneObjectId = String(before.scene.entityId).replace("script.", "");
    const cfg = (await ha("GET", `/api/config/script/config/${sceneObjectId}`)).json;
    cfg.sequence[0].parallel[0].data.brightness_pct = 99;
    await ha("POST", `/api/config/script/config/${sceneObjectId}`, cfg);
    await callHa("script", "reload", {});
    // Someone switches the automation off.
    await callHa("automation", "turn_off", { entity_id: before.automation.entityId });
    await verify();
    const drifted = await status();
    expect(drifted.scene).toMatchObject({ status: "drifted", error: "It was changed in Home Assistant" });
    expect(drifted.automation).toMatchObject({ status: "drifted", error: "It was switched on or off in Home Assistant" });
    expect(drifted.routine.status).toBe("synced");
    expect((await admin.call("GET", "/admin/config-sync")).json.drifted).toBe(2);

    // Restoring puts both back.
    await admin.call("POST", "/admin/config-sync/resync");
    await pump();
    await until(async () => (await haState(before.automation.entityId)) === "on", "the automation to be switched back on");
    await verify();
    const restored = await status();
    expect([restored.scene.status, restored.automation.status]).toEqual(["synced", "synced"]);

    // Someone deletes the automation in Home Assistant.
    await ha("DELETE", `/api/config/automation/config/${before.automation.entityId ? (await ha("GET", `/api/states/${before.automation.entityId}`)).json.attributes.id : ""}`);
    await callHa("automation", "reload", {});
    await verify();
    expect((await status()).automation).toMatchObject({ status: "drifted", error: "It was removed from Home Assistant" });
    await admin.call("POST", "/admin/config-sync/resync");
    await pump();
    await verify();
    expect((await status()).automation.status).toBe("synced");
  });
});

