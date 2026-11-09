import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../../core/database/client";
import { passkeys, recoveryCodes, sessions, userPreferences, users, webauthnChallenges } from "../../core/database/schema";
import type { DbLike } from "../../core/database/types";
import { AppError, conflict, notFound } from "../../core/errors/errors";
import { newId } from "../../core/ids";
import { writeAudit } from "../../core/security/audit";
import { normalizeCode, randomToken, recoveryCode, sha256 } from "../../core/security/tokens";
import type { HouseholdService } from "../households/household.service";

export interface AuthConfig {
  rpId: string;
  rpName: string;
  origin: string;
  sessionTtlHours: number;
  /** When set, the first person to register on a new install must give it. */
  setupCode?: string | null;
  /** How long after a passkey assertion a session counts as "stepped up". */
  stepUpTtlMs?: number;
  challengeTtlMs?: number;
}

export interface SessionContext {
  sessionId: string;
  userId: string;
  expiresAt: number;
  steppedUp: boolean;
  /** Recovery sessions can only add a passkey. */
  restricted: boolean;
  /** Set when this request renewed the session: the new expiry, so the cookie can be refreshed to match. */
  renewedUntil?: number;
}

/** A session that keeps being used is renewed, but never lives longer than this in all. */
export const MAX_SESSION_AGE_HOURS = 90 * 24;

export interface SignedIn {
  user: { id: string; displayName: string };
  session: { token: string; expiresAt: number };
  household: { id: string; role: string } | null;
}

const HOUR = 3_600_000;
const unauthorized = (msg = "Authentication failed") => new AppError(401, "invalid_credentials", msg);
const timingSafeEq = (a: string, b: string) => sha256(a) === sha256(b); // equal-length digests; a plain compare on the raw codes would leak length and prefix
const b64ToBytes = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
const bytesToB64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");

/** How long the browser waits for a passkey. The default (60 s) is too short for "use your phone": scanning, unlocking and approving takes longer. Matches the server's challenge lifetime. */
const PROMPT_TIMEOUT_MS = 5 * 60_000;

export class AuthService {
  private readonly stepUpTtl: number;
  private readonly challengeTtl: number;

  constructor(
    private readonly db: Db,
    private readonly households: HouseholdService,
    private readonly cfg: AuthConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.stepUpTtl = cfg.stepUpTtlMs ?? 5 * 60_000;
    this.challengeTtl = cfg.challengeTtlMs ?? 5 * 60_000;
  }

  // ---- challenges ----

  private saveChallenge(purpose: (typeof webauthnChallenges.$inferInsert)["purpose"], challenge: string, userId: string | null, data: Record<string, unknown> | null) {
    const id = newId("chl");
    this.db.insert(webauthnChallenges).values({ id, userId, challenge, purpose, data, expiresAt: this.now() + this.challengeTtl }).run();
    return id;
  }

  /** Single use, even if verification then fails, so a captured challenge cannot be retried. */
  private takeChallenge(id: string, purpose: (typeof webauthnChallenges.$inferInsert)["purpose"]) {
    const row = this.db.update(webauthnChallenges).set({ usedAt: this.now() })
      .where(and(eq(webauthnChallenges.id, id), eq(webauthnChallenges.purpose, purpose), isNull(webauthnChallenges.usedAt), gt(webauthnChallenges.expiresAt, this.now())))
      .returning().get();
    if (!row) throw new AppError(400, "invalid_challenge", "That sign-in attempt expired. Please try again");
    return row;
  }

  /** True until the first person has registered: the app shows the "set up your home" screen. */
  needsSetup(): boolean {
    return this.db.select({ id: users.id }).from(users).limit(1).get() === undefined;
  }

  /** Does the first registration need a setup code? */
  setupCodeRequired(): boolean {
    return !!this.cfg.setupCode && this.needsSetup();
  }

  // ---- registration (first user, or invited user) ----

  async registrationOptions(input: { displayName: string; inviteCode?: string; setupCode?: string }) {
    const displayName = input.displayName.trim();
    if (displayName.length < 1 || displayName.length > 60) throw new AppError(400, "validation_error", "Name must be 1 to 60 characters");
    const first = this.db.select({ id: users.id }).from(users).limit(1).get() === undefined;
    if (!first) {
      if (!input.inviteCode) throw new AppError(403, "invite_required", "You need an invitation to join this home");
      this.households.findValidInvitation(input.inviteCode);
    } else if (this.cfg.setupCode && !timingSafeEq(input.setupCode ?? "", this.cfg.setupCode)) {
      throw new AppError(403, "setup_code_required", "Enter the setup code from the server log (or the SETUP_CODE setting)");
    }
    const userId = newId("usr");
    const options = await generateRegistrationOptions({
      rpName: this.cfg.rpName, rpID: this.cfg.rpId, userName: displayName, userDisplayName: displayName,
      userID: new TextEncoder().encode(userId), attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      timeout: PROMPT_TIMEOUT_MS,
    });
    const challengeId = this.saveChallenge("register", options.challenge, userId, { displayName, inviteCode: input.inviteCode ?? null });
    return { challengeId, options };
  }

