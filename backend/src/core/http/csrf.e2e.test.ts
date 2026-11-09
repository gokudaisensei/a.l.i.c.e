import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { sessions } from "../database/schema";
import { createWorld, MIN, type World } from "../../testing/world";
import { checkSocketOrigin } from "./csrf";

let w: World;
let admin: ReturnType<World["browser"]>;
const post = (path: string, headers: Record<string, string>, body: object = { displayName: "x" }) =>
  w.app.handle(new Request(`http://localhost/api/v1${path}`, { method: "POST", headers: { "content-type": "application/json", cookie: admin.cookie, ...headers }, body: JSON.stringify(body) }));

beforeEach(async () => {
  w = createWorld();
  admin = w.browser();
  await admin.register("Gokul");
});

describe("cross-site request protection", () => {
  test("a change from another site is refused, even with the person's cookie", async () => {
    const r = await post("/household/invitations", { origin: "https://evil.example" }, { role: "member" });
    expect(r.status).toBe(403);
    expect((await r.json() as any).error.code).toBe("csrf_blocked");
    expect((await post("/household/invitations", { origin: "null" }, { role: "member" })).status).toBe(403);
  });
  test("a change with no origin must say it comes from a script; this site's own origin is fine", async () => {
    expect((await post("/household/invitations", {}, { role: "member" })).status).toBe(403);
    expect((await post("/household/invitations", { "x-requested-with": "alice" }, { role: "member" })).status).toBe(200);
    expect((await post("/household/invitations", { origin: "http://localhost:3000" }, { role: "member" })).status).toBe(200);
  });
  test("reads, signed-out calls and bearer tokens are not affected", async () => {
    const get = await w.app.handle(new Request("http://localhost/api/v1/household", { headers: { cookie: admin.cookie, origin: "https://evil.example" } }));
    expect(get.status).toBe(200); // a read changes nothing
    const anon = await w.app.handle(new Request("http://localhost/api/v1/auth/login/options", { method: "POST", headers: { origin: "https://elsewhere.example" } }));
    expect(anon.status).toBe(200); // no cookie, so nothing to forge
    const op = await w.app.handle(new Request("http://localhost/api/v1/operator/homes", { method: "GET", headers: { authorization: "Bearer nope", origin: "https://evil.example" } }));
    expect(op.status).toBe(401); // judged by its token, not by CSRF
  });
  test("a WebSocket from another site is refused; no origin (not a browser) or ours is accepted", () => {
    const req = (origin?: string) => new Request("http://localhost/ws", { headers: origin ? { origin } : {} });
    expect(() => checkSocketOrigin(req("https://evil.example"), ["http://localhost:3000"])).toThrow();
    expect(() => checkSocketOrigin(req("http://localhost:3000"), ["http://localhost:3000"])).not.toThrow();
    expect(() => checkSocketOrigin(req(), ["http://localhost:3000"])).not.toThrow();
  });
});

describe("sliding sessions", () => {
  const expiry = async () => (await admin.call("GET", "/auth/session")).json.expiresAt as number;
  const HOURS = 60 * MIN;

  test("a session in use is pushed out once more than half its time is gone, and the cookie follows", async () => {
    const first = await expiry();
    w.clock.now += 5 * HOURS;
    expect(await expiry()).toBe(first); // plenty of time left: unchanged
    w.clock.now += 8 * HOURS; // 13h in, 11h left
    const res = await w.app.handle(new Request("http://localhost/api/v1/auth/session", { headers: { cookie: admin.cookie, origin: "http://localhost:3000" } }));
    const body = (await res.json()) as any;
    expect(body.expiresAt).toBe(w.clock.now + 24 * HOURS);
    expect(res.headers.get("set-cookie")).toMatch(/alice_session=.*Expires=/i);
  });

  test("it never lives longer than 90 days in all", async () => {
    const start = w.clock.now;
    let ends = 0;
    for (let i = 0; i < 180 && !ends; i++) { w.clock.now += 13 * HOURS; const e = await expiry(); if (!e) ends = w.clock.now - start; }
    expect(ends).toBeGreaterThan(80 * 24 * HOURS);
    expect(ends).toBeLessThan(92 * 24 * HOURS); // signed out within a step of the 90-day cap, however busy it was
    expect(w.db.select().from(sessions).get()!.expiresAt).toBeLessThanOrEqual(start + 90 * 24 * HOURS + 1);
  });

  test("a session nobody uses ends at its first expiry", async () => {
    w.clock.now += 25 * HOURS;
    expect((await admin.call("GET", "/auth/session")).status).toBe(401);
  });

  test("a recovery session is never renewed", async () => {
    w.db.update(sessions).set({ restricted: true }).where(eq(sessions.userId, w.db.select().from(sessions).get()!.userId)).run();
    const first = await expiry();
    w.clock.now += 13 * HOURS;
    expect(await expiry()).toBe(first);
  });
});
