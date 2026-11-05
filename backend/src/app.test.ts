import { beforeEach, describe, expect, test } from "bun:test";
import { buildApp } from "./app";
import { createTestDb } from "./core/database/client";
import { VirtualAuthenticator } from "./modules/authentication/testing/virtual-authenticator";
import { assertTransition, canTransition } from "./modules/devices/command-lifecycle";
import { createServices } from "./services";

const RP = "localhost";
const ORIGIN = "http://localhost:3000";
const MIN = 60_000;
let now: number;
let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  now = 1_700_000_000_000;
  app = buildApp(createServices(createTestDb(), { now: () => now, auth: { rpId: RP, rpName: "Alice", origin: ORIGIN, sessionTtlHours: 24 } }));
});

/** A tiny browser: keeps the session cookie and a virtual passkey. */
class Browser {
  cookie = "";
  device = new VirtualAuthenticator(RP, ORIGIN);

  async call(method: string, path: string, body?: unknown) {
    const res = await app.handle(new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0]!.startsWith("alice_session=") && set.split(";")[0] !== "alice_session=" ? set.split(";")[0]! : "";
    const json = (await res.json().catch(() => null)) as any;
    return { status: res.status, json, setCookie: set };
  }

  async register(name: string, inviteCode?: string) {
    const o = await this.call("POST", "/auth/register/options", { displayName: name, inviteCode });
    if (o.status !== 200) return o;
    return this.call("POST", "/auth/register/verify", { challengeId: o.json.challengeId, response: this.device.create(o.json.options), deviceLabel: "phone" });
  }
  async login() {
    const o = await this.call("POST", "/auth/login/options");
    return this.call("POST", "/auth/login/verify", { challengeId: o.json.challengeId, response: this.device.get(o.json.options) });
  }
  async stepUp() {
    const o = await this.call("POST", "/auth/step-up/options");
    return this.call("POST", "/auth/step-up/verify", { challengeId: o.json.challengeId, response: this.device.get(o.json.options) });
  }
}

describe("app basics", () => {
  test("GET /health", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
  });

  test("modules that are still stubs are mounted under /api/v1", async () => {
    const res = await app.handle(new Request("http://localhost/api/v1/devices"));
    expect(await res.json()).toEqual({ module: "devices", status: "not_implemented" });
  });

  test("everything private says 401 without a session", async () => {
    const b = new Browser();
    for (const [m, p] of [["GET", "/users/me"], ["GET", "/household"], ["GET", "/household/members"], ["GET", "/permissions/me"], ["GET", "/admin/security/sensitive-operations"], ["GET", "/ha/connection"], ["GET", "/auth/session"]] as const) {
      expect((await b.call(m, p)).status).toBe(401);
    }
  });

  test("bad input is a 422 with a clear error shape", async () => {
    const r = await new Browser().call("POST", "/auth/register/options", { nope: true });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("validation_error");
  });
});

describe("registration and sessions over HTTP", () => {
  test("first user registers: cookie is HttpOnly + SameSite, recovery codes come back once", async () => {
    const b = new Browser();
    const r = await b.register("Gokul");
    expect(r.status).toBe(200);
    expect(r.json.household.role).toBe("admin");
    expect(r.json.recoveryCodes).toHaveLength(10);
    expect(r.setCookie).toMatch(/alice_session=/);
    expect(r.setCookie).toMatch(/HttpOnly/i);
    expect(r.setCookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(r.json)).not.toContain("token");
    const me = await b.call("GET", "/users/me");
    expect(me.json).toMatchObject({ displayName: "Gokul", role: "admin" });
    expect((await b.call("GET", "/auth/session")).json).toMatchObject({ steppedUp: true, restricted: false, household: { role: "admin" } });
  });

  test("logout revokes the session; login brings it back; profile can be edited", async () => {
    const b = new Browser();
    await b.register("Gokul");
    expect((await b.call("POST", "/auth/logout")).status).toBe(200);
    expect((await b.call("GET", "/users/me")).status).toBe(401);
    expect((await b.login()).status).toBe(200);
    expect((await b.call("PATCH", "/users/me", { displayName: "Gokul S", avatarColor: 3 })).json).toMatchObject({ displayName: "Gokul S", avatarColor: 3 });
    expect((await b.call("PATCH", "/users/me", { displayName: "   " })).json.error.code).toBe("validation_error");
    expect((await b.call("PATCH", "/users/me/preferences", { pushEnabled: false, quietHours: { enabled: true, from: "22:00", to: "07:00" } })).json).toMatchObject({ pushEnabled: false, quietHours: { enabled: true } });
  });

  test("a session expires on its own", async () => {
    const b = new Browser();
    await b.register("Gokul");
    now += 25 * 3_600_000;
    expect((await b.call("GET", "/users/me")).status).toBe(401);
  });
});

