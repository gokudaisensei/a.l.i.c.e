import { beforeEach, describe, expect, test } from "bun:test";
import type { Browser } from "../testing/http";
import { changeState, createWorld, homeWithHa, type World } from "../testing/world";
import { FakeSocket } from "../testing/fake-socket";
import { WS_LIMITS } from "./hub";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
let n = 0;

/** Connects a signed-in browser's session to the hub through a fake socket. */
function attach(b: Browser, id = `sock${++n}`) {
  const token = b.cookie.split("=")[1]!;
  const session = w.services.auth.getSession(token)!;
  const membership = w.services.households.getMembership(session.userId)!;
  const socket = new FakeSocket(id);
  w.services.realtime.connect(socket, session, membership);
  return socket;
}
const say = (s: FakeSocket, msg: object) => w.services.realtime.receive(s.id, JSON.stringify(msg));
const sub = (s: FakeSocket, resource: string, id?: string) => say(s, { type: "subscribe", resource, id });
const thing = async (b: Browser, name: string) => (await b.call("GET", "/devices")).json.devices.find((d: any) => d.name === name);

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("protocol", () => {
  test("a new connection is greeted; ping/pong echoes the request id", () => {
    const s = attach(h.admin);
    expect(s.messages[0]).toMatchObject({ type: "hello", data: { role: "admin" } });
    say(s, { type: "ping", requestId: "r1" });
    expect(s.messages.at(-1)).toMatchObject({ type: "pong", requestId: "r1" });
  });

  test("bad input gets an error, never a crash", () => {
    const s = attach(h.admin);
    w.services.realtime.receive(s.id, "not json");
    say(s, { nope: 1 });
    say(s, { type: "dance" });
    say(s, { type: "subscribe", resource: "spaceship" });
    say(s, { type: "subscribe", resource: "area" });
    say(s, { type: "subscribe", resource: "devices", id: "x" });
    expect(s.of("error").map((m: any) => m.data.code)).toEqual(["bad_message", "bad_message", "unknown_message_type", "unknown_resource", "validation_error", "validation_error"]);
  });

  test("subscribe and unsubscribe are acknowledged with the request id", () => {
    const s = attach(h.admin);
    say(s, { type: "subscribe", resource: "devices", requestId: "a" });
    say(s, { type: "unsubscribe", resource: "devices", requestId: "b" });
    expect(s.messages.slice(1)).toMatchObject([{ type: "subscribed", requestId: "a" }, { type: "unsubscribed", requestId: "b" }]);
  });

  test("subscribing to a device you cannot see looks the same as one that does not exist", async () => {
    const guest = attach(await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 }));
    const echo = await thing(h.admin, "Echo Show");
    sub(guest, "device", echo.id);
    sub(guest, "device", "thing_nope");
    expect(guest.of("error").map((m: any) => m.data.code)).toEqual(["not_found", "not_found"]);
    const admin = attach(h.admin);
    sub(admin, "device", echo.id);
    expect(admin.types()).toContain("subscribed");
  });
});

describe("device updates", () => {
  test("an update carries the Thing, application-level values and the entity's role", async () => {
    const s = attach(h.admin);
    sub(s, "devices");
    const lamp = await thing(h.admin, "Floor lamp");
    changeState(w.gw, "light.floor_lamp", "on", { supported_color_modes: ["brightness"], brightness: 77 });
    expect(s.of("entity.updated")[0]).toMatchObject({ data: { thingId: lamp.id, entityId: "light.floor_lamp", role: "primary", availability: "available", values: { power: true, brightness: 30 } } });
  });

  test("nothing is sent without a subscription, after unsubscribing, or after disconnecting", () => {
    const s = attach(h.admin);
    changeState(w.gw, "switch.kettle_plug", "on");
    expect(s.of("entity.updated")).toHaveLength(0);
    sub(s, "devices");
    changeState(w.gw, "switch.kettle_plug", "off");
    expect(s.of("entity.updated")).toHaveLength(1);
    say(s, { type: "unsubscribe", resource: "devices" });
    changeState(w.gw, "switch.kettle_plug", "on");
    expect(s.of("entity.updated")).toHaveLength(1);
    sub(s, "devices");
    w.services.realtime.disconnect(s.id);
    changeState(w.gw, "switch.kettle_plug", "off");
    expect(s.of("entity.updated")).toHaveLength(1);
  });

  test("a device subscription only matches that Thing; an area subscription matches the area", async () => {
    const kettle = await thing(h.admin, "Kettle plug"); // kitchen
    const onlyKettle = attach(h.admin); sub(onlyKettle, "device", kettle.id);
    const kitchen = attach(h.admin); sub(kitchen, "area", "kitchen");
    const living = attach(h.admin); sub(living, "area", "living");
    changeState(w.gw, "switch.kettle_plug", "on");
    changeState(w.gw, "light.floor_lamp", "off");
    expect(onlyKettle.of("entity.updated").map((m: any) => m.data.entityId)).toEqual(["switch.kettle_plug"]);
    expect(kitchen.of("entity.updated").map((m: any) => m.data.entityId)).toEqual(["switch.kettle_plug"]);
    expect(living.of("entity.updated").map((m: any) => m.data.entityId)).toEqual(["light.floor_lamp"]);
  });

  test("a facet update carries its resolved meaning, including the user's 'on means'", async () => {
    await h.admin.call("PUT", "/entities/binary_sensor.echo_show_camera_shutter/role", { onMeans: "closed" });
    const s = attach(h.admin); sub(s, "devices");
    changeState(w.gw, "binary_sensor.echo_show_camera_shutter", "on");
    expect(s.of("entity.updated")[0]).toMatchObject({ data: { role: "facet", facet: { key: "privacy_shutter", value: "closed", name: "Camera shutter", ambiguous: false, sensitive: true } } });
  });

  test("availability changes are pushed as their own message", () => {
    const s = attach(h.admin); sub(s, "devices");
    changeState(w.gw, "switch.kettle_plug", "unavailable");
    expect(s.types()).toContain("entity.availability_changed");
    expect(s.of("entity.availability_changed")[0]).toMatchObject({ data: { entityId: "switch.kettle_plug", availability: "unavailable" } });
  });

  test("diagnostics and hidden devices are not pushed", async () => {
    const s = attach(h.admin); sub(s, "devices");
    changeState(w.gw, "sensor.echo_show_wifi_signal", "-70");
    expect(s.of("entity.updated")).toHaveLength(0);
    const lamp = await thing(h.admin, "Floor lamp");
    await h.admin.call("POST", `/devices/${lamp.id}/hide`);
    s.clear();
    changeState(w.gw, "light.floor_lamp", "off");
    expect(s.of("entity.updated")).toHaveLength(0);
  });
});

