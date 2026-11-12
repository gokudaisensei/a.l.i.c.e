// Shared world setup for the M2 scenario suites: reset both harness databases, register the base
// household (admin + member + guest), and hand each side its own actors.
import { resetBackends, resetTsPair } from "../env/stack.ts";
import type { RunContext } from "../lib/ids.ts";
import { Actor } from "../lib/actor.ts";
import { HttpClient } from "../lib/http.ts";
import type { Side, World, WorldKind } from "../lib/scenario.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function must(res: { status: number; text: string }, what: string): void {
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`${what} failed (${res.status}): ${res.text.slice(0, 300)}`);
  }
}

/** The TS worker sweeps its SQLite rate-limit table right after start; a bootstrap call that lands
 *  at that moment gets SQLITE_BUSY (a 500). That is environment contention, not a parity result, so
 *  the bootstrap is retried before the card is called BLOCKED. */
async function retryBootstrap<T extends { status: number; text: string }>(what: string, fn: () => Promise<T>): Promise<T> {
  let last: T | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    last = await fn();
    if (last.status < 500) return last;
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  return last!;
}

/** Build the base world on one stack. Bootstrap requests are discarded by the runner. */
export async function buildWorld(side: Side, kind: WorldKind, setupCode: string): Promise<World> {
  if (kind === "fresh") return { kind, actors: {} };

  const admin = new Actor(side, "Parity Admin");
  must(await retryBootstrap(`${side.backend}: register first admin`, () => admin.registerFirst(setupCode)), `${side.backend}: register first admin`);

  const memberInvite = await retryBootstrap(`${side.backend}: member invitation`, () => admin.createInvitation({ role: "member" }));
  const memberCode = (memberInvite.body as { code?: string } | null)?.code;
  if (!memberCode) throw new Error(`${side.backend}: invitation create returned no code (${memberInvite.status}): ${memberInvite.text.slice(0, 200)}`);
  const member = new Actor(side, "Parity Member");
  must(await retryBootstrap(`${side.backend}: register member`, () => member.joinWithInvitation(memberCode)), `${side.backend}: register member`);

  const guestInvite = await retryBootstrap(`${side.backend}: guest invitation`, () => admin.createInvitation({ role: "guest", guestAccessHours: 72 }));
  const guestCode = (guestInvite.body as { code?: string } | null)?.code;
  if (!guestCode) throw new Error(`${side.backend}: guest invitation returned no code (${guestInvite.status}): ${guestInvite.text.slice(0, 200)}`);
  const guest = new Actor(side, "Parity Guest");
  must(await retryBootstrap(`${side.backend}: register guest`, () => guest.joinWithInvitation(guestCode)), `${side.backend}: register guest`);

  return { kind, actors: { admin, member, guest } };
}

/** Noise run: reset the TS oracle and the second TS stack (3103), then build the same world on both. */
export async function prepareNoiseWorlds(
  ctx: RunContext,
  kind: WorldKind,
  sides: { ts: Side; kt: Side },
): Promise<{ ts: World; kt: World }> {
  await resetTsPair(ctx);
  const ts = await buildWorld(sides.ts, kind, ctx.setupCode);
  const kt = await buildWorld(sides.kt, kind, ctx.setupCode);
  return { ts, kt };
}

export interface HaCreds {
  url: string;
  token: string;
}

/** `<run>/ha-a.env` is written by `env/up.ts` after onboarding the throwaway HA instance. */
export function loadHaCreds(runDir: string, name = "ha-a.env"): HaCreds | null {
  const file = join(runDir, name);
  if (!existsSync(file)) return null;
  const env = Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("=") as [string, string]),
  );
  return env.HA_URL && env.HA_TOKEN ? { url: env.HA_URL, token: env.HA_TOKEN } : null;
}

/** A probe client with the actor's cookie but no recorder, so polling never pollutes a transcript. */
function probe(admin: Actor): HttpClient {
  return new HttpClient(admin.side.baseUrl, admin.side.backend);
}

async function probeJson(admin: Actor, path: string): Promise<any> {
  const res = await probe(admin).request("GET", path, { cookie: admin.http.jar.header() });
  return res.body;
}

/** Wait until the backend reports the connection as connected. Kotlin connects asynchronously. */
export async function waitHaConnected(admin: Actor, timeoutMs = 45_000): Promise<void> {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const body = await probeJson(admin, "/api/v1/ha/connection");
      last = body?.status ?? body;
      if (body?.configured === true && body?.status === "connected") return;
    } catch {}
    await Bun.sleep(500);
  }
  throw new Error(`${admin.side.backend}: HA connection did not become connected (last=${JSON.stringify(last)})`);
}

/** Wait until the backend has synced at least `min` visible Things. */
export async function waitDevices(admin: Actor, min: number, timeoutMs = 90_000): Promise<number> {
  const start = Date.now();
  let last = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const body = await probeJson(admin, "/api/v1/devices");
      last = Array.isArray(body?.devices) ? body.devices.length : 0;
      if (last >= min) return last;
    } catch {}
    await Bun.sleep(750);
  }
  throw new Error(`${admin.side.backend}: only ${last} devices after ${timeoutMs}ms`);
}

/** Save the throwaway HA as the household's connection and wait for its Things. */
export async function connectHa(side: Side, admin: Actor, creds: HaCreds): Promise<void> {
  const put = await admin.call("ha.connect", "PUT", "/api/v1/ha/connection", {
    body: { baseUrl: creds.url, token: creds.token },
  });
  if (put.status !== 200) throw new Error(`${side.backend}: HA connection failed (${put.status}): ${put.text.slice(0, 300)}`);
  await waitHaConnected(admin);
  await waitDevices(admin, 10);
}

/** Stop both stacks, delete only the run's own databases, start them again, then build the world. */
export async function prepareWorlds(
  ctx: RunContext,
  kind: WorldKind,
  sides: { ts: Side; kt: Side },
): Promise<{ ts: World; kt: World }> {
  await resetBackends(ctx, "both");
  const ts = await buildWorld(sides.ts, kind, ctx.setupCode);
  const kt = await buildWorld(sides.kt, kind, ctx.setupCode);
  if (kind === "ha") {
    const creds = loadHaCreds(ctx.dir);
    if (!creds) throw new Error("HA-connected world needs ha-a.env; run `bun env/up.ts --run-dir <this run>` first");
    if (!ts.actors.admin || !kt.actors.admin) throw new Error("HA world has no admin actor");
    await connectHa(sides.ts, ts.actors.admin, creds);
    await connectHa(sides.kt, kt.actors.admin, creds);
  }
  return { ts, kt };
}
