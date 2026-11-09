import type { buildApp } from "../app";
import { VirtualAuthenticator } from "../modules/authentication/testing/virtual-authenticator";

export const RP = "localhost";
export const ORIGIN = "http://localhost:3000";

/** A tiny browser for tests: keeps the session cookie and owns a virtual passkey. */
export class Browser {
  cookie = "";
  device = new VirtualAuthenticator(RP, ORIGIN);

  constructor(private readonly app: ReturnType<typeof buildApp>) {}

  /** Like `call` but returns the untouched Response (for file downloads). */
  raw(method: string, path: string) {
    return this.app.handle(new Request(`http://localhost/api/v1${path}`, { method, headers: { origin: ORIGIN, ...(this.cookie ? { cookie: this.cookie } : {}) } }));
  }

  async call(method: string, path: string, body?: unknown) {
    const res = await this.app.handle(new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", origin: ORIGIN, ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const set = res.headers.get("set-cookie");
    if (set) {
      const pair = set.split(";")[0]!;
      this.cookie = pair.startsWith("alice_session=") && pair !== "alice_session=" ? pair : "";
    }
    const json = (await res.json().catch(() => null)) as any;
    return { status: res.status, json, setCookie: set, headers: res.headers };
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
