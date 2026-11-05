import { randomBytes } from "node:crypto";
import { buildApp } from "@/app";
import { createTestDb } from "@/core/database/client";
import { HaAuthError } from "@/modules/home-assistant/clients/ha-ws-gateway";
import { FakeGateway, state } from "@/modules/home-assistant/testing";
import { homeRaw } from "@/modules/home-assistant/things/fixtures/home";
import type { HaEntityState } from "@/modules/home-assistant/types";
import { createServices } from "@/services";
import { Browser } from "./http";

export const SECRETS_KEY = randomBytes(32).toString("base64");
export const HA_TOKEN = "fake-long-lived-token-1234567890";
export const MIN = 60_000;

/** A fake Home Assistant loaded with the Echo/plug/lamp/lock fixture. It reacts to on/off, brightness and lock/unlock. */
export function fakeHa() {
  const g = new FakeGateway();
  const raw = homeRaw();
  g.states = [...raw.states, state("lock.front_door", "locked", { friendly_name: "Front door", device_class: "door" })];
  g.areas = raw.areas; g.devices = raw.devices; g.entityRegistry = raw.entityRegistry;
  g.onCallService = (call) => {
    const id = (call.target?.entity_id as string) ?? "";
    const prev = g.states.find((s) => s.entity_id === id);
    if (!prev) throw new Error(`unknown entity ${id}`);
    let next: HaEntityState | null = null;
    if (call.service === "turn_on" || call.service === "turn_off") {
      const attrs = { ...prev.attributes };
      if (call.data?.brightness_pct) attrs.brightness = Math.round(Number(call.data.brightness_pct) * 2.55);
      next = state(id, call.service === "turn_on" ? "on" : "off", attrs);
    } else if (call.service === "unlock" || call.service === "lock") next = state(id, call.service === "unlock" ? "unlocked" : "locked", prev.attributes);
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
export function createWorld() {
  const clock = { now: 1_700_000_000_000 };
  const db = createTestDb();
  const gw = fakeHa();
  const services = createServices(db, {
    now: () => clock.now, secretsKey: SECRETS_KEY,
    auth: { rpId: "localhost", rpName: "Alice", origin: "http://localhost:3000", sessionTtlHours: 24 },
    gatewayFactory: (cfg) => {
      if (cfg.token.startsWith("bad-")) { const b = new FakeGateway(); b.connectFailures = [new HaAuthError()]; return b; }
      return gw;
    },
  });
  const app = buildApp(services);
  const browser = () => new Browser(app);
  return { clock, db, gw, services, app, browser };
}
export type World = ReturnType<typeof createWorld>;

/** An admin who registered and connected Home Assistant, plus helpers to add a member and a guest. */
export async function homeWithHa(w: World) {
  const admin = w.browser();
  await admin.register("Gokul");
  await admin.call("PUT", "/ha/connection", { baseUrl: "http://homeassistant.local:8123", token: HA_TOKEN });
  const connectionId = (await admin.call("GET", "/ha/connection")).json.id as string;
  const join = async (name: string, body: object) => {
    const inv = await admin.call("POST", "/household/invitations", body);
    const b = w.browser();
    await b.register(name, inv.json.code);
    return b;
  };
  return { admin, connectionId, join };
}
