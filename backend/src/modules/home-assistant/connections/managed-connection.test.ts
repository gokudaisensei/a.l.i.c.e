import { describe, expect, test } from "bun:test";
import pino from "pino";
import type { AppEvent } from "../../../core/events/app-events";
import { InMemoryEventBus } from "../../../core/events/event-bus";
import { HaAuthError } from "../clients/ha-ws-gateway";
import { FakeGateway, state } from "../testing";
import { Backoff } from "./backoff";
import { ManagedConnection } from "./managed-connection";

const log = pino({ level: "silent" });
const config = { id: "c1", householdId: "h1", baseUrl: "http://x", token: "t" };
const fast = () => new Backoff({ baseMs: 1, maxMs: 2, jitter: 0 });
const setup = () => {
  const gw = new FakeGateway();
  const bus = new InMemoryEventBus<AppEvent>();
  const events: AppEvent[] = [];
  bus.subscribeAll((e) => events.push(e));
  return { gw, events, conn: new ManagedConnection(config, gw, bus, log, fast()) };
};
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("ManagedConnection", () => {
  test("connects, syncs inventory and cache, publishes connected", async () => {
    const { gw, conn, events } = setup();
    gw.states = [state("light.a", "on")];
    await conn.start();
    expect(conn.cache.get("light.a")?.state).toBe("on");
    expect(conn.inventory?.entities).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(["inventory.synced", "connection.connected"]);
  });

  test("retries transient connect failures with backoff", async () => {
    const { gw, conn } = setup();
    gw.connectFailures = [new Error("down"), new Error("down")];
    await conn.start();
    expect(gw.connectAttempts).toBe(3);
  });

  test("a rejected token is not retried", async () => {
    const { gw, conn, events } = setup();
    gw.connectFailures = [new HaAuthError()];
    await expect(conn.start()).rejects.toBeInstanceOf(HaAuthError);
    expect(gw.connectAttempts).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: "connection.disconnected" });
  });

  test("live state changes update the cache and publish events", async () => {
    const { gw, conn, events } = setup();
    gw.states = [state("light.a", "off")];
    await conn.start();
    gw.emitState(state("light.a", "on"), state("light.a", "off"));
    expect(conn.cache.get("light.a")?.state).toBe("on");
    expect(events.at(-1)).toMatchObject({ type: "entity.state_changed", currentState: "on" });
    gw.emitState(null, state("light.a", "on"));
    expect(conn.cache.get("light.a")).toBeUndefined();
  });

  test("registry updates trigger a debounced resync", async () => {
    const { gw, conn, events } = setup();
    await conn.start();
    gw.states = [state("light.new", "on")];
    gw.emitEvent("entity_registry_updated");
    gw.emitEvent("device_registry_updated");
    await tick(700);
    expect(conn.cache.get("light.new")).toBeDefined();
    expect(events.filter((e) => e.type === "inventory.synced")).toHaveLength(2); // initial + one debounced
  });

  test("reconnect publishes disconnected, then reconciles state and reports connected", async () => {
    const { gw, conn, events } = setup();
    gw.states = [state("light.a", "off")];
    await conn.start();
    gw.setStatus("reconnecting");
    gw.states = [state("light.a", "on")]; // changed while offline
    gw.setStatus("connected");
    await tick(20);
    expect(conn.cache.get("light.a")?.state).toBe("on");
    const types = events.map((e) => e.type);
    expect(types).toContain("connection.disconnected");
    expect(types.at(-1)).toBe("connection.connected");
  });

  test("stop prevents further work", async () => {
    const { gw, conn } = setup();
    await conn.start();
    await conn.stop();
    expect(gw.status()).toBe("disconnected");
  });
});
