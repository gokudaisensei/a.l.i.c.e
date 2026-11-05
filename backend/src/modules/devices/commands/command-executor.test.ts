import { beforeEach, describe, expect, test } from "bun:test";
import pino from "pino";
import type { AppEvent } from "@/core/events/app-events";
import { InMemoryEventBus } from "@/core/events/event-bus";
import { ConnectionManager } from "@/modules/home-assistant";
import { FakeGateway, state } from "@/modules/home-assistant/testing";
import type { HaServiceCallInput } from "@/modules/home-assistant/types";
import type { Authorizer } from "./authorizer";
import { CommandExecutor } from "./command-executor";
import type { Actor, CommandInput } from "./command-types";

const H = "h1";
const user: Actor = { userId: "u1", source: "user" };
const dimmable = { supported_color_modes: ["brightness"], friendly_name: "A" };

async function env(authorizer?: Authorizer) {
  const gw = new FakeGateway();
  gw.states = [
    state("light.a", "off", { ...dimmable, brightness: null }),
    state("light.plain", "off", { supported_color_modes: ["onoff"] }),
    state("switch.s", "off"),
    state("lock.front", "locked"),
    state("cover.c", "closed", { supported_features: 3 }),
    state("light.gone", "unavailable"),
    state("scene.movie", "unknown"),
  ];
  const bus = new InMemoryEventBus<AppEvent>();
  const log = pino({ level: "silent" });
  const manager = new ConnectionManager(() => gw, bus, log);
  await manager.add({ id: "c1", householdId: H, baseUrl: "http://x", token: "t" });
  const events: AppEvent[] = [];
  bus.subscribeAll((e) => events.push(e));
  const exec = new CommandExecutor({ manager, bus, log, authorizer });
  const run = (over: Partial<CommandInput>) => {
    const c = exec.submit({ householdId: H, entityId: "light.a", action: "turn_on", actor: user, confirmTimeoutMs: 200, ...over });
    return exec.done(c.id);
  };
  const lifecycle = (id: string) => events.filter((e) => e.type.startsWith("command.") && (e as { command: { id: string } }).command.id === id).map((e) => e.type.replace("command.", ""));
  /** Simulate HA: apply a state change for the entity being called. */
  const react = (fn: (call: HaServiceCallInput) => void) => { gw.onCallService = fn; };
  return { gw, exec, run, events, lifecycle, react, manager };
}

let e: Awaited<ReturnType<typeof env>>;
beforeEach(async () => { e = await env(); });

describe("happy path", () => {
  test("turn_on goes pending → authorized → dispatched → accepted → confirmed", async () => {
    e.react(() => e.gw.emitState(state("light.a", "on", { ...dimmable, brightness: 255 }), state("light.a", "off")));
    const c = await e.run({});
    expect(c).toMatchObject({ state: "confirmed", confirmedBy: "state", connectionId: "c1", haContextId: "ctx-1", requestedState: { power: true } });
    expect(c.actualState).toMatchObject({ power: true, brightness: 100 });
    expect(e.lifecycle(c.id)).toEqual(["created", "authorized", "dispatched", "accepted", "confirmed"]);
    expect(e.gw.calls[0]).toMatchObject({ domain: "light", service: "turn_on", target: { entity_id: "light.a" } });
  });

  test("set_brightness 30% is confirmed by HA's 0-255 value (77 → 30%)", async () => {
    e.react(() => e.gw.emitState(state("light.a", "on", { ...dimmable, brightness: 77 }), state("light.a", "off")));
    const c = await e.run({ action: "set_brightness", parameters: { brightness_pct: 30 } });
    expect(c.state).toBe("confirmed");
    expect(e.gw.calls[0]!.data).toEqual({ brightness_pct: 30 });
  });

  test("toggle expects the opposite of the state before", async () => {
    e.react(() => e.gw.emitState(state("switch.s", "on"), state("switch.s", "off")));
    expect((await e.run({ entityId: "switch.s", action: "toggle" })).state).toBe("confirmed");
  });

  test("already in the desired state: HA is still told, but no change is awaited", async () => {
    const c = await e.run({ entityId: "lock.front", action: "lock" });
    expect(c).toMatchObject({ state: "confirmed", confirmedBy: "already" });
    expect(e.gw.calls).toHaveLength(1);
  });

  test("operations with nothing to observe (scene) confirm once HA accepts", async () => {
    const c = await e.run({ entityId: "scene.movie", action: "activate" });
    expect(c).toMatchObject({ state: "confirmed", confirmedBy: "unobservable", requestedState: null });
  });
});

