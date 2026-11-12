// A test actor: one person on one stack, with their own cookie jar and at least one software passkey.
// Every request an actor makes is appended to the card's exchange list so the differential runner can
// compare the TS and Kotlin transcripts step for step (RUNBOOK §5, §6.4).
import { HttpClient, type HttpResponse, type RequestOptions } from "./http.ts";
import { SoftwareAuthenticator } from "./passkey.ts";
import type { Exchange, Side } from "./scenario.ts";

export interface OptionsResponse {
  challengeId: string;
  options: {
    challenge: string;
    rp?: { id?: string; name?: string };
    user?: { id?: string; name?: string; displayName?: string };
    [key: string]: unknown;
  };
}

export interface SignedInBody {
  user?: { id?: string; displayName?: string; avatarColor?: number };
  household?: { id?: string; role?: string; expiresAt?: number | null } | null;
  expiresAt?: number;
  recoveryCodes?: string[];
  restricted?: boolean;
}

export interface InvitationBody {
  role: "admin" | "member" | "guest";
  expiresInHours?: number;
  guestAccessHours?: number;
}

export interface InvitationCreatedBody {
  // TS nests the invitation; Kotlin returns it flat. Cards assert on the oracle shape.
  invitation?: { id: string; role: string; expiresAt: number; guestAccessMs?: number | null };
  id?: string;
  code: string;
  role?: string;
  expiresAt?: number;
}

export interface PasskeyView {
  id: string;
  deviceLabel?: string | null;
  createdAt?: number;
  lastUsedAt?: number | null;
}

export interface SessionView {
  id: string;
  createdAt?: number;
  lastSeenAt?: number;
  expiresAt?: number;
  userAgent?: string | null;
  current: boolean;
}

function fail(what: string, res: HttpResponse): never {
  throw new Error(`${what}: ${res.status} ${res.text.slice(0, 300)}`);
}

/**
 * One person on one stack. The actor keeps a passkey (`authenticator`), a cookie jar, and the
 * recovery codes registration returned. `freshSession()` proves the passkey again on a new jar so a
 * card can revoke/log out one session without disturbing the base world.
 */
export class Actor {
  readonly http: HttpClient;
  authenticator: SoftwareAuthenticator;
  /** Extra passkeys added during a card, newest last. */
  readonly extraPasskeys: SoftwareAuthenticator[] = [];
  userId?: string;
  householdId?: string;
  role?: string;
  recoveryCodes: string[] = [];

  constructor(
    public readonly side: Side,
    public readonly displayName: string,
    authenticator?: SoftwareAuthenticator,
  ) {
    this.authenticator = authenticator ?? new SoftwareAuthenticator();
    this.authenticator.origin = side.origin;
    this.authenticator.rpId = "localhost";
    this.http = new HttpClient(side.baseUrl, side.backend, side.recorder);
  }

  // ---- request plumbing --------------------------------------------------

  async call<T = unknown>(
    label: string,
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const res = await this.http.request<T>(method, path, opts);
    this.side.exchanges.push(record(label, method, path, res));
    return res;
  }

  private remember(body: SignedInBody): void {
    if (body.user?.id) this.userId = body.user.id;
    if (body.household?.id) this.householdId = body.household.id;
    if (body.household?.role) this.role = body.household.role;
    if (Array.isArray(body.recoveryCodes)) this.recoveryCodes = body.recoveryCodes;
  }

  // ---- registration and sign-in -----------------------------------------

  /** Register the first user of a fresh install with the run's setup code. */
  async registerFirst(setupCode: string): Promise<HttpResponse<SignedInBody>> {
    const opts = await this.beginRegistration({ displayName: this.displayName, setupCode });
    if (opts.status !== 200) return opts as unknown as HttpResponse<SignedInBody>;
    return this.completeRegistration(opts.body);
  }

  /** Register by redeeming an invitation code (invited user, role taken from the invitation). */
  async joinWithInvitation(inviteCode: string): Promise<HttpResponse<SignedInBody>> {
    const opts = await this.beginRegistration({ displayName: this.displayName, inviteCode });
    if (opts.status !== 200) return opts as unknown as HttpResponse<SignedInBody>;
    return this.completeRegistration(opts.body);
  }

  /** Start a registration (first user or invited user) without finishing it. */
  async beginRegistration(body: { displayName?: string; inviteCode?: string; setupCode?: string }): Promise<HttpResponse<OptionsResponse>> {
    return this.call<OptionsResponse>("auth.register.options", "POST", "/api/v1/auth/register/options", {
      body: { displayName: body.displayName ?? this.displayName, ...(body.inviteCode ? { inviteCode: body.inviteCode } : {}), ...(body.setupCode ? { setupCode: body.setupCode } : {}) },
    });
  }

