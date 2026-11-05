import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AvailableUpdate } from "@/modules/updates/sources";
import pino from "pino";
import { generateSealKeyPair } from "@/core/security/sealed";
import { ConfigWorker } from "@/worker/config-worker";
import { FakeConfigApi } from "./fake-config-api";
import { MODE_HELPER_ENTITY } from "@/modules/home-assistant/config-ops";
import { buildApp } from "@/app";
import { createTestDb } from "@/core/database/client";
import { HaAuthError } from "@/modules/home-assistant/clients/ha-ws-gateway";
import { FakeGateway, state } from "@/modules/home-assistant/testing";
import { homeRaw } from "@/modules/home-assistant/things/fixtures/home";
import type { HaEntityState } from "@/modules/home-assistant/types";
import { createServices } from "@/services";
import { Browser } from "./http";
import type { AppEvent } from "@/core/events/app-events";
import { InMemoryEventBus } from "@/core/events/event-bus";

export const SECRETS_KEY = randomBytes(32).toString("base64");
/** One key pair for the whole test run (generating RSA keys takes a moment). */
export const SEAL_KEYS = generateSealKeyPair();
export const BACKUP_KEY = randomBytes(32).toString("base64");
export const ADMIN_TOKEN = "admin-token-1234567890";
export const HA_TOKEN = "fake-long-lived-token-1234567890";
export const MIN = 60_000;

/** A fake Home Assistant loaded with the Echo/plug/lamp/lock fixture. It reacts to on/off, brightness and lock/unlock. */
export function fakeHa() {
  const g = new FakeGateway();
  const raw = homeRaw();
  g.states = [
    ...raw.states,
    state("lock.front_door", "locked", { friendly_name: "Front door", device_class: "door" }),
    state("person.gokul", "home", { friendly_name: "Gokul" }),
    state("person.meera", "home", { friendly_name: "Meera" }),
  ];
  g.areas = raw.areas; g.devices = raw.devices;
  // Two devices get an energy meter (kWh), for energy tests.
  const meter = (entity_id: string, device_id: string, name: string) => ({ entity_id, device_id, area_id: null, platform: "test", has_entity_name: true, original_name: name });
  g.entityRegistry = [...raw.entityRegistry, meter("sensor.kettle_plug_energy", "kettle", "Energy"), meter("sensor.floor_lamp_energy", "floor", "Energy")];
  g.states.push(
    state("sensor.kettle_plug_energy", "12.5", { friendly_name: "Kettle plug Energy", device_class: "energy", unit_of_measurement: "kWh", state_class: "total_increasing" }),
    state("sensor.floor_lamp_energy", "40000", { friendly_name: "Floor lamp Energy", device_class: "energy", unit_of_measurement: "Wh", state_class: "total_increasing" }),
  );
  g.onCallService = (call) => {
    const id = (call.target?.entity_id as string) ?? "";
    const prev = g.states.find((s) => s.entity_id === id);
    if (!prev) throw new Error(`unknown entity ${id}`);
    let next: HaEntityState | null = null;
    if (call.service === "turn_on" || call.service === "turn_off") {
      const attrs = { ...prev.attributes };
      if (call.data?.brightness_pct) attrs.brightness = Math.round(Number(call.data.brightness_pct) * 2.55);
      next = state(id, call.service === "turn_on" ? "on" : "off", attrs);
    } else if (call.service === "select_option") next = state(id, String(call.data?.option), prev.attributes);
    else if (call.service === "set_value") next = state(id, String(call.data?.value), prev.attributes);
    else if (call.service === "unlock" || call.service === "lock") next = state(id, call.service === "unlock" ? "unlocked" : "locked", prev.attributes);
    if (!next) return;
    g.states = g.states.map((s) => (s.entity_id === id ? next! : s));
    g.emitState(next, prev);
  };
  return g;
}

