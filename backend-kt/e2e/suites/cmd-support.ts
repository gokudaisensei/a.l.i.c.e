// CMD helpers: wait for a command's terminal state without polluting the transcript, and read HA truth.
import { HttpClient } from "../lib/http.ts";
import type { Actor } from "../lib/actor.ts";
import { HaClient } from "../lib/ha-truth.ts";
import { loadHaCreds } from "./scenario-support.ts";
import type { Side } from "../lib/scenario.ts";
import type { HttpResponse } from "../lib/http.ts";

const TERMINAL = new Set(["confirmed", "failed", "timed_out", "cancelled"]);

function probe(admin: Actor): HttpClient {
  return new HttpClient(admin.side.baseUrl, admin.side.backend);
}

/** Poll `GET /commands/:id` until a terminal state; the poll itself is not recorded. */
export async function waitCommand(admin: Actor, id: string, timeoutMs = 25_000): Promise<any> {
  if (!id) throw new Error(`${admin.side.backend}: the command response carried no id`);
  const start = Date.now();
  let last: any;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await probe(admin).request<any>("GET", `/api/v1/commands/${id}`, { cookie: admin.http.jar.header() });
      if (res.status === 404) throw new Error(`${admin.side.backend}: command ${id} is not_found`);
      last = res.body;
      if (last && TERMINAL.has(last.state)) return last;
    } catch {}
    await Bun.sleep(120);
  }
  throw new Error(`${admin.side.backend}: command ${id} did not finish (last=${JSON.stringify(last)?.slice(0, 300)})`);
}

export async function devices(admin: Actor): Promise<any[]> {
  const res = await admin.call("cmd.devices", "GET", "/api/v1/devices");
  return (((res.body as any)?.devices ?? []) as any[]);
}

export function haFor(side: Side): HaClient {
  const c = loadHaCreds(side.runDir);
  if (!c) throw new Error("no ha-a.env in this run; run `bun env/up.ts --run-dir <this run>` first");
  return new HaClient(c.url, c.token);
}

/** Wait until Home Assistant itself shows the expected state. */
export async function haState(ha: HaClient, entityId: string, predicate: (s: any) => boolean, timeoutMs = 15_000): Promise<any> {
  return ha.waitForState(entityId, predicate, timeoutMs, 150);
}

export function findDevice(list: any[], name: string): any {
  return list.find((d) => String(d.name).toLowerCase() === name.toLowerCase());
}


/** POST a command as the actor. The key goes in `Idempotency-Key` when present. */
export async function sendCommand(
  admin: Actor,
  label: string,
  deviceId: string,
  action: string,
  parameters?: Record<string, unknown>,
  key?: string,
): Promise<HttpResponse> {
  return admin.call(label, "POST", `/api/v1/devices/${deviceId}/commands`, {
    body: { action, ...(parameters ? { parameters } : {}) },
    ...(key ? { headers: { "idempotency-key": key } } : {}),
  });
}

/** Wait for the terminal state, then make one recorded GET so the transcript carries the result. */
export async function finishCmd(admin: Actor, id: string, label: string): Promise<any> {
  const final = await waitCommand(admin, id);
  await admin.call(label, "GET", `/api/v1/commands/${id}`);
  return final;
}
