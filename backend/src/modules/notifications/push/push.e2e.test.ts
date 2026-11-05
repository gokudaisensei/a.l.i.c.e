import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import { buildApp } from "@/app";
import { createTestDb } from "@/core/database/client";
import { households, notifications, pushSubscriptions } from "@/core/database/schema";
import type { Browser } from "@/testing/http";
import { homeWithHa, MIN, SECRETS_KEY, createWorld, type World } from "@/testing/world";
import { createServices } from "@/services";
import type { PushPayload, PushProvider, PushResult, PushSubscription } from "./provider";

/** Records what it was asked to send; the result can be set per test. */
class FakeProvider implements PushProvider {
  sent: { sub: PushSubscription; payload: PushPayload }[] = [];
  result: PushResult | ((s: PushSubscription) => PushResult) = "sent";
  constructor(readonly platform: "webpush" | "fcm", readonly publicKey?: string) {}
  async send(sub: PushSubscription, payload: PushPayload) { this.sent.push({ sub, payload }); return typeof this.result === "function" ? this.result(sub) : this.result; }
}

let w: World;
let web: FakeProvider;
let fcm: FakeProvider;
let h: Awaited<ReturnType<typeof homeWithHa>>;

const endpoint = (n = 1) => `https://fcm.googleapis.com/fcm/send/device${n}`;
const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
const hh = () => w.db.select().from(households).get()!.id;
const idOf = async (b: Browser) => (await b.call("GET", "/users/me")).json.id as string;
const settle = () => new Promise((r) => setTimeout(r, 20));
const statusOf = (id: string) => w.db.select().from(notifications).where(eq(notifications.id, id)).get()!.pushStatus;
async function notify(userId: string, extra: object = {}) {
  const n = w.services.notifications.notify(hh(), userId, { kind: "test", title: "Hello", body: "World", ...extra });
  await settle();
  return n;
}

beforeEach(async () => {
  web = new FakeProvider("webpush", "BPublicVapidKey");
  fcm = new FakeProvider("fcm");
  const base = createWorld();
  // A world whose push channels are fakes (the default world has none configured).
  w = { ...base, services: createServices(base.db, { bus: base.services.bus, now: () => base.clock.now, secretsKey: SECRETS_KEY, gatewayFactory: () => base.gw, pushProviders: [web, fcm], auth: { rpId: "localhost", rpName: "Alice", origin: "http://localhost:3000", sessionTtlHours: 24 } }) } as World;
  w.app = buildApp(w.services);
  w.browser = () => new (base.browser().constructor as new (a: typeof w.app) => Browser)(w.app);
  void createTestDb;
  h = await homeWithHa(w);
});

