import { Elysia, t } from "elysia";
import { env } from "../../core/config/env";
import { clientIp, enforce } from "../../core/http/rate-limit";
import { COOKIE, requireMember, requireSession, requireStepUp, sessionCookieOptions } from "../../core/http/guards";
import { sessionPlugin } from "../../core/http/session-plugin";
import type { Services } from "../../services";
import type { SignedIn } from "./auth.service";

const anyJson = t.Any();

/** Authentication routes. `/auth/*` is the only public surface besides /health. */
export const authController = ({ auth, households, limits }: Services) => {
  const setCookie = (cookie: Record<string, { set: (o: object) => unknown }>, s: SignedIn["session"]) =>
    cookie[COOKIE]!.set({ value: s.token, ...sessionCookieOptions(s.expiresAt, env.webauthn.origin.startsWith("https:")) });

  /** Per-IP limit on every public auth call; `secret` adds the strict limits for code-guessing endpoints. */
  const throttle = (ctx: { request: Request; server?: unknown }, opts: { secret?: boolean } = {}) => {
    const ip = clientIp(ctx.request, ctx.server as never, env.trustProxy);
    enforce(limits.auth, ip);
    if (opts.secret) {
      enforce(limits.secrets, ip);
      enforce(limits.secretsGlobal, "all");
    }
  };

  const publicSignedIn = (r: SignedIn) => ({ user: r.user, household: r.household, expiresAt: r.session.expiresAt });

  return new Elysia({ name: "module.auth", prefix: "/auth", tags: ["auth"] })
    .use(sessionPlugin(auth, households))
    .get("/setup", (ctx) => { throttle(ctx); return { needsSetup: auth.needsSetup(), setupCodeRequired: auth.setupCodeRequired() }; }, { detail: { summary: "Is this a brand new install? (public; says only whether anyone has registered)" } })
    // ---- registration ----
    .post("/register/options", (ctx) => { throttle(ctx, { secret: !!ctx.body.inviteCode || auth.setupCodeRequired() }); return auth.registrationOptions(ctx.body); }, {
      body: t.Object({ displayName: t.String(), inviteCode: t.Optional(t.String()), setupCode: t.Optional(t.String({ maxLength: 100 })) }),
      detail: { summary: "Start passkey registration (first user with the setup code when one is set, or with an invitation code)" },
    })
    .post("/register/verify", async ({ body, cookie, headers, ...ctx }) => {
      throttle(ctx as never);
      const r = await auth.verifyRegistration({ ...body, userAgent: headers["user-agent"] });
      setCookie(cookie, r.session);
      return { ...publicSignedIn(r), recoveryCodes: r.recoveryCodes };
    }, {
      body: t.Object({ challengeId: t.String(), response: anyJson, deviceLabel: t.Optional(t.String()) }),
      detail: { summary: "Finish registration. Returns the recovery codes once" },
    })
    // ---- login ----
    .post("/login/options", (ctx) => { throttle(ctx); return auth.loginOptions(); }, { detail: { summary: "Start passkey sign-in (no username needed)" } })
    .post("/login/verify", async ({ body, cookie, headers, ...ctx }) => {
      throttle(ctx as never);
      const r = await auth.verifyLogin({ ...body, userAgent: headers["user-agent"] });
      setCookie(cookie, r.session);
      return publicSignedIn(r);
    }, { body: t.Object({ challengeId: t.String(), response: anyJson }), detail: { summary: "Finish sign-in and set the session cookie" } })
    .post("/logout", ({ cookie, ...ctx }) => {
      const s = requireSession(ctx, { allowRestricted: true });
      auth.logout(s.sessionId);
      cookie[COOKIE]!.remove();
      return { ok: true };
    })
    .get("/session", (ctx) => {
      const s = requireSession(ctx, { allowRestricted: true });
      return { userId: s.userId, expiresAt: s.expiresAt, steppedUp: s.steppedUp, restricted: s.restricted, household: ctx.membership ? { id: ctx.membership.householdId, role: ctx.membership.role, expiresAt: ctx.membership.expiresAt } : null };
    })
    // ---- sessions ----
    .get("/sessions", (ctx) => ({ sessions: auth.listSessions(requireSession(ctx).userId).map((x) => ({ ...x, current: x.id === ctx.session!.sessionId })) }))
    .delete("/sessions/:id", (ctx) => { auth.revokeSession(requireSession(ctx).userId, ctx.params.id); return { ok: true }; })
    // ---- step-up ----
    .post("/step-up/options", (ctx) => auth.stepUpOptions(requireSession(ctx)))
    .post("/step-up/verify", async (ctx) => {
      await auth.verifyStepUp(requireSession(ctx), ctx.body);
      return { steppedUp: true };
    }, { body: t.Object({ challengeId: t.String(), response: anyJson }) })
    // ---- passkeys ----
    .get("/passkeys", (ctx) => ({ passkeys: auth.listPasskeys(requireSession(ctx, { allowRestricted: true }).userId) }))
    .post("/passkeys/options", (ctx) => auth.addPasskeyOptions(requireSession(ctx, { allowRestricted: true })), { detail: { summary: "Add a passkey (needs a recent step-up, or a recovery session)" } })
    .post("/passkeys/verify", async (ctx) => {
      await auth.verifyAddPasskey(requireSession(ctx, { allowRestricted: true }), ctx.body);
      return { ok: true };
    }, { body: t.Object({ challengeId: t.String(), response: anyJson, deviceLabel: t.Optional(t.String()) }) })
    .delete("/passkeys/:id", (ctx) => {
      const s = requireSession(ctx);
      requireStepUp(s);
      auth.deletePasskey(s.userId, ctx.params.id);
      return { ok: true };
    })
    // ---- recovery ----
    .post("/recovery/verify", ({ body, cookie, headers, ...ctx }) => {
      throttle(ctx as never, { secret: true });
      const r = auth.recoveryLogin(body.code, headers["user-agent"]);
      setCookie(cookie, r.session);
      return { ...publicSignedIn(r), restricted: true };
    }, { body: t.Object({ code: t.String() }), detail: { summary: "Sign in with a recovery code. The session can only add a new passkey" } })
    .post("/recovery/regenerate", (ctx) => {
      const { session } = requireMember(ctx);
      return { recoveryCodes: auth.regenerateRecoveryCodes(session) };
    }, { detail: { summary: "Replace unused recovery codes (needs a recent step-up)" } });
};
