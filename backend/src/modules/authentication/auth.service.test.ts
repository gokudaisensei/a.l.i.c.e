import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../core/database/client";
import { auditLog, passkeys, sessions } from "../../core/database/schema";
import { HouseholdService } from "../households/household.service";
import { AuthService } from "./auth.service";
import { VirtualAuthenticator } from "./testing/virtual-authenticator";

const RP = "localhost";
const ORIGIN = "http://localhost:3000";
const HOUR = 3_600_000;

let now: number;
let db: ReturnType<typeof createTestDb>;
let households: HouseholdService;
let auth: AuthService;
let device: VirtualAuthenticator;

beforeEach(() => {
  now = 1_700_000_000_000;
  db = createTestDb();
  households = new HouseholdService(db, () => now);
  auth = new AuthService(db, households, { rpId: RP, rpName: "Alice", origin: ORIGIN, sessionTtlHours: 24 }, () => now);
  device = new VirtualAuthenticator(RP, ORIGIN);
});

/** Registers through the real flow with a virtual passkey. */
async function register(name: string, inviteCode?: string, dev = device) {
  const { challengeId, options } = await auth.registrationOptions({ displayName: name, inviteCode });
  return auth.verifyRegistration({ challengeId, response: dev.create(options), deviceLabel: "test phone" });
}
async function login(dev = device, credentialId?: string) {
  const { challengeId, options } = await auth.loginOptions();
  return auth.verifyLogin({ challengeId, response: dev.get(options, { credentialId }) });
}
async function stepUp(token: string, dev = device) {
  const s = auth.getSession(token)!;
  const { challengeId, options } = await auth.stepUpOptions(s);
  await auth.verifyStepUp(s, { challengeId, response: dev.get(options) });
}
const code = (e: unknown) => (e as { code?: string }).code;
const fails = async (p: Promise<unknown>) => p.then(() => undefined, (e) => code(e));