describe("registering devices", () => {
  test("a browser and an app can be registered; the server says what it supports", async () => {
    const list = (await h.admin.call("GET", "/users/me/push-subscriptions")).json;
    expect(list).toMatchObject({ platforms: ["webpush", "fcm"], vapidPublicKey: "BPublicVapidKey", devices: [] });
    expect((await h.admin.call("POST", "/users/me/push-subscriptions", { platform: "webpush", token: endpoint(), keys, label: "Firefox" })).status).toBe(200);
    expect((await h.admin.call("POST", "/users/me/push-subscriptions", { platform: "fcm", token: "t".repeat(64), label: "Pixel" })).status).toBe(200);
    expect((await h.admin.call("GET", "/users/me/push-subscriptions")).json.devices.map((d: any) => [d.platform, d.label])).toEqual([["webpush", "Firefox"], ["fcm", "Pixel"]]);
    expect(JSON.stringify((await h.admin.call("GET", "/users/me/push-subscriptions")).json)).not.toContain("t".repeat(64)); // tokens are never echoed back
  });

  test("only real push services are accepted for Web Push, and keys must be present", async () => {
    const post = (body: object) => h.admin.call("POST", "/users/me/push-subscriptions", { platform: "webpush", keys, ...body });
    expect((await post({ token: "http://fcm.googleapis.com/fcm/send/x" })).json.error.code).toBe("validation_error");
    expect((await post({ token: "https://localhost/push" })).json.error.code).toBe("validation_error");
    expect((await post({ token: "https://192.168.1.5/push" })).json.error.code).toBe("validation_error");
    expect((await post({ token: "https://169.254.169.254/latest" })).json.error.code).toBe("validation_error");
    expect((await post({ token: "https://evil.example.com/push" })).json.error.code).toBe("validation_error");
    expect((await post({ token: "https://user:pw@fcm.googleapis.com/x" })).json.error.code).toBe("validation_error");
    expect((await post({ token: "not a url" })).json.error.code).toBe("validation_error");
    expect((await post({ token: "https://updates.push.services.mozilla.com/wpush/v2/abc" })).status).toBe(200);
    expect((await post({ token: "https://wns2-par02p.notify.windows.com/w/?token=abc" })).status).toBe(200);
    expect((await post({ token: "https://web.push.apple.com/abc" })).status).toBe(200);
    expect((await post({ token: endpoint(), keys: { p256dh: "!", auth: "x" } })).json.error.code).toBe("validation_error");
    expect((await h.admin.call("POST", "/users/me/push-subscriptions", { platform: "fcm", token: "short" })).json.error.code).toBe("validation_error");
  });

  test("registering twice is harmless; a person is limited to 10 devices; each removes only their own", async () => {
    const a = await h.admin.call("POST", "/users/me/push-subscriptions", { platform: "webpush", token: endpoint(), keys });
    await h.admin.call("POST", "/users/me/push-subscriptions", { platform: "webpush", token: endpoint(), keys, label: "Renamed" });
    expect((await h.admin.call("GET", "/users/me/push-subscriptions")).json.devices).toHaveLength(1);
    for (let i = 2; i <= 10; i++) await h.admin.call("POST", "/users/me/push-subscriptions", { platform: "webpush", token: endpoint(i), keys });
    expect((await h.admin.call("POST", "/users/me/push-subscriptions", { platform: "webpush", token: endpoint(11), keys })).json.error.code).toBe("too_many_devices");
    const meera = await h.join("Meera", { role: "member" });
    expect((await meera.call("DELETE", `/users/me/push-subscriptions/${a.json.id}`)).status).toBe(404);
    expect((await h.admin.call("DELETE", `/users/me/push-subscriptions/${a.json.id}`)).status).toBe(200);
    expect((await h.admin.call("GET", "/users/me/push-subscriptions")).json.devices).toHaveLength(9);
  });

  test("a channel the server is not set up for is refused with a clear reason", async () => {
    const bare = createServices(w.db, { bus: w.services.bus, secretsKey: SECRETS_KEY, gatewayFactory: () => w.gw, pushProviders: [fcm] });
    expect(() => bare.push.register("u", { platform: "webpush", token: endpoint(), keys })).toThrow(/not set up/);
    expect(bare.push.vapidPublicKey()).toBeNull();
  });
});

