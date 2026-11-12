// NOTE cards — see cards/note.md for the reviewed steps and coverage.
import type { CardDef, ScenarioContext } from "../lib/scenario.ts";
import { Actor } from "../lib/actor.ts";
import { HttpClient } from "../lib/http.ts";
import { haFor } from "../suites/cmd-support.ts";
import { devices } from "../suites/cmd-support.ts";

function actor(ctx: ScenarioContext, name: "admin" | "member" | "guest"): Actor {
  const a = ctx.world.actors[name];
  if (!a) throw new Error(`world has no ${name}; the card needs world "ha"`);
  return a;
}

function code(body: unknown): unknown {
  return (body as { error?: { code?: unknown } } | null)?.error?.code;
}

async function kettle(ctx: ScenarioContext): Promise<{ admin: Actor; thing: any }> {
  const admin = actor(ctx, "admin");
  const list = await devices(admin);
  const thing = list.find((d) => d.primary?.entityId === "sensor.parity_kettle_power");
  if (!thing) throw new Error("the kettle power Thing is not in the seeded home");
  return { admin, thing };
}

async function setLimit(admin: Actor, thing: any, watts: number | null): Promise<void> {
  const res = await admin.call("note.limit", "PATCH", `/api/v1/devices/${thing.id}/settings`, {
    body: { entityId: "sensor.parity_kettle_power", powerLimitW: watts },
  });
  if (res.status !== 200) throw new Error(`setting the power limit failed (${res.status}): ${res.text.slice(0, 200)}`);
}

async function drive(ctx: ScenarioContext, value: number): Promise<void> {
  const ha = haFor(ctx.side);
  await ha.callService("input_number", "set_value", { entity_id: "input_number.parity_kettle_power", value });
  await ha.waitForState("sensor.parity_kettle_power", (s) => Math.abs(Number(s.state) - value) <= 5, 15_000, 150);
}

function probe(admin: Actor): HttpClient {
  return new HttpClient(admin.side.baseUrl, admin.side.backend);
}

async function waitForJson(admin: Actor, path: string, pred: (body: any) => boolean, timeoutMs = 20_000): Promise<any> {
  const start = Date.now();
  let last: any;
  while (Date.now() - start < timeoutMs) {
    const res = await probe(admin).request<any>("GET", path, { cookie: admin.http.jar.header() });
    last = res.body;
    if (pred(last)) return last;
    await Bun.sleep(500);
  }
  throw new Error(`${admin.side.backend}: ${path} did not satisfy the predicate (last=${JSON.stringify(last)?.slice(0, 300)})`);
}