describe("household, invitations and roles over HTTP", () => {
  async function homeWithMember() {
    const admin = new Browser();
    await admin.register("Gokul");
    const inv = await admin.call("POST", "/household/invitations", { role: "member" });
    const meera = new Browser();
    const joined = await meera.register("Meera", inv.json.code);
    return { admin, meera, inv, joined };
  }

  test("an admin invites a member; the invitation code is shown once and works once", async () => {
    const { admin, meera, inv, joined } = await homeWithMember();
    expect(inv.status).toBe(200);
    expect(joined.json.household.role).toBe("member");
    expect(JSON.stringify((await admin.call("GET", "/household/invitations")).json)).not.toContain(inv.json.code);
    const again = await new Browser().register("Arjun", inv.json.code);
    expect(again.json.error.code).toBe("invalid_invitation");
    const members = (await meera.call("GET", "/household/members")).json.members;
    expect(members.map((m: any) => [m.displayName, m.role, m.me])).toEqual([["Gokul", "admin", false], ["Meera", "member", true]]);
  });

  test("a member cannot manage people, policies or security settings", async () => {
    const { meera } = await homeWithMember();
    expect((await meera.call("POST", "/household/invitations", { role: "guest" })).json.error.code).toBe("forbidden");
    expect((await meera.call("PATCH", "/household", { name: "Mine" })).status).toBe(403);
    expect((await meera.call("GET", "/permissions/policies")).status).toBe(403);
    expect((await meera.call("GET", "/admin/security/sensitive-operations")).status).toBe(403);
    expect((await meera.call("GET", "/ha/connection")).status).toBe(403);
    expect((await meera.call("GET", "/permissions/me")).json).toMatchObject({ role: "member" });
  });

  test("sensitive admin actions need a fresh passkey, and a step-up over HTTP renews it", async () => {
    const admin = new Browser();
    await admin.register("Gokul");
    now += 6 * MIN;
    const denied = await admin.call("POST", "/household/invitations", { role: "guest", guestAccessHours: 24 });
    expect(denied.status).toBe(403);
    expect(denied.json.error.code).toBe("step_up_required");
    expect((await admin.stepUp()).json).toEqual({ steppedUp: true });
    expect((await admin.call("POST", "/household/invitations", { role: "guest", guestAccessHours: 24 })).status).toBe(200);
  });

  test("the last admin cannot be removed; roles can be changed", async () => {
    const { admin, meera } = await homeWithMember();
    const members = (await admin.call("GET", "/household/members")).json.members;
    const [gokul, mem] = [members[0], members[1]];
    expect((await admin.call("DELETE", `/household/members/${gokul.id}`)).json.error.code).toBe("conflict");
    expect((await admin.call("PATCH", `/household/members/${mem.id}`, { role: "guest", expiresAt: now + 1000 })).json).toMatchObject({ role: "guest" });
    expect((await meera.call("GET", "/permissions/me")).json.role).toBe("guest");
    expect((await admin.call("DELETE", `/household/members/${mem.id}`)).status).toBe(200);
    expect((await meera.call("GET", "/users/me")).status).toBe(403); // signed in, but no longer part of a home
  });
});

describe("security settings over HTTP", () => {
  test("an admin reads the defaults, switches one off (warned), and changes it back", async () => {
    const admin = new Browser();
    await admin.register("Gokul");
    const got = await admin.call("GET", "/admin/security/sensitive-operations");
    expect(got.json.rules.map((r: any) => `${r.domain}.${r.action}:${r.source}`)).toEqual(["lock.unlock:default", "lock.open:default"]);
    const put = await admin.call("PUT", "/admin/security/sensitive-operations", { rules: [{ domain: "lock", action: "unlock", sensitive: false }, { domain: "cover", action: "open", deviceClass: "garage", sensitive: true }] });
    expect(put.json.defaultsSwitchedOff).toEqual(["lock.unlock"]);
    const after = (await admin.call("GET", "/admin/security/sensitive-operations")).json.rules;
    expect(after).toContainEqual({ domain: "cover", action: "open", deviceClass: "garage", sensitive: true, source: "custom" });
    now += 6 * MIN;
    expect((await admin.call("PUT", "/admin/security/sensitive-operations", { rules: [] })).json.error.code).toBe("step_up_required");
  });

  test("device policies: create, list, delete", async () => {
    const admin = new Browser();
    await admin.register("Gokul");
    const p = await admin.call("POST", "/permissions/policies", { connectionId: "c1", entityId: "light.hall", subjectType: "role", subjectId: "guest", effect: "allow", operations: ["turn_on", "turn_off"] });
    expect(p.status).toBe(200);
    expect((await admin.call("GET", "/permissions/policies")).json.policies).toHaveLength(1);
    expect((await admin.call("DELETE", `/permissions/policies/${p.json.id}`)).status).toBe(200);
    expect((await admin.call("GET", "/permissions/policies")).json.policies).toHaveLength(0);
  });
});

describe("recovery over HTTP", () => {
  test("a recovery code opens a restricted session that can add a passkey but nothing else", async () => {
    const owner = new Browser();
    const reg = await owner.register("Gokul");
    const lost = new Browser(); // a new phone with no passkey
    const r = await lost.call("POST", "/auth/recovery/verify", { code: reg.json.recoveryCodes[0] });
    expect(r.json.restricted).toBe(true);
    expect((await lost.call("GET", "/users/me")).json.error.code).toBe("restricted_session");
    expect((await lost.call("GET", "/household")).status).toBe(403);
    const o = await lost.call("POST", "/auth/passkeys/options");
    expect(o.status).toBe(200);
    const ok = await lost.call("POST", "/auth/passkeys/verify", { challengeId: o.json.challengeId, response: lost.device.create(o.json.options), deviceLabel: "new phone" });
    expect(ok.status).toBe(200);
    expect((await lost.call("GET", "/users/me")).status).toBe(200);
    expect((await lost.call("POST", "/auth/recovery/verify", { code: reg.json.recoveryCodes[0] })).status).toBe(401); // used up
  });
});

describe("command lifecycle", () => {
  test("allows the happy path", () => {
    expect(canTransition("pending", "authorized")).toBe(true);
    expect(canTransition("accepted", "confirmed")).toBe(true);
  });
  test("rejects invalid and post-terminal transitions", () => {
    expect(() => assertTransition("confirmed", "failed")).toThrow();
    expect(canTransition("dispatched", "cancelled")).toBe(false);
  });
});
