// CH cards — see cards/ch.md for the reviewed steps and coverage. Chaos targets alice-parity-ha-b.
import type { CardDef, ScenarioContext } from "../lib/scenario.ts";
import { Actor } from "../lib/actor.ts";
import { run } from "../lib/proc.ts";
import { HttpClient } from "../lib/http.ts";
import { PORTS } from "../env/constants.ts";
import { startLatencyProxy } from "../env/fake-services.ts";
import { connectHa, loadHaCreds, waitDevices, waitHaConnected } from "../suites/scenario-support.ts";
import { devices, sendCommand, waitCommand } from "../suites/cmd-support.ts";

const HA_B = "alice-parity-ha-b";

function actor(ctx: ScenarioContext, name: "admin"): Actor {
  const a = ctx.world.actors[name];
  if (!a) throw new Error("CH cards need an admin actor");
  return a;
}

function creds(ctx: ScenarioContext) {
  const c = loadHaCreds(ctx.side.runDir, "ha-b.env");
  if (!c) throw new Error("CH cards need ha-b.env; run with a run dir that has the HA pair files");
  return c;
}

async function status(admin: Actor): Promise<any> {
  const probe = new HttpClient(admin.side.baseUrl, admin.side.backend);
  const res = await probe.request<any>("GET", "/api/v1/ha/connection", { cookie: admin.http.jar.header() });
  return res.body;
}

async function waitStatus(admin: Actor, predicate: (s: any) => boolean, timeoutMs: number): Promise<any> {
  const start = Date.now();
  let last: any;
  while (Date.now() - start < timeoutMs) {
    last = await status(admin);
    if (predicate(last)) return last;
    await Bun.sleep(500);
  }
  throw new Error(`${admin.side.backend}: HA status did not change (last=${JSON.stringify(last)?.slice(0, 300)})`);
}

