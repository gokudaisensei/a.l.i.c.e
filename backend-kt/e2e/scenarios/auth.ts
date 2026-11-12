// AUTH cards — see cards/auth.md for the reviewed steps and coverage.
import type { CardDef, ScenarioContext } from "../lib/scenario.ts";
import { Actor, type OptionsResponse, type SignedInBody } from "../lib/actor.ts";
import { SoftwareAuthenticator } from "../lib/passkey.ts";

function actor(ctx: ScenarioContext, name: "admin" | "member" | "guest"): Actor {
  const a = ctx.world.actors[name];
  if (!a) throw new Error(`world has no ${name}; the card needs world "household"`);
  return a;
}

function code(body: unknown): unknown {
  return (body as { error?: { code?: unknown } } | null)?.error?.code;
}

function keys(body: unknown): string[] {
  return body && typeof body === "object" ? Object.keys(body as object).sort() : [];
}

function cookieFor(ctx: ScenarioContext, label: string): string {
  const ex = [...ctx.side.exchanges].reverse().find((e) => e.label === label);
  return ex?.setCookies.join("\n") ?? "";
}

export const authCards: CardDef[] = [
  {
    id: "E2E-AUTH-01",
    area: "AUTH",
    title: "First user registers with the setup code and receives recovery codes once",
    capability: "Passkey sign-in and recovery codes (FEATURES §People); API.md Authentication/register",
    oracles: ["SPEC", "TS"],
    world: "fresh",
    run: async (ctx) => {
      const before = await ctx.call("auth.setup.before", "GET", "/api/v1/auth/setup");
      ctx.expectStatus("auth.setup.before", before, 200);
      ctx.add("setup says needsSetup", (before.body as any)?.needsSetup === true, true, (before.body as any)?.needsSetup);
      ctx.add("setup says a code is required", (before.body as any)?.setupCodeRequired === true, true, (before.body as any)?.setupCodeRequired);

      const admin = new Actor(ctx.side, "Parity Admin");
      const wrong = await admin.beginRegistration({ setupCode: "WRONGCODE" });
      ctx.expectStatus("auth.register.options.wrong", wrong, 403);
      ctx.add("wrong setup code error", code(wrong.body) === "setup_code_required", "setup_code_required", code(wrong.body));

      const setupCode = ctx.side.setupCode;
      const options = await admin.beginRegistration({ setupCode });
      ctx.expectStatus("auth.register.options", options, 200);
      ctx.add("register options have a challenge", typeof options.body?.challengeId === "string" && options.body.challengeId.length > 0, true, typeof options.body?.challengeId);
      ctx.add("register options use the localhost rpId", options.body?.options?.rp?.id === "localhost", "localhost", options.body?.options?.rp?.id);
      ctx.add("register options name the person", typeof options.body?.options?.user?.name === "string", true, options.body?.options?.user?.name);

      const passkeyResponse = admin.authenticator.register(options.body.options, { origin: ctx.side.origin, rpId: "localhost" });
      const registration = { challengeId: options.body.challengeId, response: passkeyResponse };
      const verify = await admin.call<SignedInBody>("auth.register.verify", "POST", "/api/v1/auth/register/verify", { body: registration });
      ctx.expectStatus("auth.register.verify", verify, [200, 201]);
      const body = verify.body as SignedInBody | null;
      ctx.add("recovery codes are returned once", Array.isArray(body?.recoveryCodes) && body!.recoveryCodes!.length > 0, "non-empty array", body?.recoveryCodes?.length ?? 0);
      ctx.add("recovery codes are unique", new Set(body?.recoveryCodes ?? []).size === (body?.recoveryCodes?.length ?? 0), "all unique", new Set(body?.recoveryCodes ?? []).size);
      ctx.add("the first user is an admin", body?.household?.role === "admin", "admin", body?.household?.role);
      const setCookie = cookieFor(ctx, "auth.register.verify");
      ctx.add("registration signs the passkey in", /alice_session=/.test(setCookie), "alice_session cookie", setCookie.split("\n")[0] ?? "");

      const session = await admin.session();
      ctx.expectStatus("auth.session", session, 200);
      ctx.add("the session is not restricted", (session.body as any)?.restricted === false, false, (session.body as any)?.restricted);
      ctx.add("the session is stepped up", (session.body as any)?.steppedUp === true, true, (session.body as any)?.steppedUp);
      ctx.add("the session household role is admin", (session.body as any)?.household?.role === "admin", "admin", (session.body as any)?.household?.role);

      const after = await ctx.call("auth.setup.after", "GET", "/api/v1/auth/setup");
      ctx.expectStatus("auth.setup.after", after, 200);
      ctx.add("setup is no longer needed", (after.body as any)?.needsSetup === false, false, (after.body as any)?.needsSetup);
      ctx.add("no setup code is required now", (after.body as any)?.setupCodeRequired === false, false, (after.body as any)?.setupCodeRequired);

      const replay = await admin.call("auth.register.replay", "POST", "/api/v1/auth/register/verify", {
        body: registration,
      });
      ctx.expectStatus("auth.register.replay", replay, [400, 401, 403, 409, 422]);
      ctx.add("a used registration challenge is refused", code(replay.body) === "invalid_challenge", "invalid_challenge", code(replay.body));
    },
  },
  {
    id: "E2E-AUTH-02",
    area: "AUTH",
    title: "A second person needs an invitation and a bad code is refused uniformly",
    capability: "Invitation-only join (FEATURES §People)",
    oracles: ["TS", "SPEC"],
    world: "household",
    run: async (ctx) => {
      const noInvite = new Actor(ctx.side, "No Invite");
      const r1 = await noInvite.beginRegistration({});
      ctx.expectStatus("auth.register.options.no-invite", r1, 403);
      ctx.add("a second person needs an invitation", code(r1.body) === "invite_required", "invite_required", code(r1.body));

      const bad = new Actor(ctx.side, "Bad Code");
      const r2 = await bad.beginRegistration({ inviteCode: "WRONGCODE" });
      ctx.expectStatus("auth.register.options.bad-invite", r2, 400);
      ctx.add("an unknown invitation code is refused", code(r2.body) === "invalid_invitation", "invalid_invitation", code(r2.body));

      const invite = await actor(ctx, "admin").createInvitation({ role: "member" });
      ctx.expectStatus("household.invitations.create", invite, 200);
      ctx.add("an invitation returns a code", typeof (invite.body as any)?.code === "string" && (invite.body as any).code.length > 0, "non-empty code", typeof (invite.body as any)?.code);
      const joined = new Actor(ctx.side, "Second Person");
      const verify = await joined.joinWithInvitation((invite.body as any)!.code as string);
      ctx.expectStatus("auth.register.verify", verify, [200, 201]);
      ctx.add("the invited role is honoured", (verify.body as SignedInBody | null)?.household?.role === "member", "member", (verify.body as SignedInBody | null)?.household?.role);
    },
  },
  {
    id: "E2E-AUTH-03",
    area: "AUTH",
    title: "An invitation code is single-use and its role is honoured",
    capability: "Invitations shown once, role honoured (FEATURES §People)",
    oracles: ["TS", "SPEC"],
    world: "household",
    run: async (ctx) => {
      const invite = await actor(ctx, "admin").createInvitation({ role: "guest", guestAccessHours: 48, expiresInHours: 24 });
      ctx.expectStatus("household.invitations.create", invite, 200);
      const inviteCode = (invite.body as any)?.code as string | undefined;
      ctx.add("the invitation code is shown", typeof inviteCode === "string" && inviteCode.length > 0, "non-empty", typeof inviteCode);
      if (!inviteCode) return;

      const guest = new Actor(ctx.side, "Invited Guest");
      const verify = await guest.joinWithInvitation(inviteCode);
      ctx.expectStatus("auth.register.verify", verify, [200, 201]);
      ctx.add("the invited guest gets the guest role", (verify.body as SignedInBody | null)?.household?.role === "guest", "guest", (verify.body as SignedInBody | null)?.household?.role);

      const household = await guest.call("household.get", "GET", "/api/v1/household");
      ctx.expectStatus("household.get", household, 200);
      ctx.add("the guest sees the guest role", (household.body as any)?.role === "guest", "guest", (household.body as any)?.role);

      const reused = new Actor(ctx.side, "Reuse Attempt");
      const replay = await reused.beginRegistration({ inviteCode, displayName: ctx.unique("Reuse Attempt") });
      ctx.expectStatus("auth.register.options.reused", replay, 400);
      ctx.add("a used invitation is refused", code(replay.body) === "invalid_invitation", "invalid_invitation", code(replay.body));
    },
  },
  {
    id: "E2E-AUTH-04",
    area: "AUTH",
    title: "Login sets a session cookie with the documented attributes",
    capability: "Login options/verify; cookie attributes (plan §4.2)",
    oracles: ["TS", "SPEC", "SEC"],
    world: "household",
    run: async (ctx) => {
      const member = actor(ctx, "member");
      const clone = await member.freshSession();
      const loginVerify = [...ctx.side.exchanges].reverse().find((e) => e.label === "auth.login.verify");
      ctx.add("login sets a session cookie", !!loginVerify && loginVerify.setCookies.some((c) => c.startsWith("alice_session=")), "alice_session", loginVerify?.setCookies[0]?.split(";")[0] ?? "");
      const cookie = loginVerify?.setCookies.join("\n") ?? "";
      ctx.add("the cookie is HttpOnly", /HttpOnly/i.test(cookie), "HttpOnly", /HttpOnly/i.test(cookie));
      ctx.add("the cookie is SameSite=Lax", /SameSite=Lax/i.test(cookie), "SameSite=Lax", /SameSite=Lax/i.test(cookie));
      ctx.add("the cookie has a path", /Path=\//i.test(cookie), "Path=/", /Path=\//i.test(cookie));
      ctx.add("the cookie has a max age or expiry", /Max-Age=\d+/i.test(cookie) || /Expires=/i.test(cookie), "Max-Age or Expires", cookie.match(/Max-Age=\d+/i)?.[0] ?? cookie.match(/Expires=[^;]+/i)?.[0] ?? "none");
      const loginBody = ctx.side.exchanges.find((e) => e.label === "auth.login.verify")?.body as SignedInBody | undefined;
      ctx.add("login returns the user", typeof loginBody?.user?.id === "string", true, typeof loginBody?.user?.id);
      ctx.add("login returns the household", typeof loginBody?.household?.id === "string", true, typeof loginBody?.household?.id);
      ctx.add("login returns an expiry", typeof loginBody?.expiresAt === "number", "number", typeof loginBody?.expiresAt);
      const session = await clone.session();
      ctx.expectStatus("auth.session", session, 200);
      ctx.add("the login session is not restricted", (session.body as any)?.restricted === false, false, (session.body as any)?.restricted);

      // Error twin: a passkey the server has never seen. Sign-in here is usernameless, so any
      // *registered* passkey may answer a challenge; only an unregistered credential must fail.
      const start = await ctx.call<OptionsResponse>("auth.login.options.wrong-passkey", "POST", "/api/v1/auth/login/options", { body: {} });
      ctx.expectStatus("auth.login.options.wrong-passkey", start, 200);
      const stranger = new SoftwareAuthenticator();
      stranger.origin = ctx.side.origin;
      stranger.rpId = "localhost";
      const response = stranger.assert(start.body.options, { origin: ctx.side.origin, rpId: "localhost" });
      const bad = await ctx.call("auth.login.verify.wrong-passkey", "POST", "/api/v1/auth/login/verify", { body: { challengeId: start.body.challengeId, response } });
      ctx.expectStatus("auth.login.verify.wrong-passkey", bad, 401);
      ctx.add("a passkey that was not challenged is refused", code(bad.body) === "invalid_credentials", "invalid_credentials", code(bad.body));
    },
  },
  {
    id: "E2E-AUTH-05",
    area: "AUTH",
    title: "A wrong origin or rpId is refused",
    capability: "WebAuthn origin/rpId binding (plan §4.2)",
    oracles: ["TS", "SEC"],
    world: "household",
    run: async (ctx) => {
      const member = actor(ctx, "member");
      const one = await ctx.call<OptionsResponse>("auth.login.options.bad-origin", "POST", "/api/v1/auth/login/options", { body: {} });
      ctx.expectStatus("auth.login.options.bad-origin", one, 200);
      const evilOrigin = member.authenticator.assert(one.body.options, { origin: "http://evil.example", rpId: "localhost" });
      const badOrigin = await ctx.call("auth.login.verify.bad-origin", "POST", "/api/v1/auth/login/verify", { body: { challengeId: one.body.challengeId, response: evilOrigin } });
      ctx.expectStatus("auth.login.verify.bad-origin", badOrigin, 401);
      ctx.add("a wrong origin is refused", code(badOrigin.body) === "invalid_credentials", "invalid_credentials", code(badOrigin.body));

      const two = await ctx.call<OptionsResponse>("auth.login.options.bad-rpid", "POST", "/api/v1/auth/login/options", { body: {} });
      ctx.expectStatus("auth.login.options.bad-rpid", two, 200);
      const evilRp = member.authenticator.assert(two.body.options, { origin: ctx.side.origin, rpId: "evil.example" });
      const badRp = await ctx.call("auth.login.verify.bad-rpid", "POST", "/api/v1/auth/login/verify", { body: { challengeId: two.body.challengeId, response: evilRp } });
      ctx.expectStatus("auth.login.verify.bad-rpid", badRp, 401);
      ctx.add("a wrong rpId is refused", code(badRp.body) === "invalid_credentials", "invalid_credentials", code(badRp.body));

      const three = await ctx.call<OptionsResponse>("auth.login.options.good", "POST", "/api/v1/auth/login/options", { body: {} });
      const good = member.authenticator.assert(three.body.options, { origin: ctx.side.origin, rpId: "localhost" });
      const ok = await ctx.call("auth.login.verify.good", "POST", "/api/v1/auth/login/verify", { body: { challengeId: three.body.challengeId, response: good } });
      ctx.expectStatus("auth.login.verify.good", ok, 200);
    },
  },
  {
    id: "E2E-AUTH-06",
    area: "AUTH",
    title: "A challenge cannot be replayed",
    capability: "Challenge single-use (plan §4.2)",
    oracles: ["TS", "SEC"],
    world: "household",
    run: async (ctx) => {
      const member = actor(ctx, "member");
      const start = await ctx.call<OptionsResponse>("auth.login.options", "POST", "/api/v1/auth/login/options", { body: {} });
      ctx.expectStatus("auth.login.options", start, 200);
      const response = member.authenticator.assert(start.body.options, { origin: ctx.side.origin, rpId: "localhost" });
      const payload = { challengeId: start.body.challengeId, response };
      const first = await ctx.call("auth.login.verify.first", "POST", "/api/v1/auth/login/verify", { body: payload });
      ctx.expectStatus("auth.login.verify.first", first, 200);
      const second = await ctx.call("auth.login.verify.replay", "POST", "/api/v1/auth/login/verify", { body: payload });
      ctx.expectStatus("auth.login.verify.replay", second, [400, 401, 403, 409, 422]);
      ctx.add("a replayed challenge is refused", code(second.body) === "invalid_challenge", "invalid_challenge", code(second.body));
    },
  },
  {
    id: "E2E-AUTH-07",
    area: "AUTH",
    title: "Logout clears the cookie and the session",
    capability: "Logout (API.md)",
    oracles: ["TS", "SEC"],
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const res = await admin.logout();
      ctx.expectStatus("auth.logout", res, 200);
      ctx.add("logout answers ok", (res.body as any)?.ok === true, true, (res.body as any)?.ok);
      const cleared = [...ctx.side.exchanges].reverse().find((e) => e.label === "auth.logout")?.setCookies.join("\n") ?? "";
      ctx.add("logout clears the session cookie", /alice_session=;|Max-Age=0/i.test(cleared), "cleared cookie", cleared.split("\n")[0] ?? "");
      const session = await admin.session();
      ctx.expectStatus("auth.session.after-logout", session, 401);
      ctx.add("the session is gone", code(session.body) === "unauthenticated", "unauthenticated", code(session.body));
      const sessions = await admin.listSessions();
      ctx.expectStatus("auth.sessions.after-logout", sessions, 401);
    },
  },
  {
    id: "E2E-AUTH-08",
    area: "AUTH",
    title: "A user lists their sessions and revokes another one",
    capability: "Session list/revoke (plan §4.2)",
    oracles: ["TS", "SEC"],
    world: "household",
    run: async (ctx) => {
      const base = actor(ctx, "admin");
      const other = await base.freshSession();
      const baseList = await base.listSessions();
      const otherList = await other.listSessions();
      ctx.expectStatus("auth.sessions.base", baseList, 200);
      ctx.expectStatus("auth.sessions.other", otherList, 200);
      const a = (baseList.body as { sessions?: { id: string; current: boolean }[] })?.sessions ?? [];
      const b = (otherList.body as { sessions?: { id: string; current: boolean }[] })?.sessions ?? [];
      ctx.add("both jars list the same sessions", a.length === b.length && a.every((x) => b.some((y) => y.id === x.id)), "same ids", `${a.length}/${b.length}`);
      ctx.add("each caller marks exactly one session current", a.filter((x) => x.current).length === 1 && b.filter((x) => x.current).length === 1, 1, `${a.filter((x) => x.current).length}/${b.filter((x) => x.current).length}`);
      const baseCurrent = a.find((x) => x.current)?.id;
      ctx.add("the sessions are different", !!baseCurrent && baseCurrent !== b.find((x) => x.current)?.id, "different ids", `${baseCurrent} / ${b.find((x) => x.current)?.id}`);
      if (baseCurrent) {
        const revoke = await other.revokeSession(baseCurrent);
        ctx.expectStatus("auth.sessions.revoke", revoke, 200);
        const after = await base.session();
        ctx.expectStatus("auth.session.revoked", after, 401);
        const remaining = await other.listSessions();
        const list = (remaining.body as { sessions?: unknown[] })?.sessions ?? [];
        ctx.add("only the caller's own session remains", list.length === 1, 1, list.length);
      }
      const missing = await other.revokeSession("ses_00000000000000000000000000");
      ctx.expectStatus("auth.sessions.revoke.missing", missing, 404);
      ctx.add("an unknown session is not found", code(missing.body) === "not_found", "not_found", code(missing.body));
    },
  },
  {
    id: "E2E-AUTH-09",
    area: "AUTH",
    title: "A write needs the same-origin and requested-with headers",
    capability: "CSRF/SameSite (plan §4.2, csrf.e2e)",
    oracles: ["TS", "SEC"],
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const evil = await admin.call("auth.logout.evil-origin", "POST", "/api/v1/auth/logout", { body: {}, origin: "http://evil.example" });
      ctx.expectStatus("auth.logout.evil-origin", evil, 403);
      ctx.add("a cross-site write is blocked", code(evil.body) === "csrf_blocked", "csrf_blocked", code(evil.body));
      const bare = await admin.call("auth.logout.no-origin", "POST", "/api/v1/auth/logout", { body: {}, origin: null, requestedWith: null });
      ctx.expectStatus("auth.logout.no-origin", bare, 403);
      ctx.add("a write with no origin is blocked", code(bare.body) === "csrf_blocked", "csrf_blocked", code(bare.body));
      const ok = await admin.logout();
      ctx.expectStatus("auth.logout.same-origin", ok, 200);
      const after = await admin.session();
      ctx.expectStatus("auth.session.after", after, 401);
    },
  },
  {
    id: "E2E-AUTH-10",
    area: "AUTH",
    title: "A recovery code opens a restricted session, once",
    capability: "Recovery sign-in (plan §4.2)",
    oracles: ["TS", "SEC"],
    world: "household",
    run: async (ctx) => {
      const member = actor(ctx, "member");
      const recovery = member.recoveryCodes[0];
      ctx.add("the member has a recovery code", typeof recovery === "string", true, typeof recovery);
      if (!recovery) return;
      const codeValue = recovery.toLowerCase();
      const login = await ctx.call("auth.recovery.verify", "POST", "/api/v1/auth/recovery/verify", { body: { code: codeValue } });
      ctx.expectStatus("auth.recovery.verify", login, 200);
      ctx.add("recovery marks the session restricted", (login.body as any)?.restricted === true, true, (login.body as any)?.restricted);
      const session = await ctx.call("auth.session.recovery", "GET", "/api/v1/auth/session");
      ctx.expectStatus("auth.session.recovery", session, 200);
      ctx.add("the recovery session is restricted", (session.body as any)?.restricted === true, true, (session.body as any)?.restricted);
      ctx.add("the recovery session is not stepped up", (session.body as any)?.steppedUp === false, false, (session.body as any)?.steppedUp);
      const passkeys = await ctx.call("auth.passkeys.recovery", "GET", "/api/v1/auth/passkeys");
      ctx.expectStatus("auth.passkeys.recovery", passkeys, 200);
      const household = await ctx.call("household.recovery", "GET", "/api/v1/household");
      ctx.expectStatus("household.recovery", household, 403);
      ctx.add("a restricted session cannot read the household", code(household.body) === "restricted_session", "restricted_session", code(household.body));
      const reuse = await ctx.call("auth.recovery.verify.reuse", "POST", "/api/v1/auth/recovery/verify", { body: { code: codeValue } });
      ctx.expectStatus("auth.recovery.verify.reuse", reuse, 401);
      ctx.add("a recovery code works once", code(reuse.body) === "invalid_credentials", "invalid_credentials", code(reuse.body));
    },
  },
  {
    id: "E2E-AUTH-11",
    area: "AUTH",
    title: "Passkeys can be added, listed and deleted; the last one cannot go",
    capability: "Passkey management (plan §4.2)",
    oracles: ["TS", "SPEC"],
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const added = await admin.addPasskey("parity laptop");
      ctx.expectStatus("auth.passkeys.options", added.start, 200);
      ctx.expectStatus("auth.passkeys.verify", added.verify, 200);
      const listed = await admin.listPasskeys();
      ctx.expectStatus("auth.passkeys.list", listed, 200);
      const passkeys = (listed.body as { passkeys?: { id: string; deviceLabel?: string | null }[] })?.passkeys ?? [];
      ctx.add("the user has two passkeys", passkeys.length === 2, 2, passkeys.length);
      const fresh = passkeys.find((p) => p.deviceLabel === "parity laptop");
      ctx.add("the new passkey has its label", !!fresh, "parity laptop", passkeys.map((p) => p.deviceLabel).join(","));
      if (fresh) {
        const removed = await admin.deletePasskey(fresh.id);
        ctx.expectStatus("auth.passkeys.delete", removed, 200);
        const after = await admin.listPasskeys();
        const left = (after.body as { passkeys?: { id: string }[] })?.passkeys ?? [];
        ctx.add("deleting a passkey removes it", left.length === 1, 1, left.length);
        if (left[0]) {
          const last = await admin.deletePasskey(left[0].id);
          ctx.expectStatus("auth.passkeys.delete.last", last, 409);
          ctx.add("the last passkey cannot be deleted", code(last.body) === "conflict", "conflict", code(last.body));
        }
      }
      const missing = await admin.deletePasskey("pky_00000000000000000000000000");
      ctx.expectStatus("auth.passkeys.delete.missing", missing, 404);
      ctx.add("an unknown passkey is not found", code(missing.body) === "not_found", "not_found", code(missing.body));
    },
  },
  {
    id: "E2E-AUTH-12",
    area: "AUTH",
    title: "Step-up needs a fresh user-verified assertion from the same user",
    capability: "Step-up (plan §4.2)",
    oracles: ["TS", "SEC"],
    world: "household",
    run: async (ctx) => {
      const member = actor(ctx, "member");
      const guest = actor(ctx, "guest");
      const start = await member.call<OptionsResponse>("auth.step-up.options", "POST", "/api/v1/auth/step-up/options", { body: {} });
      ctx.expectStatus("auth.step-up.options", start, 200);
      ctx.add("step-up asks for user verification", start.body.options.userVerification === "required", "required", start.body.options.userVerification);
      const noUv = member.authenticator.assert(start.body.options, { origin: ctx.side.origin, rpId: "localhost", uv: false });
      const refusedUv = await member.call("auth.step-up.verify.no-uv", "POST", "/api/v1/auth/step-up/verify", { body: { challengeId: start.body.challengeId, response: noUv } });
      ctx.expectStatus("auth.step-up.verify.no-uv", refusedUv, 401);
      ctx.add("a step-up without user verification is refused", code(refusedUv.body) === "invalid_credentials", "invalid_credentials", code(refusedUv.body));

      const wrongStart = await member.call<OptionsResponse>("auth.step-up.options.wrong-user", "POST", "/api/v1/auth/step-up/options", { body: {} });
      const wrong = guest.authenticator.assert(wrongStart.body.options, { origin: ctx.side.origin, rpId: "localhost", uv: true, ignoreAllowCredentials: true });
      const refusedUser = await member.call("auth.step-up.verify.wrong-user", "POST", "/api/v1/auth/step-up/verify", { body: { challengeId: wrongStart.body.challengeId, response: wrong } });
      ctx.expectStatus("auth.step-up.verify.wrong-user", refusedUser, 401);
      ctx.add("another person's passkey cannot step up", code(refusedUser.body) === "invalid_credentials", "invalid_credentials", code(refusedUser.body));

      const verified = await member.stepUp();
      ctx.expectStatus("auth.step-up.verify", verified.verify, 200);
      ctx.add("step-up answers steppedUp", (verified.verify.body as any)?.steppedUp === true, true, (verified.verify.body as any)?.steppedUp);
      const session = await member.session();
      ctx.add("the session is stepped up afterwards", (session.body as any)?.steppedUp === true, true, (session.body as any)?.steppedUp);
    },
  },
  {
    id: "E2E-AUTH-13",
    area: "AUTH",
    title: "Public auth calls are rate limited with Retry-After",
    capability: "Rate limits (plan §4.2)",
    oracles: ["TS", "SEC"],
    world: "household",
    run: async (ctx) => {
      let limited: { status: number; headers: Record<string, string>; body: unknown } | null = null;
      let calls = 0;
      let serverErrors = 0;
      for (let i = 0; i < 40 && !limited; i++) {
        const res = await ctx.call(`auth.login.options.${i}`, "POST", "/api/v1/auth/login/options", { body: {} });
        calls++;
        if (res.status >= 500) serverErrors++;
        if (res.status === 429) limited = { status: res.status, headers: res.headers, body: res.body };
      }
      ctx.add("a 429 arrives within 40 calls", !!limited, true, limited ? `after ${calls}` : "never");
      ctx.add("no auth call returned 5xx", serverErrors === 0, 0, serverErrors);
      if (limited) {
        ctx.add("the limit uses rate_limited", code(limited.body) === "rate_limited", "rate_limited", code(limited.body));
        const retry = Object.entries(limited.headers).find(([k]) => k.toLowerCase() === "retry-after")?.[1];
        ctx.add("Retry-After is a positive integer", !!retry && /^\d+$/.test(retry) && Number(retry) > 0, "integer", retry ?? "absent");
      }
    },
  },
  {
    id: "E2E-AUTH-14",
    area: "AUTH",
    title: "Challenge, step-up and session expiry",
    capability: "Expiry windows (plan §4.2)",
    oracles: ["SPEC"],
    blocked: "TS has no challenge/step-up/session TTL environment knob and Kotlin does; expiry is real-time and belongs to the slow tier (M8), per RUNBOOK §2.3.",
  },
  {
    id: "E2E-AUTH-15",
    area: "AUTH",
    title: "Revoke-all on credential change and the UV-only policy",
    capability: "Credential-change policy; UV-required login (plan §4.2)",
    oracles: ["SPEC"],
    blocked: "Neither backend revokes sibling sessions on a passkey change (source-read), and REQUIRE_UV_AT_LOGIN exists only in Kotlin, so there is no TS oracle to compare.",
  },
];