describe("registration", () => {
  test("the first user becomes the household admin and gets a session and 10 recovery codes", async () => {
    const r = await register("Gokul");
    expect(r.household.role).toBe("admin");
    expect(r.recoveryCodes).toHaveLength(10);
    expect(r.recoveryCodes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(auth.getSession(r.session.token)).toMatchObject({ userId: r.user.id, steppedUp: true, restricted: false });
    expect(households.getMembership(r.user.id)).toMatchObject({ role: "admin" });
    expect(db.select().from(auditLog).all().map((a) => a.action)).toContain("auth.first_user_registered");
  });

  test("later users need an invitation", async () => {
    await register("Gokul");
    expect(await fails(auth.registrationOptions({ displayName: "Meera" }))).toBe("invite_required");
    expect(await fails(auth.registrationOptions({ displayName: "Meera", inviteCode: "NOPE-000000-NOPE-ABCD" }))).toBe("invalid_invitation");
  });

  test("an invited user joins with the invited role; the code works once", async () => {
    const admin = await register("Gokul");
    const { code: invite } = households.createInvitation(admin.household.id, admin.user.id, { role: "member" });
    const meera = await register("Meera", invite, new VirtualAuthenticator(RP, ORIGIN));
    expect(meera.household).toEqual({ id: admin.household.id, role: "member" });
    expect(await fails(auth.registrationOptions({ displayName: "Arjun", inviteCode: invite }))).toBe("invalid_invitation");
  });

  test("a registration cannot be replayed, and a wrong origin is rejected", async () => {
    const { challengeId, options } = await auth.registrationOptions({ displayName: "Gokul" });
    expect(await fails(auth.verifyRegistration({ challengeId, response: device.create(options, { origin: "http://evil.example" }) }))).toBe("invalid_credentials");
    // the challenge is spent even though verification failed
    expect(await fails(auth.verifyRegistration({ challengeId, response: device.create(options) }))).toBe("invalid_challenge");
  });

  test("validates the display name", async () => {
    expect(await fails(auth.registrationOptions({ displayName: "  " }))).toBe("validation_error");
  });
});

describe("login", () => {
  test("a registered passkey signs in without a username; each login makes a new session", async () => {
    const reg = await register("Gokul");
    const a = await login();
    const b = await login();
    expect(a.user.id).toBe(reg.user.id);
    expect(a.session.token).not.toBe(b.session.token);
    expect(auth.getSession(a.session.token)?.steppedUp).toBe(true);
    expect(db.select().from(passkeys).get()!.counter).toBeGreaterThan(0);
  });

  test("a challenge works once", async () => {
    await register("Gokul");
    const { challengeId, options } = await auth.loginOptions();
    const response = device.get(options);
    await auth.verifyLogin({ challengeId, response });
    expect(await fails(auth.verifyLogin({ challengeId, response }))).toBe("invalid_challenge");
  });

  test("unknown passkeys, wrong origins and expired challenges are refused", async () => {
    await register("Gokul");
    const other = new VirtualAuthenticator(RP, ORIGIN);
    other.create({ challenge: "x" });
    const a = await auth.loginOptions();
    expect(await fails(auth.verifyLogin({ challengeId: a.challengeId, response: other.get(a.options) }))).toBe("invalid_credentials");
    const b = await auth.loginOptions();
    expect(await fails(auth.verifyLogin({ challengeId: b.challengeId, response: device.get(b.options, { origin: "http://evil.example" }) }))).toBe("invalid_credentials");
    const c = await auth.loginOptions();
    now += 6 * 60_000;
    expect(await fails(auth.verifyLogin({ challengeId: c.challengeId, response: device.get(c.options) }))).toBe("invalid_challenge");
  });

  test("an expired guest cannot sign in", async () => {
    const admin = await register("Gokul");
    const { code: invite } = households.createInvitation(admin.household.id, admin.user.id, { role: "guest", guestAccessHours: 1 });
    const guestDevice = new VirtualAuthenticator(RP, ORIGIN);
    await register("Lakshmi", invite, guestDevice);
    now += 2 * HOUR;
    expect(await fails(login(guestDevice))).toBe("access_expired");
  });
});

describe("sessions", () => {
  test("expire, can be logged out, and tokens are stored only as hashes", async () => {
    const r = await register("Gokul");
    expect(db.select().from(sessions).all().map((s) => s.tokenHash)).not.toContain(r.session.token);
    const s = auth.getSession(r.session.token)!;
    auth.logout(s.sessionId);
    expect(auth.getSession(r.session.token)).toBeNull();
    const again = await login();
    now += 25 * HOUR;
    expect(auth.getSession(again.session.token)).toBeNull();
    expect(auth.getSession(undefined)).toBeNull();
    expect(auth.getSession("garbage")).toBeNull();
  });

  test("a user lists and revokes their own sessions only", async () => {
    const a = await register("Gokul");
    const b = await login();
    expect(auth.listSessions(a.user.id)).toHaveLength(2);
    const target = auth.getSession(b.session.token)!;
    auth.revokeSession(a.user.id, target.sessionId);
    expect(auth.getSession(b.session.token)).toBeNull();
    expect(() => auth.revokeSession("someone-else", auth.getSession(a.session.token)!.sessionId)).toThrow(/not found/);
  });
});

describe("step-up", () => {
  test("a fresh session is stepped up, then lapses, then a new assertion renews it", async () => {
    const r = await register("Gokul");
    expect(auth.getSession(r.session.token)!.steppedUp).toBe(true);
    now += 6 * 60_000;
    expect(auth.getSession(r.session.token)!.steppedUp).toBe(false);
    await stepUp(r.session.token);
    expect(auth.getSession(r.session.token)!.steppedUp).toBe(true);
  });

  test("a step-up challenge cannot be used on another session or by another user's passkey", async () => {
    const admin = await register("Gokul");
    const { code: invite } = households.createInvitation(admin.household.id, admin.user.id, { role: "member" });
    const otherDevice = new VirtualAuthenticator(RP, ORIGIN);
    const meera = await register("Meera", invite, otherDevice);
    now += 6 * 60_000;
    const mine = auth.getSession(admin.session.token)!;
    const { challengeId, options } = await auth.stepUpOptions(mine);
    // Meera's passkey is not Gokul's
    expect(await fails(auth.verifyStepUp(mine, { challengeId, response: otherDevice.get(options) }))).toBe("invalid_credentials");
    // and a challenge issued to Gokul is useless for Meera's session
    const second = await auth.stepUpOptions(mine);
    expect(await fails(auth.verifyStepUp(auth.getSession(meera.session.token)!, { challengeId: second.challengeId, response: device.get(second.options) }))).toBe("invalid_credentials");
    expect(auth.getSession(admin.session.token)!.steppedUp).toBe(false);
  });
});

describe("step-up strength", () => {
  test("a step-up without user verification (device present, user not proven) is refused", async () => {
    const r = await register("Gokul");
    now += 6 * 60_000;
    const s = auth.getSession(r.session.token)!;
    const { challengeId, options } = await auth.stepUpOptions(s);
    expect(options.userVerification).toBe("required");
    expect(await fails(auth.verifyStepUp(s, { challengeId, response: device.get(options, { userVerified: false }) }))).toBe("invalid_credentials");
    expect(auth.getSession(r.session.token)!.steppedUp).toBe(false);
  });
});

describe("passkey management", () => {
  test("adding a passkey needs a recent step-up; the last passkey cannot be removed", async () => {
    const r = await register("Gokul");
    const second = new VirtualAuthenticator(RP, ORIGIN);
    now += 6 * 60_000;
    expect(await fails(auth.addPasskeyOptions(auth.getSession(r.session.token)!))).toBe("step_up_required");
    await stepUp(r.session.token);
    const s = auth.getSession(r.session.token)!;
    const { challengeId, options } = await auth.addPasskeyOptions(s);
    await auth.verifyAddPasskey(s, { challengeId, response: second.create(options), deviceLabel: "laptop" });
    const list = auth.listPasskeys(r.user.id);
    expect(list.map((p) => p.deviceLabel)).toEqual(["test phone", "laptop"]);
    auth.deletePasskey(r.user.id, list[1]!.id);
    expect(() => auth.deletePasskey(r.user.id, list[0]!.id)).toThrow(/at least one passkey/);
    expect(() => auth.deletePasskey(r.user.id, "nope")).toThrow(/not found/);
  });
});

describe("recovery", () => {
  test("a recovery code gives a restricted session that can only add a passkey, then it is lifted", async () => {
    const r = await register("Gokul");
    const rec = auth.recoveryLogin(r.recoveryCodes[0]!.toLowerCase());
    const s = auth.getSession(rec.session.token)!;
    expect(s).toMatchObject({ restricted: true, steppedUp: false });
    expect(await fails(Promise.resolve().then(() => auth.recoveryLogin(r.recoveryCodes[0]!)))).toBe("invalid_credentials"); // single use

    const fresh = new VirtualAuthenticator(RP, ORIGIN);
    const { challengeId, options } = await auth.addPasskeyOptions(s);
    await auth.verifyAddPasskey(s, { challengeId, response: fresh.create(options), deviceLabel: "new phone" });
    expect(auth.getSession(rec.session.token)).toMatchObject({ restricted: false, steppedUp: true });
    expect((await login(fresh)).user.id).toBe(r.user.id);
    expect(db.select().from(auditLog).where(eq(auditLog.action, "auth.recovery_used")).all()).toHaveLength(1);
  });

  test("regenerating codes needs a step-up and invalidates the old codes", async () => {
    const r = await register("Gokul");
    const s = auth.getSession(r.session.token)!;
    const fresh = auth.regenerateRecoveryCodes(s);
    expect(fresh).toHaveLength(10);
    expect(() => auth.recoveryLogin(r.recoveryCodes[1]!)).toThrow();
    expect(auth.recoveryLogin(fresh[0]!).user.id).toBe(r.user.id);
    now += 6 * 60_000;
    expect(() => auth.regenerateRecoveryCodes(auth.getSession(r.session.token)!)).toThrow(/passkey/);
  });
});