  /** Finish a registration started by `beginRegistration`. */
  async completeRegistration(opts: OptionsResponse): Promise<HttpResponse<SignedInBody>> {
    const response = this.authenticator.register(opts.options, { origin: this.side.origin, rpId: "localhost" });
    const res = await this.call<SignedInBody>("auth.register.verify", "POST", "/api/v1/auth/register/verify", {
      body: { challengeId: opts.challengeId, response },
    });
    if (res.status === 200 || res.status === 201) this.remember(res.body ?? {});
    return res;
  }

  /** Prove the passkey and sign in on this actor's current cookie jar. */
  async login(opts: { uv?: boolean } = {}): Promise<HttpResponse<SignedInBody>> {
    const start = await this.call<OptionsResponse>("auth.login.options", "POST", "/api/v1/auth/login/options", { body: {} });
    if (start.status !== 200) return start as unknown as HttpResponse<SignedInBody>;
    const response = this.authenticator.assert(start.body.options, {
      origin: this.side.origin,
      rpId: "localhost",
      uv: opts.uv ?? true,
    });
    const res = await this.call<SignedInBody>("auth.login.verify", "POST", "/api/v1/auth/login/verify", {
      body: { challengeId: start.body.challengeId, response },
    });
    if (res.status === 200) this.remember(res.body ?? {});
    return res;
  }

  /** A second cookie jar authenticated with the same passkey (for "revoke the other session" cards). */
  async freshSession(): Promise<Actor> {
    const clone = new Actor(this.side, this.displayName, this.authenticator);
    clone.userId = this.userId;
    clone.householdId = this.householdId;
    clone.role = this.role;
    const res = await clone.login();
    if (res.status !== 200) fail("freshSession login", res);
    return clone;
  }

  async logout(): Promise<HttpResponse> {
    return this.call("auth.logout", "POST", "/api/v1/auth/logout", { body: {} });
  }

  /** Begin and finish a step-up; the assertion must carry user verification. */
  async stepUp(): Promise<{ start: HttpResponse<OptionsResponse>; verify: HttpResponse }> {
    const start = await this.call<OptionsResponse>("auth.step-up.options", "POST", "/api/v1/auth/step-up/options", { body: {} });
    if (start.status !== 200) return { start, verify: start as unknown as HttpResponse };
    const response = this.authenticator.assert(start.body.options, { origin: this.side.origin, rpId: "localhost", uv: true });
    const verify = await this.call("auth.step-up.verify", "POST", "/api/v1/auth/step-up/verify", {
      body: { challengeId: start.body.challengeId, response },
    });
    return { start, verify };
  }

  // ---- sessions and passkeys -------------------------------------------

  async session(): Promise<HttpResponse<SignedInBody & { steppedUp?: boolean; restricted?: boolean; userId?: string }>> {
    return this.call("auth.session", "GET", "/api/v1/auth/session");
  }

  async listSessions(): Promise<HttpResponse<{ sessions?: SessionView[] }>> {
    return this.call("auth.sessions.list", "GET", "/api/v1/auth/sessions");
  }

  async revokeSession(id: string): Promise<HttpResponse> {
    return this.call("auth.sessions.revoke", "DELETE", `/api/v1/auth/sessions/${encodeURIComponent(id)}`);
  }

  async listPasskeys(): Promise<HttpResponse<{ passkeys?: PasskeyView[] }>> {
    return this.call("auth.passkeys.list", "GET", "/api/v1/auth/passkeys");
  }

  async addPasskey(label: string): Promise<{ start: HttpResponse<OptionsResponse>; verify: HttpResponse; authenticator: SoftwareAuthenticator }> {
    const start = await this.call<OptionsResponse>("auth.passkeys.options", "POST", "/api/v1/auth/passkeys/options", { body: {} });
    if (start.status !== 200) {
      return { start, verify: start as unknown as HttpResponse, authenticator: this.authenticator };
    }
    const authenticator = new SoftwareAuthenticator();
    authenticator.origin = this.side.origin;
    authenticator.rpId = "localhost";
    if (start.body.options.user?.id) authenticator.userHandle = start.body.options.user.id;
    const response = authenticator.register(start.body.options, { origin: this.side.origin, rpId: "localhost" });
    const verify = await this.call("auth.passkeys.verify", "POST", "/api/v1/auth/passkeys/verify", {
      body: { challengeId: start.body.challengeId, response, deviceLabel: label },
    });
    if (verify.status === 200) this.extraPasskeys.push(authenticator);
    return { start, verify, authenticator };
  }

  async deletePasskey(id: string): Promise<HttpResponse> {
    return this.call("auth.passkeys.delete", "DELETE", `/api/v1/auth/passkeys/${encodeURIComponent(id)}`);
  }

  // ---- household --------------------------------------------------------

  async createInvitation(body: InvitationBody): Promise<HttpResponse<InvitationCreatedBody>> {
    return this.call<InvitationCreatedBody>("household.invitations.create", "POST", "/api/v1/household/invitations", { body });
  }
}

function record(label: string, method: string, path: string, res: HttpResponse): Exchange {
  return {
    label,
    method,
    path,
    status: res.status,
    setCookies: res.setCookies,
    headers: res.headers,
    body: res.body,
  };
}