export const noteCards: CardDef[] = [
  {
    id: "E2E-NOTE-01",
    area: "NOTE",
    title: "A power-limit crossing creates a notification that can be read",
    capability: "GET /notifications, read/read-all",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const { admin, thing } = await kettle(ctx);
      const member = actor(ctx, "member");
      const guest = actor(ctx, "guest");

      await setLimit(admin, thing, 1600);
      await drive(ctx, 1500);
      const list = await waitForJson(admin, "/api/v1/notifications", (b) => (b?.notifications ?? []).some((n: any) => n.kind === "power_limit"));
      const notification = list.notifications.find((n: any) => n.kind === "power_limit");
      ctx.add("a power_limit notification exists", notification !== undefined, "power_limit", list.notifications.map((n: any) => n.kind));
      ctx.add("the notification names the limit", typeof notification?.title === "string" && /1,?600/.test(notification.title), "title mentions 1600 W", notification?.title);
      ctx.add("the notification starts unread", notification?.readAt === null, null, notification?.readAt);
      ctx.add("the unread count is positive", list.unread >= 1, ">=1", list.unread);

      const memberList = await member.call("note.member.list", "GET", "/api/v1/notifications");
      ctx.expectStatus("note.member.list", memberList, 200);
      ctx.add("a member has their own copy", (((memberList.body as any)?.notifications ?? []) as any[]).some((n) => n.kind === "power_limit"), true, ((memberList.body as any)?.notifications ?? []).length);

      const guestList = await guest.call("note.guest.list", "GET", "/api/v1/notifications");
      ctx.expectStatus("note.guest.list", guestList, 403);

      const read = await admin.call("note.read", "POST", `/api/v1/notifications/${notification.id}/read`, { body: {} });
      ctx.expectStatus("note.read", read, 200);
      const after = await admin.call("note.after-read", "GET", "/api/v1/notifications");
      ctx.add("reading clears the unread flag", (((after.body as any)?.notifications ?? []) as any[]).find((n) => n.id === notification.id)?.readAt !== null, "read", (((after.body as any)?.notifications ?? []) as any[]).find((n) => n.id === notification.id)?.readAt);

      const all = await admin.call("note.read-all", "POST", "/api/v1/notifications/read-all", { body: {} });
      ctx.expectStatus("note.read-all", all, 200);
      ctx.add("read-all marks the rest", typeof (all.body as any)?.marked === "number" && (all.body as any).marked >= 0, "a number", (all.body as any)?.marked);

      await drive(ctx, 0);
      await setLimit(admin, thing, null);
    },
  },
  {
    id: "E2E-NOTE-02",
    area: "NOTE",
    title: "An alert is listed, acknowledged, and cleared",
    capability: "GET /alerts, POST /alerts/:id/ack",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const { admin, thing } = await kettle(ctx);
      const guest = actor(ctx, "guest");

      await setLimit(admin, thing, 1600);
      await drive(ctx, 1500);
      const listed = await waitForJson(admin, "/api/v1/alerts", (b) => (b?.alerts ?? []).some((a: any) => a.kind === "power_limit"));
      const alert = listed.alerts.find((a: any) => a.kind === "power_limit");
      ctx.add("a power_limit alert exists", alert !== undefined, "power_limit", listed.alerts.map((a: any) => a.kind));
      ctx.add("the alert names the Thing", typeof alert?.thingId === "string", "thingId", alert?.thingId);
      ctx.add("the alert starts unacknowledged", alert?.ackedAt === null, null, alert?.ackedAt);

      const acked = await admin.call("note.ack", "POST", `/api/v1/alerts/${alert.id}/ack`, { body: {} });
      ctx.expectStatus("note.ack", acked, 200);
      ctx.add("acknowledging stamps a time", typeof (acked.body as any)?.ackedAt === "number", "ackedAt", (acked.body as any)?.ackedAt);

      const guestAlerts = await guest.call("note.guest.alerts", "GET", "/api/v1/alerts");
      ctx.expectStatus("note.guest.alerts", guestAlerts, 403);

      await drive(ctx, 0);
      const cleared = await waitForJson(admin, "/api/v1/alerts", (b) => !(b?.alerts ?? []).some((a: any) => a.kind === "power_limit" && a.clearedAt === null));
      ctx.add("dropping below the threshold clears the active alert", !((cleared.alerts ?? []) as any[]).some((a) => a.kind === "power_limit" && a.clearedAt === null), "cleared", "still active");
      const withCleared = await admin.call("note.alerts.cleared", "GET", "/api/v1/alerts?includeCleared=true");
      ctx.expectStatus("note.alerts.cleared", withCleared, 200);
      ctx.add("the cleared alert is still in the history", (((withCleared.body as any)?.alerts ?? []) as any[]).some((a) => a.id === alert.id && a.clearedAt !== null), "clearedAt set", (((withCleared.body as any)?.alerts ?? []) as any[]).length);
      await setLimit(admin, thing, null);
    },
  },
  {
    id: "E2E-NOTE-03",
    area: "NOTE",
    title: "Push subscriptions register safely and never echo the token",
    capability: "GET/POST/DELETE /users/me/push-subscriptions",
    oracles: ["TS", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const member = actor(ctx, "member");
      const endpoint = "https://fcm.googleapis.com/fcm/send/parity-harness-device";
      const keys = {
        p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
        auth: "tBHItJI5svbpez7KI4CCXg",
      };

      const list = await admin.call("note.push.list", "GET", "/api/v1/users/me/push-subscriptions");
      ctx.expectStatus("note.push.list", list, 200);
      ctx.add("webpush is supported", (((list.body as any)?.platforms ?? []) as string[]).includes("webpush"), "webpush", (list.body as any)?.platforms);
      ctx.add("a VAPID key is published", typeof (list.body as any)?.vapidPublicKey === "string", "string", typeof (list.body as any)?.vapidPublicKey);
      ctx.add("the device list starts empty", (((list.body as any)?.devices ?? []) as any[]).length === 0, 0, ((list.body as any)?.devices ?? []).length);

      const reg = await admin.call("note.push.register", "POST", "/api/v1/users/me/push-subscriptions", {
        body: { platform: "webpush", token: endpoint, keys, label: "Harness" },
      });
      ctx.expectStatus("note.push.register", reg, 200);
      ctx.add("the token is not echoed", !reg.text.includes(endpoint) && !reg.text.includes(keys.auth), "absent", "present");
      const deviceId = (reg.body as any)?.id;

      const again = await admin.call("note.push.reregister", "POST", "/api/v1/users/me/push-subscriptions", {
        body: { platform: "webpush", token: endpoint, keys, label: "Renamed" },
      });
      ctx.expectStatus("note.push.reregister", again, 200);
      const after = await admin.call("note.push.after", "GET", "/api/v1/users/me/push-subscriptions");
      const devs = ((after.body as any)?.devices ?? []) as any[];
      ctx.add("re-registering is one device", devs.length === 1, 1, devs.length);
      ctx.add("the label is updated", devs[0]?.label === "Renamed", "Renamed", devs[0]?.label);
      ctx.add("the list never contains the token", !after.text.includes(endpoint), "absent", "present");

      const noFcm = await admin.call("note.push.fcm-unconfigured", "POST", "/api/v1/users/me/push-subscriptions", {
        body: { platform: "fcm", token: "t".repeat(64) },
      });
      ctx.expectStatus("note.push.fcm-unconfigured", noFcm, 409);
      ctx.add("an unconfigured channel says so", code(noFcm.body) === "push_not_configured", "push_not_configured", code(noFcm.body));

      for (const [label, body] of [
        ["unknown host", { platform: "webpush", token: "https://evil.example.com/push", keys }],
        ["plain http", { platform: "webpush", token: "http://fcm.googleapis.com/x", keys }],
        ["bad keys", { platform: "webpush", token: endpoint, keys: { p256dh: "!", auth: "x" } }],
      ] as const) {
        const bad = await admin.call(`note.push.${label}`, "POST", "/api/v1/users/me/push-subscriptions", { body });
        ctx.expectStatus(`note.push.${label}`, bad, [400, 422]);
        ctx.add(`the ${label} is a validation error`, code(bad.body) === "validation_error", "validation_error", code(bad.body));
      }

      const other = await member.call("note.push.other-delete", "DELETE", `/api/v1/users/me/push-subscriptions/${deviceId}`);
      ctx.expectStatus("note.push.other-delete", other, 404);
      const own = await admin.call("note.push.delete", "DELETE", `/api/v1/users/me/push-subscriptions/${deviceId}`);
      ctx.expectStatus("note.push.delete", own, 200);
      const empty = await admin.call("note.push.empty", "GET", "/api/v1/users/me/push-subscriptions");
      ctx.add("the device is removed", (((empty.body as any)?.devices ?? []) as any[]).length === 0, 0, ((empty.body as any)?.devices ?? []).length);
    },
  },
];
