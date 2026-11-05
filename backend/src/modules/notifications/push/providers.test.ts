import { createPublicKey, createVerify, generateKeyPairSync, createECDH, randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import webpush from "web-push";
import { FcmProvider } from "./fcm-provider";
import type { PushPayload, PushSubscription } from "./provider";
import { WebPushProvider } from "./webpush-provider";

const payload: PushPayload = { title: "Kettle plug is at 93%", body: "It is using 1,400 W", data: { notificationId: "ntf_1", kind: "power_limit" } };
const sub = (over: Partial<PushSubscription>): PushSubscription => ({ id: "psh_1", userId: "u", platform: "webpush", token: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "x", auth: "y" }, label: null, createdAt: 0, lastUsedAt: null, ...over });

describe("WebPushProvider", () => {
  const vapid = webpush.generateVAPIDKeys();
  const config = { ...vapid, subject: "mailto:admin@example.com" };

  test("sends the payload with the server's VAPID identity and reports success", async () => {
    const calls: any[] = [];
    const p = new WebPushProvider(config, async (s, body, options) => { calls.push({ s, body, options }); return {}; });
    expect(await p.send(sub({ keys: { p256dh: "kP", auth: "kA" } }), payload)).toBe("sent");
    expect(calls[0].s).toEqual({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "kP", auth: "kA" } });
    expect(JSON.parse(calls[0].body)).toEqual(payload);
    expect(calls[0].options.vapidDetails).toEqual({ subject: "mailto:admin@example.com", publicKey: vapid.publicKey, privateKey: vapid.privateKey });
    expect(p.publicKey).toBe(vapid.publicKey);
  });

  test("a browser that has unsubscribed (404, 410) is 'gone'; other errors are 'failed'", async () => {
    const failing = (statusCode?: number) => new WebPushProvider(config, async () => { throw Object.assign(new Error("x"), { statusCode }); });
    expect(await failing(410).send(sub({}), payload)).toBe("gone");
    expect(await failing(404).send(sub({}), payload)).toBe("gone");
    expect(await failing(500).send(sub({}), payload)).toBe("failed");
    expect(await failing(undefined).send(sub({}), payload)).toBe("failed");
    expect(await new WebPushProvider(config).send(sub({ keys: null }), payload)).toBe("gone"); // can never be delivered
  });

  test("with the real library the request is encrypted for the browser and signed with VAPID", () => {
    const browser = createECDH("prime256v1"); browser.generateKeys();
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: browser.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
    const details = webpush.generateRequestDetails(subscription, JSON.stringify(payload), { vapidDetails: { ...config }, TTL: 60 });
    expect(details.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(details.headers.Authorization).toMatch(/^vapid t=/);
    expect(Buffer.isBuffer(details.body) && !details.body.toString("utf8").includes("Kettle")).toBe(true); // the content is not readable in transit
  });
});

describe("FcmProvider", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const account = { project_id: "alice-home", client_email: "alice@alice-home.iam.gserviceaccount.com", private_key: privateKey };
  const device = sub({ platform: "fcm", token: "d".repeat(60), keys: null });

  function fakeGoogle(opts: { sendStatus?: number; sendBody?: unknown; expiresIn?: number } = {}) {
    const log: { url: string; init: RequestInit }[] = [];
    let tokens = 0;
    const fn = (async (url: string, init: RequestInit) => {
      log.push({ url, init });
      if (url.includes("oauth2")) { tokens++; return new Response(JSON.stringify({ access_token: `tok${tokens}`, expires_in: opts.expiresIn ?? 3600 })); }
      return new Response(JSON.stringify(opts.sendBody ?? {}), { status: opts.sendStatus ?? 200 });
    }) as unknown as typeof fetch;
    return { fn, log, tokens: () => tokens };
  }

  test("authenticates as the service account with a signed JWT, then sends the message", async () => {
    const g = fakeGoogle();
    const p = new FcmProvider(account, g.fn, () => 1_700_000_000_000);
    expect(await p.send(device, payload)).toBe("sent");
    const assertion = new URLSearchParams(String(g.log[0]!.init.body)).get("assertion")!;
    const [h, c, sig] = assertion.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toMatchObject({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: 1_700_000_000, exp: 1_700_003_600 });
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(createPublicKey(publicKey), Buffer.from(sig, "base64url"))).toBe(true);
    const send = g.log[1]!;
    expect(send.url).toBe("https://fcm.googleapis.com/v1/projects/alice-home/messages:send");
    expect((send.init.headers as Record<string, string>).authorization).toBe("Bearer tok1");
    expect(JSON.parse(String(send.init.body)).message).toMatchObject({ token: device.token, notification: { title: payload.title, body: payload.body }, data: payload.data });
  });

  test("the access token is reused until shortly before it expires", async () => {
    let now = 1_700_000_000_000;
    const g = fakeGoogle({ expiresIn: 3600 });
    const p = new FcmProvider(account, g.fn, () => now);
    await p.send(device, payload); await p.send(device, payload);
    expect(g.tokens()).toBe(1);
    now += 3_600_000 - 30_000; // inside the one-minute safety margin
    await p.send(device, payload);
    expect(g.tokens()).toBe(2);
  });

  test("a token Firebase no longer knows is 'gone'; a rejected login retries with a new token; trouble is 'failed'", async () => {
    expect(await new FcmProvider(account, fakeGoogle({ sendStatus: 404, sendBody: { error: { status: "NOT_FOUND" } } }).fn).send(device, payload)).toBe("gone");
    expect(await new FcmProvider(account, fakeGoogle({ sendStatus: 400, sendBody: { error: { status: "INVALID_ARGUMENT" } } }).fn).send(device, payload)).toBe("gone");
    expect(await new FcmProvider(account, fakeGoogle({ sendStatus: 400, sendBody: { error: { status: "FAILED_PRECONDITION", details: [{ errorCode: "UNREGISTERED" }] } } }).fn).send(device, payload)).toBe("gone");
    const g = fakeGoogle({ sendStatus: 401 });
    const p = new FcmProvider(account, g.fn);
    expect(await p.send(device, payload)).toBe("failed");
    await p.send(device, payload);
    expect(g.tokens()).toBe(2); // the rejected token was dropped
    expect(await new FcmProvider(account, fakeGoogle({ sendStatus: 503 }).fn).send(device, payload)).toBe("failed");
    expect(await new FcmProvider(account, (async () => { throw new Error("offline"); }) as unknown as typeof fetch).send(device, payload)).toBe("failed");
  });
});