describe("delivering notifications to phones", () => {
  async function devices(b: Browser, n = 1) {
    await b.call("POST", "/users/me/push-subscriptions", { platform: "webpush", token: endpoint(n), keys });
    await b.call("POST", "/users/me/push-subscriptions", { platform: "fcm", token: `${n}`.repeat(30) });
  }

  test("every device of the person gets it, with the text and enough to open the right screen", async () => {
    await devices(h.admin);
    const n = await notify(await idOf(h.admin), { kind: "power_limit" });
    expect(web.sent).toHaveLength(1);
    expect(fcm.sent).toHaveLength(1);
    expect(web.sent[0]!.payload).toEqual({ title: "Hello", body: "World", data: { notificationId: n.id, kind: "power_limit" } });
    expect(statusOf(n.id)).toBe("sent");
  });

  test("people only get their own, and a person with no devices is simply not pushed to", async () => {
    const meera = await h.join("Meera", { role: "member" });
    await devices(h.admin);
    const mine = await notify(await idOf(meera));
    expect(web.sent).toHaveLength(0);
    expect(statusOf(mine.id)).toBe("none");
  });

  test("real notifications travel the whole way: an alert pushes to the household's members, not guests", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    await devices(h.admin, 1); await devices(meera, 2); await devices(lakshmi, 3);
    w.services.notifications.notifyHousehold(hh(), { kind: "power_limit", title: "Kettle is at 93%", body: "1,400 W" });
    await settle();
    expect(web.sent.map((s) => s.sub.token).sort()).toEqual([endpoint(1), endpoint(2)]); // the guest has no notifications at all
  });

  test("a person who turned push off, or is in quiet hours, gets nothing pushed (it is still in the app); urgent things still get through", async () => {
    await devices(h.admin);
    const me = await idOf(h.admin);
    await h.admin.call("PATCH", "/users/me/preferences", { pushEnabled: false });
    expect(statusOf((await notify(me)).id)).toBe("suppressed");
    expect(statusOf((await notify(me, { urgent: true })).id)).toBe("suppressed"); // an explicit "no push" is respected even for urgent
    await h.admin.call("PATCH", "/users/me/preferences", { pushEnabled: true, quietHours: { enabled: true, from: "22:00", to: "07:00" } });
    w.clock.now = Date.parse("2026-11-05T23:30:00Z"); // 11:30 pm in the household's UTC time zone
    expect(statusOf((await notify(me)).id)).toBe("suppressed");
    expect(statusOf((await notify(me, { urgent: true })).id)).toBe("sent");
    w.clock.now = Date.parse("2026-11-05T12:00:00Z");
    expect(statusOf((await notify(me)).id)).toBe("sent");
    expect(w.db.select().from(notifications).all()).toHaveLength(5); // all of them are stored (and shown in the app) regardless
  });

  test("quiet hours follow the household's time zone, and a daytime window works too", async () => {
    await devices(h.admin);
    const me = await idOf(h.admin);
    await h.admin.call("PATCH", "/household", { timezone: "Asia/Kolkata" });
    await h.admin.call("PATCH", "/users/me/preferences", { quietHours: { enabled: true, from: "22:00", to: "07:00" } });
    w.clock.now = Date.parse("2026-11-05T17:00:00Z"); // 10:30 pm in Kolkata, but 5 pm UTC
    expect(statusOf((await notify(me)).id)).toBe("suppressed");
    w.clock.now = Date.parse("2026-11-05T05:00:00Z"); // 10:30 am in Kolkata
    await h.admin.login(); // sessions last a day, and the clock just jumped
    expect(statusOf((await notify(me)).id)).toBe("sent");
    await h.admin.call("PATCH", "/users/me/preferences", { quietHours: { enabled: true, from: "13:00", to: "15:00" } }); // a siesta
    w.clock.now = Date.parse("2026-11-05T08:30:00Z"); // 2 pm in Kolkata
    expect(statusOf((await notify(me)).id)).toBe("suppressed");
    await h.admin.call("PATCH", "/users/me/preferences", { quietHours: { enabled: false } });
    expect(statusOf((await notify(me)).id)).toBe("sent");
  });

  test("a device that has been dropped is forgotten; a delivery that failed is kept and recorded", async () => {
    await devices(h.admin);
    const me = await idOf(h.admin);
    web.result = "gone"; fcm.result = "failed";
    const n = await notify(me);
    expect(statusOf(n.id)).toBe("failed");
    expect(w.services.push.list(me).map((s) => s.platform)).toEqual(["fcm"]); // the browser that unsubscribed is gone
    fcm.result = "gone";
    await notify(me);
    expect(w.services.push.list(me)).toEqual([]);
  });

  test("a runaway sender cannot flood a phone: after 30 in ten minutes they are held back, and it resets", async () => {
    await devices(h.admin);
    const me = await idOf(h.admin);
    for (let i = 0; i < 30; i++) await notify(me);
    expect(web.sent).toHaveLength(30);
    expect(statusOf((await notify(me)).id)).toBe("suppressed");
    w.clock.now += 11 * MIN;
    expect(statusOf((await notify(me)).id)).toBe("sent");
  });

  test("a push that blows up never breaks creating the notification", async () => {
    await devices(h.admin);
    web.send = async () => { throw new Error("boom"); };
    const n = await notify(await idOf(h.admin));
    expect(statusOf(n.id)).toBe("failed");
    expect((await h.admin.call("GET", "/notifications")).json.notifications[0].id).toBe(n.id);
  });

  test("a test push goes to one's own devices and reports what happened", async () => {
    await devices(h.admin);
    fcm.result = "gone";
    expect((await h.admin.call("POST", "/users/me/push-subscriptions/test")).json).toEqual({ sent: 1, removed: 1, failed: 0 });
    expect(web.sent.at(-1)!.payload.data.kind).toBe("test");
    expect(w.db.select().from(pushSubscriptions).all()).toHaveLength(1);
  });
});
