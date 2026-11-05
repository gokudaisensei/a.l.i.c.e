import { createSign } from "node:crypto";
import type { PushPayload, PushProvider, PushResult, PushSubscription } from "./provider";

export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/**
 * Firebase Cloud Messaging (HTTP v1). One channel for Android and, through Firebase's Apple bridge, iOS, which is what a
 * Capacitor app's push plugin registers with. Authenticates as a service account (an OAuth token, cached until it expires).
 */
export class FcmProvider implements PushProvider {
  readonly platform = "fcm" as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: FcmServiceAccount,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const aud = this.account.token_uri ?? "https://oauth2.googleapis.com/token";
    const iat = Math.floor(this.now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: this.account.client_email, scope: SCOPE, aud, iat, exp: iat + 3600 }))}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(this.account.private_key);
    const res = await this.fetchFn(aud, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
    });
    if (!res.ok) throw new Error(`FCM token request failed (${res.status})`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: this.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async send(sub: PushSubscription, payload: PushPayload): Promise<PushResult> {
    try {
      const res = await this.fetchFn(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
        method: "POST", headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ message: { token: sub.token, notification: { title: payload.title, body: payload.body }, data: payload.data, android: { priority: "high" }, apns: { headers: { "apns-priority": "10" } } } }),
      });
      if (res.ok) return "sent";
      const body = (await res.json().catch(() => null)) as { error?: { status?: string; details?: { errorCode?: string }[] } } | null;
      const code = body?.error?.details?.find((d) => d.errorCode)?.errorCode ?? body?.error?.status;
      if (res.status === 404 || code === "UNREGISTERED" || code === "INVALID_ARGUMENT") return "gone";
      if (res.status === 401) this.token = null; // try a fresh token next time
      return "failed";
    } catch {
      return "failed";
    }
  }
}
