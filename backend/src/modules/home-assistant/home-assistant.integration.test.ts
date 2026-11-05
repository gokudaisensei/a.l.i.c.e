/** Runs against the mock HA (bun run ha:up && bun run ha:bootstrap). Skipped when HA_TOKEN is not set. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pino from "pino";
import type { AppEvent } from "@/core/events/app-events";
import { InMemoryEventBus } from "@/core/events/event-bus";
import { HaWebSocketGateway } from "./clients/ha-ws-gateway";
import { ConnectionManager } from "./connections/connection-manager";
import { resolveOperation } from "./capabilities/capability-detector";

const url = process.env.HA_URL;
const token = process.env.HA_TOKEN;
const run = url && token ? describe : describe.skip;

run("Home Assistant (mock instance)", () => {
  const bus = new InMemoryEventBus<AppEvent>();
  const events: AppEvent[] = [];
  bus.subscribeAll((e) => events.push(e));
  const manager = new ConnectionManager((c) => new HaWebSocketGateway(c), bus, pino({ level: "silent" }));
  let conn: Awaited<ReturnType<ConnectionManager["add"]>>;

  beforeAll(async () => {
    conn = await manager.add({ id: "it", householdId: "h", baseUrl: url!, token: token! });
  }, 30_000);
  afterAll(() => manager.stopAll());

  test("discovers entities with capabilities", () => {
    const inv = conn.inventory!;
    expect(inv.entities.length).toBeGreaterThan(50);
    const sw = inv.entities.find((e) => e.entityId === "input_boolean.test_switch")!;
    expect(sw.capabilities[0]).toMatchObject({ name: "power", controllable: true });
    const lights = inv.entities.filter((e) => e.domain === "light");
    expect(lights.length).toBeGreaterThan(0);
    expect(inv.areas.length + inv.devices.length).toBeGreaterThan(0);
  });

  test("a service call changes state, and the cache and bus observe it", async () => {
    const before = conn.cache.get("input_boolean.test_switch")!.state;
    const want = before === "on" ? "off" : "on";
    const call = resolveOperation("input_boolean", want === "on" ? "turn_on" : "turn_off")!;
    const { contextId } = await conn.gateway.callService({ domain: call.domain, service: call.service, target: { entity_id: "input_boolean.test_switch" } });
    const deadline = Date.now() + 5000;
    while (conn.cache.get("input_boolean.test_switch")!.state !== want && Date.now() < deadline) await Bun.sleep(50);
    expect(conn.cache.get("input_boolean.test_switch")!.state).toBe(want);
    const ev = events.find((e) => e.type === "entity.state_changed" && e.entityId === "input_boolean.test_switch" && e.context.id === contextId);
    expect(ev).toBeDefined(); // the HA context id lets us correlate a command with its state change
  });

  test("brightness set as 30% is observed as 30% in the normalized event and the cache", async () => {
    const id = "light.bed_light";
    const { contextId } = await conn.gateway.callService({ ...resolveOperation("light", "set_brightness", { brightness_pct: 30 })!, target: { entity_id: id } });
    const deadline = Date.now() + 5000;
    const find = () => events.find((e) => e.type === "entity.state_changed" && e.entityId === id && e.context.id === contextId);
    while (!find() && Date.now() < deadline) await Bun.sleep(50);
    expect(find()).toMatchObject({ normalized: { power: true, brightness: 30 } });
    expect(conn.cache.get(id)!.normalized.brightness).toBe(30);
    expect(conn.cache.get(id)!.attributes.brightness).toBe(76); // raw HA scale is still available
  });

  test("a bad token is rejected without retrying forever", async () => {
    const m = new ConnectionManager((c) => new HaWebSocketGateway(c), bus, pino({ level: "silent" }));
    await expect(m.add({ id: "bad", householdId: "h", baseUrl: url!, token: "nope" })).rejects.toThrow(/token/);
  });
});
