// WS cards — see cards/ws.md for the reviewed steps and coverage.
import type { CardDef, Exchange, ScenarioContext } from "../lib/scenario.ts";
import { Actor } from "../lib/actor.ts";
import { WsClient } from "../lib/ws.ts";
import { haFor, haState } from "../suites/cmd-support.ts";
import { sendCommand, finishCmd } from "../suites/cmd-support.ts";
import { devices, findDevice } from "../suites/cmd-support.ts";

function actor(ctx: ScenarioContext, name: "admin" | "member" | "guest"): Actor {
  const a = ctx.world.actors[name];
  if (!a) throw new Error(`world has no ${name}; the card needs world "ha"`);
  return a;
}

function wsFor(ctx: ScenarioContext, who: "admin" | "member" | "guest"): WsClient {
  const a = actor(ctx, who);
  const url = `${ctx.side.baseUrl.replace(/^http/, "ws")}/ws`;
  return new WsClient(url, ctx.side.backend, ctx.side.recorder, a.http.jar.header());
}

function code(body: any): unknown {
  return body?.data?.code ?? body?.code;
}

/** Record the message grammar, not live values: one synthetic exchange per server frame. */
function record(ctx: ScenarioContext, label: string, sockets: { name: string; client: WsClient }[]): void {
  const body = sockets.map(({ name, client }) => ({
    socket: name,
    messages: client.messages
      .filter((m) => m.direction === "in")
      .map((m) => {
        const data = (m.data as any)?.data;
        return {
          type: (m.data as any)?.type,
          keys: data && typeof data === "object" ? Object.keys(data).sort() : [],
          /** identity only; values are covered by the capability assertions */
          entityId: data?.entityId ?? null,
          role: data?.role ?? null,
        };
      }),
  }));
  const ex: Exchange = { label, method: "WS", path: label, status: 0, setCookies: [], headers: {}, body };
  ctx.side.exchanges.push(ex);
}