describe("confirmation is by desired state, not the next event", () => {
  test("someone else reaching the desired state still confirms (physical press)", async () => {
    e.react(() => e.gw.emitState(state("switch.s", "on"), state("switch.s", "off"))); // context differs from the command's
    const c = await e.run({ entityId: "switch.s", action: "turn_on" });
    expect(c.state).toBe("confirmed");
  });

  test("an unrelated change does not confirm; it times out", async () => {
    e.react(() => e.gw.emitState(state("light.a", "on", { ...dimmable, brightness: 255 }), state("light.a", "off"))); // on, but we asked for 30%... 
    const c = await e.run({ action: "set_brightness", parameters: { brightness_pct: 30 } });
    expect(c.state).toBe("timed_out");
    expect(c.failure?.code).toBe("not_confirmed");
    expect(c.actualState).toMatchObject({ brightness: 100 });
    expect(e.lifecycle(c.id).slice(-2)).toEqual(["accepted", "timed_out"]);
  });

  test("accepted but nothing happens: times out", async () => {
    const c = await e.run({ entityId: "switch.s", action: "turn_on" });
    expect(c.state).toBe("timed_out");
  });

  test("a change that arrives after HA's reply but before the timeout confirms", async () => {
    e.react(() => { setTimeout(() => e.gw.emitState(state("switch.s", "on"), state("switch.s", "off")), 30); });
    expect((await e.run({ entityId: "switch.s", action: "turn_on" })).state).toBe("confirmed");
  });
});

describe("failures", () => {
  test("HA rejects the service call", async () => {
    e.react(() => { throw new Error("service not found"); });
    const c = await e.run({});
    expect(c).toMatchObject({ state: "failed", failure: { code: "ha_rejected", message: "service not found" } });
    expect(e.lifecycle(c.id)).toEqual(["created", "authorized", "dispatched", "failed"]);
  });

  test("unknown entity, unsupported operation, bad parameters, unavailable device: fail before dispatch", async () => {
    expect((await e.run({ entityId: "light.nope" })).failure?.code).toBe("unknown_entity");
    expect((await e.run({ entityId: "light.plain", action: "set_brightness", parameters: { brightness_pct: 50 } })).failure?.code).toBe("unsupported_operation");
    expect((await e.run({ action: "set_brightness", parameters: { brightness_pct: 500 } })).failure?.code).toBe("invalid_parameters");
    expect((await e.run({ action: "set_brightness" })).failure?.code).toBe("invalid_parameters");
    expect((await e.run({ entityId: "light.gone" })).failure?.code).toBe("device_unavailable");
    expect(e.gw.calls).toHaveLength(0);
  });

  test("household scoping: another household cannot see the entity", async () => {
    expect((await e.run({ householdId: "other" })).failure?.code).toBe("unknown_entity");
  });

  test("HA not connected", async () => {
    e.gw.setStatus("reconnecting");
    expect((await e.run({})).failure?.code).toBe("ha_unreachable");
    expect(e.gw.calls).toHaveLength(0);
  });
});

describe("authorization", () => {
  test("a denied request never reaches HA", async () => {
    const denied = await env({ authorize: async () => ({ allowed: false, reason: "guests cannot control this" }) });
    const c = await denied.run({});
    expect(c).toMatchObject({ state: "failed", failure: { code: "forbidden", message: "guests cannot control this" } });
    expect(denied.gw.calls).toHaveLength(0);
    expect(denied.lifecycle(c.id)).toEqual(["created", "failed"]);
  });

  test("unlock needs a step-up; lock does not", async () => {
    e.react(() => e.gw.emitState(state("lock.front", "unlocked"), state("lock.front", "locked")));
    const no = await e.run({ entityId: "lock.front", action: "unlock" });
    expect(no.failure?.code).toBe("step_up_required");
    expect(e.gw.calls).toHaveLength(0);
    const yes = await e.run({ entityId: "lock.front", action: "unlock", actor: { ...user, steppedUp: true } });
    expect(yes.state).toBe("confirmed");
  });

  test("the AI source is held to the same step-up rule", async () => {
    const c = await e.run({ entityId: "lock.front", action: "unlock", actor: { userId: "u1", source: "ai" } });
    expect(c.failure?.code).toBe("step_up_required");
  });
});

describe("cancel", () => {
  test("cancelling while authorization is pending stops the command before dispatch", async () => {
    let release!: () => void;
    const slow = await env({ authorize: () => new Promise((r) => { release = () => r({ allowed: true }); }) });
    const c = slow.exec.submit({ householdId: H, entityId: "light.a", action: "turn_on", actor: user });
    slow.exec.cancel(c.id);
    release();
    const final = await slow.exec.done(c.id);
    expect(final.state).toBe("cancelled");
    expect(slow.gw.calls).toHaveLength(0);
    expect(slow.lifecycle(c.id)).toEqual(["created", "cancelled"]);
  });

  test("a dispatched or finished command cannot be cancelled", async () => {
    e.react(() => e.gw.emitState(state("switch.s", "on"), state("switch.s", "off")));
    const c = await e.run({ entityId: "switch.s", action: "turn_on" });
    expect(() => e.exec.cancel(c.id)).toThrow(/Cannot cancel/);
  });
});

describe("store and queries", () => {
  test("get and list return what ran, newest first", async () => {
    e.react(() => e.gw.emitState(state("switch.s", "on"), state("switch.s", "off")));
    const a = await e.run({ entityId: "switch.s", action: "turn_on" });
    const b = await e.run({ entityId: "light.nope" });
    expect(e.exec.get(a.id)?.state).toBe("confirmed");
    expect(e.exec.list({ householdId: H }).map((c) => c.id)).toEqual([b.id, a.id]);
    expect(e.exec.list({ state: "failed" }).map((c) => c.id)).toEqual([b.id]);
  });
});