  async verifyRegistration(input: { challengeId: string; response: RegistrationResponseJSON; deviceLabel?: string; userAgent?: string }) {
    const ch = this.takeChallenge(input.challengeId, "register");
    const v = await verifyRegistrationResponse({
      response: input.response, expectedChallenge: ch.challenge, expectedOrigin: this.cfg.origin, expectedRPID: this.cfg.rpId, requireUserVerification: false,
    }).catch(() => null);
    if (!v?.verified) throw unauthorized("Could not verify the passkey");
    const { credential } = v.registrationInfo;
    const data = ch.data as { displayName: string; inviteCode: string | null };
    const userId = ch.userId!;
    const t = this.now();

    return this.db.transaction((tx) => {
      const first = tx.select({ id: users.id }).from(users).limit(1).get() === undefined;
      if (!first && !data.inviteCode) throw new AppError(403, "invite_required", "You need an invitation to join this home");

      tx.insert(users).values({ id: userId, displayName: data.displayName, createdAt: t }).run();
      tx.insert(userPreferences).values({ userId }).run();
      this.insertPasskey(tx, userId, credential, input.deviceLabel);

      let household: { id: string; role: string };
      if (first) {
        household = { id: this.households.createHousehold(tx, "Home", userId), role: "admin" };
      } else {
        const m = this.households.consumeInvitation(tx, data.inviteCode!, userId);
        household = { id: m.householdId, role: m.role };
      }
      const codes = this.createRecoveryCodes(tx, userId);
      const session = this.createSession(tx, userId, { userAgent: input.userAgent, steppedUp: true });
      writeAudit(tx, { householdId: household.id, actorId: userId, action: first ? "auth.first_user_registered" : "auth.user_joined", resource: userId }, t);
      return { user: { id: userId, displayName: data.displayName }, household, session, recoveryCodes: codes } satisfies SignedIn & { recoveryCodes: string[] };
    });
  }