describe("who receives what", () => {
  test("a guest gets updates only for devices allowed to guests, and stops when the policy is removed", async () => {
    const guest = attach(await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 }));
    sub(guest, "devices");
    const p = (await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "switch.kettle_plug", subjectType: "role", subjectId: "guest", effect: "allow" })).json;
    expect(guest.of("devices.changed")[0]).toMatchObject({ data: { reason: "permissions" } });
    changeState(w.gw, "switch.kettle_plug", "on");
    changeState(w.gw, "light.floor_lamp", "off");
    expect(guest.of("entity.updated").map((m: any) => m.data.entityId)).toEqual(["switch.kettle_plug"]);
    await h.admin.call("DELETE", `/permissions/policies/${p.id}`);
    guest.clear();
    changeState(w.gw, "switch.kettle_plug", "off");
    expect(guest.of("entity.updated")).toHaveLength(0);
    expect(guest.of("devices.changed")).toHaveLength(0); // the notice for the delete was sent before the clear
  });

  test("a deny policy hides a device's updates from that member only", async () => {
    const meeraB = await h.join("Meera", { role: "member" });
    const meera = attach(meeraB); const admin = attach(h.admin);
    sub(meera, "devices"); sub(admin, "devices");
    const meeraId = (await meeraB.call("GET", "/users/me")).json.id;
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "light.floor_lamp", subjectType: "member", subjectId: meeraId, effect: "deny" });
    meera.clear(); admin.clear();
    changeState(w.gw, "light.floor_lamp", "off");
    expect(meera.of("entity.updated")).toHaveLength(0);
    expect(admin.of("entity.updated")).toHaveLength(1);
  });

  test("everyone sees device-list changes (rename, resync) as devices.changed", async () => {
    const s = attach(h.admin); sub(s, "devices");
    const lamp = await thing(h.admin, "Floor lamp");
    await h.admin.call("PATCH", `/devices/${lamp.id}/name`, { name: "Reading lamp" });
    expect(s.of("devices.changed").at(-1)).toMatchObject({ data: { reason: "overrides" } });
    await h.admin.call("POST", "/ha/connection/resync");
    expect(s.of("devices.changed").at(-1)).toMatchObject({ data: { reason: "inventory" } });
  });

  test("connection health goes to admins who follow the household, not to members", async () => {
    const admin = attach(h.admin); sub(admin, "household");
    const member = attach(await h.join("Meera", { role: "member" })); sub(member, "household");
    w.gw.setStatus("reconnecting");
    expect(admin.of("connection.disconnected")[0]).toMatchObject({ data: { connectionId: h.connectionId, status: "reconnecting" } });
    expect(member.of("connection.disconnected")).toHaveLength(0);
    w.gw.setStatus("connected");
    await Bun.sleep(20);
    expect(admin.types()).toContain("connection.connected");
  });
});