async function health(admin: Actor): Promise<number> {
  try {
    const res = await fetch(`${admin.side.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return res.status;
  } catch {
    return 0;
  }
}

function unpause(): void {
  run("docker", ["unpause", HA_B]);
}

export const chCards: CardDef[] = [
  {
    id: "E2E-CH-01",
    area: "CH",
    title: "Pausing Home Assistant does not take the backend down",
    capability: "connection health under a paused HA",
    oracles: ["HA", "TS"],
    tier: "chaos",
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const c = creds(ctx);
      await connectHa(ctx.side, admin, c);
      let target: any;
      try {
        run("docker", ["pause", HA_B]);
        ctx.add("the server is still healthy while HA is frozen", (await health(admin)) === 200, 200, await health(admin));
        const list = await admin.call("ch.paused.devices", "GET", "/api/v1/devices");
        ctx.expectStatus("ch.paused.devices", list, 200);
        const all = (((list.body as any)?.devices ?? []) as any[]);
        target = all.find((d) => d.primary?.domain === "switch");
        ctx.add("a switch is available", target !== undefined, "a switch", target?.name);
        if (target) {
          // HA is frozen, not down: the TCP read hangs, so the command can stay dispatched until HA
          // returns. Record that state; recovery after unpause is the assertion.
          const sent = await sendCommand(admin, "ch.paused.command", target.id, "turn_off");
          ctx.expectStatus("ch.paused.command", sent, [200, 202]);
          await Bun.sleep(10_000);
          const probe = new HttpClient(admin.side.baseUrl, admin.side.backend);
          const mid = await probe.request<any>("GET", `/api/v1/commands/${(sent.body as any)?.id}`, { cookie: admin.http.jar.header() });
          ctx.add("a command against a frozen HA is not confirmed", mid.body?.state !== "confirmed", "not confirmed", mid.body?.state);
        }
      } finally {
        unpause();
      }
      await waitHaConnected(admin, 90_000);
      const count = await waitDevices(admin, 10, 90_000);
      ctx.add("the devices return after unpause", count >= 10, ">=10", count);
      if (target) {
        const back = await sendCommand(admin, "ch.paused.recover", target.id, "turn_on");
        ctx.expectStatus("ch.paused.recover", back, [200, 202]);
        const final = await waitCommand(admin, (back.body as any)?.id, 30_000);
        ctx.add("commands work again after unpause", final.state === "confirmed", "confirmed", final.state);
      }
      void waitStatus;
    },
  },
  {
    id: "E2E-CH-02",
    area: "CH",
    title: "Restarting Home Assistant reconnects",
    capability: "reconnect after an HA restart",
    oracles: ["HA", "TS"],
    tier: "chaos",
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const c = creds(ctx);
      await connectHa(ctx.side, admin, c);
      run("docker", ["restart", HA_B]);
      await waitHaConnected(admin, 120_000);
      const count = await waitDevices(admin, 10, 120_000);
      ctx.add("the stack reconnects after the restart", count >= 10, ">=10", count);
      ctx.add("the server is healthy", (await health(admin)) === 200, 200, await health(admin));
    },
  },
  {
    id: "E2E-CH-03",
    area: "CH",
    title: "A slow Home Assistant times a command out instead of hanging the API",
    capability: "command timeout under 5 s latency",
    oracles: ["HA", "TS"],
    tier: "chaos",
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const c = creds(ctx);
      const proxy = startLatencyProxy(PORTS.fakeLatency, PORTS.haB, 5000);
      try {
        const put = await admin.call("ch.slow.connect", "PUT", "/api/v1/ha/connection", {
          body: { baseUrl: `http://127.0.0.1:${PORTS.fakeLatency}`, token: c.token },
        });
        ctx.expectStatus("ch.slow.connect", put, 200);
        await waitHaConnected(admin, 120_000);
        const list = await devices(admin);
        const target = list.find((d) => d.primary?.domain === "switch");
        ctx.add("a switch is available", target !== undefined, "a switch", target?.name);
        if (target) {
          const sent = await sendCommand(admin, "ch.slow.command", target.id, "turn_off");
          ctx.expectStatus("ch.slow.command", sent, [200, 202]);
          const final = await waitCommand(admin, (sent.body as any)?.id, 40_000);
          ctx.add("the command resolves as timed_out", final.state === "timed_out", "timed_out", final.state);
          ctx.add("the server stayed responsive", (await health(admin)) === 200, 200, await health(admin));
        }
      } finally {
        const restore = await admin.call("ch.slow.restore", "PUT", "/api/v1/ha/connection", { body: { baseUrl: c.url, token: c.token } });
        void restore;
        proxy.stop();
      }
      await waitHaConnected(admin, 90_000);
    },
  },
  {
    id: "E2E-CH-04",
    area: "CH",
    title: "Token revocation is not testable from the harness",
    capability: "token revoked in HA",
    oracles: ["HA", "TS"],
    tier: "chaos",
    blocked: "Revoking the long-lived token needs its Home Assistant token id / an admin websocket call that the harness does not have; not claimed as passing.",
    run: async () => undefined,
  },
  {
    id: "E2E-CH-05",
    area: "CH",
    title: "Worker kill/restart and config-job recovery are deferred",
    capability: "worker resilience",
    oracles: ["HA", "TS"],
    tier: "chaos",
    blocked: "Config sync needs an admin token plus a worker apply, and T6.2/T6.3 are already deferred; a worker-only kill would not exercise the job pipeline.",
    run: async () => undefined,
  },
  {
    id: "E2E-CH-06",
    area: "CH",
    title: "Disk-full behaviour is not safe to simulate",
    capability: "disk full",
    oracles: ["TS"],
    tier: "chaos",
    blocked: "Needs a size-limited mount or sudo/loop device; R9 forbids it without explicit approval.",
    run: async () => undefined,
  },
  {
    id: "E2E-CH-07",
    area: "CH",
    title: "200 WS clients and 1,000 rapid commands are out of scope here",
    capability: "load",
    oracles: ["TS"],
    tier: "soak",
    blocked: "The server caps 10 connections per user, so 200 sockets need 20 accounts; rapid-command throughput is covered by T4.2 and light commands are blocked by F-026.",
    run: async () => undefined,
  },
  {
    id: "E2E-CH-08",
    area: "CH",
    title: "Slow-tier expiry windows are not shortened on both stacks",
    capability: "undo expiry, left-open 10 min, session expiry",
    oracles: ["TS", "SPEC"],
    tier: "slow",
    blocked: "Undo and left-open are real 10-minute windows; session TTL is an hour-scale knob; step-up/challenge TTL exists only in Kotlin (AUTH-14). Not run in the fast tier.",
    run: async () => undefined,
  },
  {
    id: "E2E-CH-09",
    area: "CH",
    title: "The optional soak run needs user approval",
    capability: "2-hour soak",
    oracles: ["TS"],
    tier: "soak",
    blocked: "A 2-hour mixed-traffic soak with /proc sampling must not start without the user's explicit go-ahead.",
    run: async () => undefined,
  },
];