  private insertPasskey(tx: DbLike, userId: string, c: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] }, label?: string) {
    tx.insert(passkeys).values({
      id: c.id, userId, publicKey: bytesToB64(c.publicKey), counter: c.counter, transports: c.transports ?? null,
      deviceLabel: label?.slice(0, 80) ?? null, createdAt: this.now(),
    }).run();
  }

  // ---- login ----

  async loginOptions() {
    const options = await generateAuthenticationOptions({ rpID: this.cfg.rpId, userVerification: "preferred", timeout: PROMPT_TIMEOUT_MS });
    return { challengeId: this.saveChallenge("login", options.challenge, null, null), options };
  }

  async verifyLogin(input: { challengeId: string; response: AuthenticationResponseJSON; userAgent?: string }): Promise<SignedIn> {
    const ch = this.takeChallenge(input.challengeId, "login");
    const passkey = this.db.select().from(passkeys).where(eq(passkeys.id, input.response.id)).get();
    if (!passkey) throw unauthorized();
    await this.verifyAssertion(input.response, ch.challenge, passkey);
    const user = this.db.select().from(users).where(eq(users.id, passkey.userId)).get();
    if (!user) throw unauthorized();
    const membership = this.households.getMembership(user.id);
    if (!membership) throw new AppError(403, "access_expired", "Your access to this home has ended");
    const session = this.db.transaction((tx) => this.createSession(tx, user.id, { userAgent: input.userAgent, steppedUp: true }));
    return { user: { id: user.id, displayName: user.displayName }, session, household: { id: membership.householdId, role: membership.role } };
  }

  /** Verifies an assertion and advances the stored signature counter (replay protection). */
  private async verifyAssertion(response: AuthenticationResponseJSON, challenge: string, passkey: typeof passkeys.$inferSelect, requireUserVerification = false) {
    const v = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: this.cfg.origin, expectedRPID: this.cfg.rpId, requireUserVerification,
      credential: { id: passkey.id, publicKey: b64ToBytes(passkey.publicKey), counter: passkey.counter, transports: (passkey.transports ?? undefined) as AuthenticatorTransport[] | undefined },
    }).catch(() => null);
    if (!v?.verified) throw unauthorized();
    this.db.update(passkeys).set({ counter: v.authenticationInfo.newCounter, lastUsedAt: this.now() }).where(eq(passkeys.id, passkey.id)).run();
  }

  // ---- step-up ----

  async stepUpOptions(s: SessionContext) {
    const mine = this.db.select().from(passkeys).where(eq(passkeys.userId, s.userId)).all();
    const options = await generateAuthenticationOptions({
      rpID: this.cfg.rpId, userVerification: "required", timeout: PROMPT_TIMEOUT_MS,
      allowCredentials: mine.map((p) => ({ id: p.id, transports: (p.transports ?? undefined) as AuthenticatorTransport[] | undefined })),
    });
    return { challengeId: this.saveChallenge("step_up", options.challenge, s.userId, { sessionId: s.sessionId }), options };
  }

  async verifyStepUp(s: SessionContext, input: { challengeId: string; response: AuthenticationResponseJSON }) {
    const ch = this.takeChallenge(input.challengeId, "step_up");
    if (ch.userId !== s.userId || (ch.data as { sessionId?: string } | null)?.sessionId !== s.sessionId) throw unauthorized();
    const passkey = this.db.select().from(passkeys).where(and(eq(passkeys.id, input.response.id), eq(passkeys.userId, s.userId))).get();
    if (!passkey) throw unauthorized();
    await this.verifyAssertion(input.response, ch.challenge, passkey, true); // step-up must prove the user, not just the device
    this.db.update(sessions).set({ lastStepUpAt: this.now() }).where(eq(sessions.id, s.sessionId)).run();
    writeAudit(this.db, { actorId: s.userId, action: "auth.step_up", resource: s.sessionId }, this.now());
  }

  // ---- adding passkeys ----

  async addPasskeyOptions(s: SessionContext) {
    if (!s.restricted && !s.steppedUp) throw new AppError(403, "step_up_required", "Confirm with your passkey first");
    const user = this.db.select().from(users).where(eq(users.id, s.userId)).get();
    if (!user) throw notFound("User");
    const existing = this.db.select().from(passkeys).where(eq(passkeys.userId, s.userId)).all();
    const options = await generateRegistrationOptions({
      rpName: this.cfg.rpName, rpID: this.cfg.rpId, userName: user.displayName, userDisplayName: user.displayName,
      userID: new TextEncoder().encode(user.id), attestationType: "none",
      excludeCredentials: existing.map((p) => ({ id: p.id })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      timeout: PROMPT_TIMEOUT_MS,
    });
    return { challengeId: this.saveChallenge("add_passkey", options.challenge, s.userId, { sessionId: s.sessionId }), options };
  }

  async verifyAddPasskey(s: SessionContext, input: { challengeId: string; response: RegistrationResponseJSON; deviceLabel?: string }) {
    const ch = this.takeChallenge(input.challengeId, "add_passkey");
    if (ch.userId !== s.userId) throw unauthorized();
    const v = await verifyRegistrationResponse({
      response: input.response, expectedChallenge: ch.challenge, expectedOrigin: this.cfg.origin, expectedRPID: this.cfg.rpId, requireUserVerification: false,
    }).catch(() => null);
    if (!v?.verified) throw unauthorized("Could not verify the passkey");
    this.db.transaction((tx) => {
      this.insertPasskey(tx, s.userId, v.registrationInfo.credential, input.deviceLabel);
      if (s.restricted) tx.update(sessions).set({ restricted: false, lastStepUpAt: this.now() }).where(eq(sessions.id, s.sessionId)).run();
      writeAudit(tx, { actorId: s.userId, action: "auth.passkey_added", resource: v.registrationInfo.credential.id }, this.now());
    });
  }

  listPasskeys(userId: string) {
    return this.db.select({ id: passkeys.id, deviceLabel: passkeys.deviceLabel, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt })
      .from(passkeys).where(eq(passkeys.userId, userId)).orderBy(asc(passkeys.createdAt)).all();
  }

  deletePasskey(userId: string, id: string) {
    const mine = this.db.select().from(passkeys).where(eq(passkeys.userId, userId)).all();
    if (!mine.some((p) => p.id === id)) throw notFound("Passkey");
    if (mine.length <= 1) throw conflict("You need at least one passkey");
    this.db.delete(passkeys).where(eq(passkeys.id, id)).run();
    writeAudit(this.db, { actorId: userId, action: "auth.passkey_removed", resource: id }, this.now());
  }

  // ---- recovery ----

  private createRecoveryCodes(tx: DbLike, userId: string, n = 10): string[] {
    const codes = Array.from({ length: n }, () => recoveryCode());
    for (const c of codes) tx.insert(recoveryCodes).values({ id: newId("rec"), userId, codeHash: sha256(normalizeCode(c)), createdAt: this.now() }).run();
    return codes;
  }

  /** Replaces all unused codes. Needs a fresh step-up. */
  regenerateRecoveryCodes(s: SessionContext): string[] {
    if (!s.steppedUp) throw new AppError(403, "step_up_required", "Confirm with your passkey first");
    return this.db.transaction((tx) => {
      tx.delete(recoveryCodes).where(and(eq(recoveryCodes.userId, s.userId), isNull(recoveryCodes.usedAt))).run();
      writeAudit(tx, { actorId: s.userId, action: "auth.recovery_codes_regenerated" }, this.now());
      return this.createRecoveryCodes(tx, s.userId);
    });
  }

  /** A recovery code opens a restricted session that can only add a new passkey. */
  recoveryLogin(code: string, userAgent?: string): SignedIn {
    const row = this.db.update(recoveryCodes).set({ usedAt: this.now() })
      .where(and(eq(recoveryCodes.codeHash, sha256(normalizeCode(code))), isNull(recoveryCodes.usedAt))).returning().get();
    if (!row) throw unauthorized("That recovery code is not valid");
    const user = this.db.select().from(users).where(eq(users.id, row.userId)).get()!;
    const membership = this.households.getMembership(user.id);
    if (!membership) throw new AppError(403, "access_expired", "Your access to this home has ended");
    const session = this.db.transaction((tx) => {
      writeAudit(tx, { householdId: membership.householdId, actorId: user.id, action: "auth.recovery_used" }, this.now());
      return this.createSession(tx, user.id, { userAgent, restricted: true });
    });
    return { user: { id: user.id, displayName: user.displayName }, session, household: { id: membership.householdId, role: membership.role } };
  }

  // ---- sessions ----

  private createSession(tx: DbLike, userId: string, o: { userAgent?: string; steppedUp?: boolean; restricted?: boolean }) {
    const token = randomToken();
    const t = this.now();
    const expiresAt = t + this.cfg.sessionTtlHours * HOUR;
    tx.insert(sessions).values({
      id: newId("ses"), userId, tokenHash: sha256(token), createdAt: t, expiresAt, lastSeenAt: t, userAgent: o.userAgent?.slice(0, 200) ?? null,
      lastStepUpAt: o.steppedUp ? t : null, restricted: o.restricted ?? false,
    }).run();
    return { token, expiresAt };
  }

  /** Resolves a session token to a context, or null if unknown, revoked or expired. */
  getSession(token: string | undefined): SessionContext | null {
    if (!token) return null;
    const row = this.db.select().from(sessions).where(eq(sessions.tokenHash, sha256(token))).get();
    const t = this.now();
    if (!row || row.revokedAt !== null || row.expiresAt <= t) return null;
    if (t - row.lastSeenAt > 60_000) this.db.update(sessions).set({ lastSeenAt: t }).where(eq(sessions.id, row.id)).run();
    // Sliding expiry: once more than half the time is used, a session that is still in use is pushed out again (up to the cap).
    // A recovery session is never renewed: it exists only to add a passkey.
    let expiresAt = row.expiresAt, renewedUntil: number | undefined;
    const ttl = this.cfg.sessionTtlHours * HOUR;
    if (!row.restricted && row.expiresAt - t < ttl / 2) {
      const next = Math.min(t + ttl, row.createdAt + MAX_SESSION_AGE_HOURS * HOUR);
      if (next > row.expiresAt + 60_000) { this.db.update(sessions).set({ expiresAt: next }).where(eq(sessions.id, row.id)).run(); expiresAt = renewedUntil = next; }
    }
    return {
      sessionId: row.id, userId: row.userId, expiresAt, restricted: row.restricted, ...(renewedUntil ? { renewedUntil } : {}),
      steppedUp: row.lastStepUpAt !== null && t - row.lastStepUpAt < this.stepUpTtl,
    };
  }

  /** Is this session still valid (not revoked, not expired)? Long-lived sockets re-check this. */
  isSessionActive(sessionId: string): boolean {
    const row = this.db.select({ revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.id, sessionId)).get();
    return !!row && row.revokedAt === null && row.expiresAt > this.now();
  }

  logout(sessionId: string) {
    this.db.update(sessions).set({ revokedAt: this.now() }).where(eq(sessions.id, sessionId)).run();
  }

  listSessions(userId: string) {
    return this.db.select({ id: sessions.id, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt, userAgent: sessions.userAgent })
      .from(sessions).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, this.now()))).orderBy(desc(sessions.lastSeenAt)).all();
  }

  revokeSession(userId: string, id: string) {
    const hit = this.db.update(sessions).set({ revokedAt: this.now() }).where(and(eq(sessions.id, id), eq(sessions.userId, userId), isNull(sessions.revokedAt))).returning({ id: sessions.id }).all();
    if (!hit.length) throw notFound("Session");
  }
}