describe("commands", () => {
  test("a person gets their own command's lifecycle in public form; admins see everyone's; others see nothing", async () => {
    const meeraB = await h.join("Meera", { role: "member" });
    const arjunB = await h.join("Arjun", { role: "member" });
    const [admin, meera, arjun] = [attach(h.admin), attach(meeraB), attach(arjunB)];
    for (const s of [admin, meera, arjun]) sub(s, "commands");
    const lamp = await thing(h.admin, "Floor lamp");
    const res = await meeraB.call("POST", `/devices/${lamp.id}/commands`, { action: "turn_off" });
    await w.services.commands.done(res.json.id);
    const order = ["command.created", "command.authorized", "command.dispatched", "command.accepted", "command.confirmed"];
    expect(meera.types().filter((t) => t.startsWith("command."))).toEqual(order);
    expect(admin.types().filter((t) => t.startsWith("command."))).toEqual(order);
    expect(arjun.types().filter((t) => t.startsWith("command."))).toEqual([]);
    const last = meera.of("command.confirmed")[0]!.data as any;
    expect(last).toMatchObject({ id: res.json.id, state: "confirmed", entityId: "light.floor_lamp" });
    expect(last).not.toHaveProperty("haContextId");
    expect(last).not.toHaveProperty("connectionId");
  });

  test("Home Assistant's own error text is not forwarded to clients", async () => {
    const s = attach(h.admin); sub(s, "commands");
    w.gw.onCallService = () => { throw new Error("Unable to find service light.turn_on at http://192.168.1.5:8123 (token abc)"); };
    const lamp = await thing(h.admin, "Floor lamp");
    const res = await h.admin.call("POST", `/devices/${lamp.id}/commands`, { action: "turn_on" });
    await w.services.commands.done(res.json.id);
    const failed = s.of("command.failed")[0]!.data as any;
    expect(failed.failure).toEqual({ code: "ha_rejected", message: "Home Assistant refused the command" });
    expect(JSON.stringify(s.messages)).not.toContain("192.168");
    const rest = (await h.admin.call("GET", `/commands/${res.json.id}`)).json;
    expect(rest.failure.message).toBe("Home Assistant refused the command");
    expect(JSON.stringify(rest)).not.toContain("192.168");
  });
});

describe("limits and housekeeping", () => {
  test("sessions that end are dropped by the sweep; demotions take effect after the recheck window", async () => {
    const meeraB = await h.join("Meera", { role: "member" });
    const s = attach(meeraB); sub(s, "devices");
    const lamp = await thing(h.admin, "Floor lamp");
    const members = (await h.admin.call("GET", "/household/members")).json.members;
    await h.admin.call("PATCH", `/household/members/${members.find((m: any) => m.displayName === "Meera").id}`, { role: "guest" });
    changeState(w.gw, "light.floor_lamp", "off");
    expect(s.of("entity.updated")).toHaveLength(1); // role still cached for a moment
    w.clock.now += WS_LIMITS.recheckMs + 1;
    changeState(w.gw, "light.floor_lamp", "on");
    expect(s.of("entity.updated")).toHaveLength(1); // now a guest with no allow, so nothing more
    expect(lamp).toBeDefined();
    await meeraB.call("POST", "/auth/logout");
    w.services.realtime.sweep();
    expect(s.closed).toMatchObject({ code: 4401 });
    expect(w.services.realtime.connectionCount).toBe(0);
  });

  test("a user cannot hold more than 10 connections", () => {
    const sockets = Array.from({ length: WS_LIMITS.connectionsPerUser + 1 }, () => attach(h.admin));
    expect(sockets.at(-1)!.closed).toMatchObject({ code: 4429 });
    expect(sockets.slice(0, -1).every((s) => s.closed === null)).toBe(true);
    expect(w.services.realtime.connectionCount).toBe(WS_LIMITS.connectionsPerUser);
  });

  test("at most 50 subscriptions, and message flooding is answered with rate_limited", () => {
    const s = attach(h.admin);
    for (let i = 0; i < WS_LIMITS.subscriptions; i++) sub(s, "area", `a${i}`);
    sub(s, "area", "one-too-many");
    expect(s.of("error").at(-1)).toMatchObject({ data: { code: "too_many_subscriptions" } });
    const flood = attach(h.admin);
    for (let i = 0; i < WS_LIMITS.messages.limit + 5; i++) say(flood, { type: "ping" });
    expect(flood.of("error").length).toBeGreaterThan(0);
    expect((flood.of("error")[0] as any).data.code).toBe("rate_limited");
  });

  test("shutdown closes every socket with 1001", () => {
    const a = attach(h.admin); const b = attach(h.admin);
    w.services.realtime.closeAll();
    expect([a.closed, b.closed]).toEqual([{ code: 1001, reason: "Server shutting down" }, { code: 1001, reason: "Server shutting down" }]);
    expect(w.services.realtime.connectionCount).toBe(0);
  });

  test("a client that cannot keep up is dropped instead of buffered forever", () => {
    const s = attach(h.admin); sub(s, "devices");
    s.buffered = WS_LIMITS.maxBuffered + 1;
    changeState(w.gw, "switch.kettle_plug", "on");
    expect(s.closed).toMatchObject({ code: 1013 });
    expect(w.services.realtime.connectionCount).toBe(0);
  });
});