/** Sets the state in the fake HA and announces it, like a real device change would. */
export function changeState(g: FakeGateway, entityId: string, newState: string, attrs?: Record<string, unknown>) {
  const prev = g.states.find((s) => s.entity_id === entityId)!;
  const next = state(entityId, newState, attrs ?? prev.attributes);
  g.states = g.states.map((s) => (s.entity_id === entityId ? next : s));
  g.emitState(next, prev);
}

/** A complete Alice (services + HTTP app) over a fake Home Assistant, with a controllable clock. */
export function createWorld(opts: { sleep?: Parameters<typeof createServices>[1] extends infer O ? (O extends { sleep?: infer S } ? S : never) : never } = {}) {
  const clock = { now: 1_700_000_000_000 };
  const db = createTestDb();
  const gw = fakeHa();
  const updateFake = { latest: null as AvailableUpdate | null, requested: [] as string[], installError: null as Error | null, sourceError: null as Error | null };
  const backupDir = mkdtempSync(join(tmpdir(), "alice-test-backups-"));
  const services = createServices(db, {
    bus: new InMemoryEventBus<AppEvent>(), // each test world has its own bus, so worlds cannot hear each other
    now: () => clock.now, secretsKey: SECRETS_KEY, sleep: opts.sleep, backupDir, backupKey: BACKUP_KEY, currentVersion: "0.1.0",
    updateSource: { latest: async () => { if (updateFake.sourceError) throw updateFake.sourceError; return updateFake.latest; } },
    updateInstaller: { request: async (v) => { if (updateFake.installError) throw updateFake.installError; updateFake.requested.push(v); } }, dbPath: null, adminSealPublicKey: SEAL_KEYS.publicKey,
    auth: { rpId: "localhost", rpName: "Alice", origin: "http://localhost:3000", sessionTtlHours: 24 },
    gatewayFactory: (cfg) => {
      if (cfg.token.startsWith("bad-")) { const b = new FakeGateway(); b.connectFailures = [new HaAuthError()]; return b; }
      if (cfg.id === "test") return new FakeGateway(); // credential checks use their own short-lived connection, as in real life
      return gw;
    },
  });
  const app = buildApp(services);
  const browser = () => new Browser(app);
  /** The config-worker, over a fake Home Assistant admin API. Run `await w.sync()` to let it work and apply the results. */
  const configApi = new FakeConfigApi();
  configApi.onEnsureModeSelect = () => {
    if (gw.states.some((x) => x.entity_id === MODE_HELPER_ENTITY)) return;
    const helper = state(MODE_HELPER_ENTITY, "home", { options: ["home", "away", "night", "vacation"], friendly_name: "Alice household mode" });
    gw.states = [...gw.states, helper];
    gw.emitState(helper, null); // a new entity appears with no previous state
  };
  const worker = new ConfigWorker({ db, privateKeyPem: SEAL_KEYS.privateKey, apiFactory: () => configApi, log: pino({ level: "silent" }), now: () => clock.now, retryDelayMs: 0 });
  const sync = async () => { await worker.drain(); services.configJobs.applyResults(); };
  return { clock, db, gw, backupDir, updateFake, services, app, browser, configApi, worker, sync };
}
export type World = ReturnType<typeof createWorld>;

/** An admin who registered and connected Home Assistant, plus helpers to add a member and a guest. */
export async function homeWithHa(w: World) {
  const admin = w.browser();
  await admin.register("Gokul");
  await admin.call("PUT", "/ha/connection", { baseUrl: "http://homeassistant.local:8123", token: HA_TOKEN });
  const connectionId = (await admin.call("GET", "/ha/connection")).json.id as string;
  const withAdminToken = async () => admin.call("PUT", "/ha/connection/admin-token", { token: ADMIN_TOKEN });
  const join = async (name: string, body: object) => {
    const inv = await admin.call("POST", "/household/invitations", body);
    const b = w.browser();
    await b.register(name, inv.json.code);
    return b;
  };
  return { admin, connectionId, join, withAdminToken };
}
