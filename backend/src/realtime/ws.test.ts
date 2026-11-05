import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { changeState, createWorld, homeWithHa, type World } from "@/testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
let port: number;

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
  w.app.listen(0);
  port = w.app.server!.port!;
});
// Bun's server.stop() can hang after the server itself closed a socket (seen with an in-process client), so do not wait on it.
afterEach(async () => { await Promise.race([w.app.stop(true), Bun.sleep(300)]); });

/** A real WebSocket client with a message log. */
function open(cookie: string | null) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`, cookie ? ({ headers: { cookie } } as never) : undefined);
  const messages: any[] = [];
  let closed: { code: number } | null = null;
  ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
  ws.onclose = (e) => { closed = { code: e.code }; };
  const waitFor = async (pred: (m: any[]) => boolean, ms = 2000) => {
    const end = Date.now() + ms;
    while (!pred(messages) && Date.now() < end) await Bun.sleep(10);
    if (!pred(messages)) throw new Error(`timed out; got ${JSON.stringify(messages.map((m) => m.type))}`);
  };
  return { ws, messages, waitFor, get closed() { return closed; } };
}

describe("the /ws endpoint", () => {
  test("a connection without a session is refused at the upgrade, with a 401", async () => {
    const res = await fetch(`http://localhost:${port}/ws`, { headers: { upgrade: "websocket", connection: "Upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" } });
    expect(res.status).toBe(401);
    expect(w.services.realtime.connectionCount).toBe(0);
  });

  test("an unknown or expired session cookie is refused too", async () => {
    const res = await fetch(`http://localhost:${port}/ws`, { headers: { cookie: "alice_session=garbage", upgrade: "websocket", connection: "Upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" } });
    expect(res.status).toBe(401);
  });

  test("a signed-in client gets hello, can subscribe, and receives live updates over a real socket", async () => {
    const c = open(h.admin.cookie);
    await c.waitFor((m) => m.some((x) => x.type === "hello"));
    c.ws.send(JSON.stringify({ type: "subscribe", resource: "devices", requestId: "1" }));
    await c.waitFor((m) => m.some((x) => x.type === "subscribed" && x.requestId === "1"));
    changeState(w.gw, "switch.kettle_plug", "on");
    await c.waitFor((m) => m.some((x) => x.type === "entity.updated"));
    expect(c.messages.find((x) => x.type === "entity.updated").data).toMatchObject({ entityId: "switch.kettle_plug", values: { power: true } });
    c.ws.close();
    await Bun.sleep(50);
    expect(w.services.realtime.connectionCount).toBe(0);
  });

  test("garbage frames get an error message and the socket stays open", async () => {
    const c = open(h.admin.cookie);
    await c.waitFor((m) => m.length > 0);
    c.ws.send("{not json");
    await c.waitFor((m) => m.some((x) => x.type === "error"));
    expect(c.closed).toBeNull();
    c.ws.send(JSON.stringify({ type: "ping" }));
    await c.waitFor((m) => m.some((x) => x.type === "pong"));
    c.ws.close();
  });

  test("a command started over HTTP is followed over the socket to confirmation", async () => {
    const c = open(h.admin.cookie);
    await c.waitFor((m) => m.length > 0);
    c.ws.send(JSON.stringify({ type: "subscribe", resource: "commands" }));
    c.ws.send(JSON.stringify({ type: "subscribe", resource: "devices" }));
    await c.waitFor((m) => m.filter((x) => x.type === "subscribed").length === 2);
    const kettle = (await h.admin.call("GET", "/devices")).json.devices.find((d: any) => d.name === "Kettle plug");
    await h.admin.call("POST", `/devices/${kettle.id}/commands`, { action: "turn_on" });
    await c.waitFor((m) => m.some((x) => x.type === "command.confirmed"));
    expect(c.messages.map((m) => m.type).filter((t) => t.startsWith("command.") || t === "entity.updated")).toEqual([
      "command.created", "command.authorized", "command.dispatched", "entity.updated", "command.accepted", "command.confirmed",
    ]);
    c.ws.close();
  });

  test("a socket whose session is revoked is closed by the sweep", async () => {
    const c = open(h.admin.cookie);
    await c.waitFor((m) => m.length > 0);
    await h.admin.call("POST", "/auth/logout");
    w.services.realtime.sweep();
    await Bun.sleep(100);
    expect(c.closed).toMatchObject({ code: 4401 });
  });
});
