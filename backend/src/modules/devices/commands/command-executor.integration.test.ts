/** Runs against the mock HA (bun run ha:up && bun run ha:bootstrap). Skipped when HA_TOKEN is not set. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pino from "pino";
import type { AppEvent } from "../../../core/events/app-events";
import { InMemoryEventBus } from "../../../core/events/event-bus";
import { ConnectionManager, HaWebSocketGateway } from "../../home-assistant";
import { CommandExecutor } from "./command-executor";

const url = process.env.HA_URL;
const token = process.env.HA_TOKEN;
const run = url && token ? describe : describe.skip;

run("CommandExecutor against the mock Home Assistant", () => {
  const bus = new InMemoryEventBus<AppEvent>();
  const log = pino({ level: "silent" });
  const manager = new ConnectionManager((c) => new HaWebSocketGateway(c), bus, log);
  const exec = new CommandExecutor({ manager, bus, log });
  const actor = { userId: "u1", source: "user" as const };
  const go = (entityId: string, action: string, parameters?: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const c = exec.submit({ householdId: "h", entityId, action, parameters, actor, ...extra });
    return exec.done(c.id);
  };
  const cache = () => manager.get("it")!.cache;

  beforeAll(async () => {
    await manager.add({ id: "it", householdId: "h", baseUrl: url!, token: token! });
  }, 30_000);
  afterAll(() => manager.stopAll());

  test("switching a helper on and off is confirmed by the observed state, with HA's context id", async () => {
    const id = "input_boolean.test_switch";
    const first = await go(id, "turn_on");
    const second = await go(id, "turn_off");
    expect([first.state, second.state]).toEqual(["confirmed", "confirmed"]);
    expect(first.haContextId).toBeTruthy();
    expect(cache().get(id)!.state).toBe("off");
  });

  test("toggle flips whatever the state was", async () => {
    const id = "input_boolean.test_switch_2";
    const was = cache().get(id)!.state;
    const c = await go(id, "toggle");
    expect(c.state).toBe("confirmed");
    expect(cache().get(id)!.state).toBe(was === "on" ? "off" : "on");
  });

  test("set_brightness in percent is confirmed against HA's 0-255 value", async () => {
    const id = "light.bed_light";
    const pct = cache().get(id)!.normalized.brightness === 45 ? 55 : 45;
    const c = await go(id, "set_brightness", { brightness_pct: pct });
    expect(c.state).toBe("confirmed");
    expect(c.actualState).toMatchObject({ power: true, brightness: pct });
  });

  test("unlocking needs a step-up; with one the lock really unlocks and locks again", async () => {
    const id = "lock.front_door";
    if (cache().get(id)!.state !== "locked") await go(id, "lock", undefined, { actor: { ...actor, steppedUp: true } });
    expect((await go(id, "unlock")).failure?.code).toBe("step_up_required");
    const unlocked = await go(id, "unlock", undefined, { actor: { ...actor, steppedUp: true }, confirmTimeoutMs: 20_000 });
    expect(unlocked.state).toBe("confirmed");
    const locked = await go(id, "lock", undefined, { confirmTimeoutMs: 20_000 });
    expect(locked.state).toBe("confirmed");
  }, 60_000);

  test("a value HA refuses is reported as ha_rejected", async () => {
    const c = await go("input_number.test_level", "set_value", { value: 500 });
    expect(c).toMatchObject({ state: "failed", failure: { code: "ha_rejected" } });
  });

  test("every step of a command is on the bus in order", async () => {
    const seen: string[] = [];
    const off = bus.subscribeAll((e) => { if (e.type.startsWith("command.")) seen.push(e.type); });
    const c = exec.submit({ householdId: "h", entityId: "input_boolean.test_switch", action: "turn_on", actor });
    await exec.done(c.id);
    off();
    expect(seen).toEqual(["command.created", "command.authorized", "command.dispatched", "command.accepted", "command.confirmed"]);
    await go("input_boolean.test_switch", "turn_off");
  });
});