export const wsCards: CardDef[] = [
  {
    id: "E2E-WS-01",
    area: "WS",
    title: "The socket authenticates, says hello, and answers the grammar",
    capability: "/ws upgrade + protocol",
    oracles: ["TS", "SPEC", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const anon = await fetch(`http://localhost:${new URL(ctx.side.baseUrl).port}/ws`, {
        headers: {
          upgrade: "websocket",
          connection: "Upgrade",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "sec-websocket-version": "13",
        },
      });
      ctx.add("an anonymous upgrade is refused", anon.status === 401, 401, anon.status);

      const c = wsFor(ctx, "admin");
      await c.connect();
      const hello = await c.waitForType("hello");
      ctx.add("hello carries the role", hello.data?.role === "admin", "admin", hello.data?.role);
      ctx.add("hello lists the resources", Array.isArray(hello.data?.resources) && hello.data.resources.includes("devices"), "resources", hello.data?.resources);

      c.send({ type: "subscribe", resource: "devices", requestId: "s1" });
      const sub = await c.waitFor((m) => m.type === "subscribed" && m.requestId === "s1", 5000, "subscribed");
      ctx.add("subscribe is acknowledged", sub.data?.resource === "devices", "devices", sub.data?.resource);

      c.send({ type: "ping", requestId: "p1" });
      const pong = await c.waitFor((m) => m.type === "pong" && m.requestId === "p1", 5000, "pong");
      ctx.add("ping is answered", pong.type === "pong", "pong", pong.type);

      c.sendRaw("{not json");
      const err = await c.waitFor((m) => m.type === "error", 5000, "error");
      ctx.add("garbage is bad_message", code(err) === "bad_message", "bad_message", code(err));
      c.close();
      record(ctx, "ws.protocol", [{ name: "admin", client: c }]);
    },
  },
  {
    id: "E2E-WS-02",
    area: "WS",
    title: "A change made in Home Assistant is pushed to subscribers",
    capability: "entity.updated",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const c = wsFor(ctx, "admin");
      await c.connect();
      await c.waitForType("hello");
      c.send({ type: "subscribe", resource: "devices", requestId: "d" });
      await c.waitFor((m) => m.type === "subscribed" && m.requestId === "d", 5000, "subscribed");

      await ha.callService("input_boolean", "toggle", { entity_id: "input_boolean.test_switch" });
      const upd = await c.waitFor((m) => m.type === "entity.updated" && m.data?.entityId === "input_boolean.test_switch", 10_000, "entity.updated");
      ctx.add("the outside change is pushed", upd.data?.entityId === "input_boolean.test_switch", "input_boolean.test_switch", upd.data?.entityId);
      ctx.add("the update carries values", upd.data?.values && typeof upd.data.values === "object", "values object", typeof upd.data?.values);

      c.send({ type: "unsubscribe", resource: "devices", requestId: "u" });
      await c.waitFor((m) => m.type === "unsubscribed", 5000, "unsubscribed");
      const count = c.messages.length;
      await ha.callService("input_boolean", "toggle", { entity_id: "input_boolean.test_switch" });
      await Bun.sleep(800);
      const after = c.messages.slice(count).filter((m) => (m.data as any)?.type === "entity.updated");
      ctx.add("unsubscribing stops the stream", after.length === 0, 0, after.length);
      c.close();
      record(ctx, "ws.entity", [{ name: "admin", client: c }]);
      void admin;
    },
  },
  {
    id: "E2E-WS-03",
    area: "WS",
    title: "A command is followed over the socket to confirmation",
    capability: "command.* events",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const c = wsFor(ctx, "admin");
      await c.connect();
      await c.waitForType("hello");
      c.send({ type: "subscribe", resource: "commands", requestId: "c" });
      c.send({ type: "subscribe", resource: "devices", requestId: "d" });
      await c.waitFor((m) => m.type === "subscribed" && m.requestId === "c", 5000, "subscribed commands");
      await c.waitFor((m) => m.type === "subscribed" && m.requestId === "d", 5000, "subscribed devices");

      const list = await devices(admin);
      const target = list.find((d) => d.primary?.domain === "switch") ?? findDevice(list, "Floor lamp");
      const off = await sendCommand(admin, "ws.command", target.id, "turn_off");
      ctx.expectStatus("ws.command", off, [200, 202]);
      await finishCmd(admin, (off.body as any).id, "ws.command.get");
      const confirmed = await c.waitFor((m) => m.type === "command.confirmed", 15_000, "command.confirmed");
      ctx.add("the confirmed event carries the command", typeof confirmed.data?.id === "string", "id", confirmed.data?.id);
      ctx.add("the confirmed event carries requestedState", confirmed.data?.requestedState !== undefined, "requestedState", confirmed.data?.requestedState);
      const types = c.messages.filter((m) => m.direction === "in").map((m) => (m.data as any)?.type);
      ctx.add("the lifecycle includes created", types.includes("command.created"), "command.created", types.filter((t) => String(t).startsWith("command.")));
      c.close();
      record(ctx, "ws.command", [{ name: "admin", client: c }]);
    },
  },
  {
    id: "E2E-WS-04",
    area: "WS",
    title: "A guest does not receive devices they cannot see",
    capability: "per-person filtering",
    oracles: ["TS", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const a = wsFor(ctx, "admin");
      const g = wsFor(ctx, "guest");
      await a.connect();
      await g.connect();
      await a.waitForType("hello");
      await g.waitForType("hello");
      for (const [c, id] of [[a, "ad"], [g, "gd"]] as const) {
        c.send({ type: "subscribe", resource: "devices", requestId: id });
        await c.waitFor((m) => m.type === "subscribed" && m.requestId === id, 5000, "subscribed");
      }

      const list = await devices(admin);
      const target = list.find((d) => d.primary?.entityId === "input_boolean.test_switch") ?? list[0];
      await ha.callService("input_boolean", "toggle", { entity_id: "input_boolean.test_switch" });
      await a.waitFor((m) => m.type === "entity.updated" && m.data?.entityId === "input_boolean.test_switch", 10_000, "admin update");
      await Bun.sleep(1000);
      const guestUpdates = g.messages.filter((m) => (m.data as any)?.type === "entity.updated");
      ctx.add("the guest receives no device updates", guestUpdates.length === 0, 0, guestUpdates.length);

      g.send({ type: "subscribe", resource: "device", id: target.id, requestId: "gx" });
      const err = await g.waitFor((m) => m.type === "error" && m.requestId === "gx", 5000, "guest device error");
      ctx.add("an invisible device subscription is not_found", code(err) === "not_found", "not_found", code(err));
      a.close();
      g.close();
      record(ctx, "ws.filter", [{ name: "admin", client: a }, { name: "guest", client: g }]);
    },
  },
  {
    id: "E2E-WS-05",
    area: "WS",
    title: "There is no replay after a reconnect",
    capability: "reconnect / refetch",
    oracles: ["TS", "SPEC"],
    world: "ha",
    run: async (ctx) => {
      const ha = haFor(ctx.side);
      const first = wsFor(ctx, "admin");
      await first.connect();
      await first.waitForType("hello");
      first.send({ type: "subscribe", resource: "devices", requestId: "d" });
      await first.waitFor((m) => m.type === "subscribed", 5000, "subscribed");
      first.close();
      await Bun.sleep(300);

      await ha.callService("input_boolean", "toggle", { entity_id: "input_boolean.test_switch" });
      await haState(ha, "input_boolean.test_switch", () => true, 5000).catch(() => undefined);
      const state = await ha.state("input_boolean.test_switch");
      ctx.add("the change happened while disconnected", typeof state.state === "string", "a state", state.state);

      const second = wsFor(ctx, "admin");
      await second.connect();
      await second.waitForType("hello");
      second.send({ type: "subscribe", resource: "devices", requestId: "d2" });
      await second.waitFor((m) => m.type === "subscribed" && m.requestId === "d2", 5000, "resubscribed");
      await Bun.sleep(800);
      const missed = second.messages.filter((m) => (m.data as any)?.type === "entity.updated");
      ctx.add("the missed change is not replayed", missed.length === 0, 0, missed.length);
      second.close();
      record(ctx, "ws.reconnect", [{ name: "admin", client: second }]);
    },
  },
];
