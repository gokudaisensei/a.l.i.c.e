import { beforeEach, describe, expect, test } from "bun:test";
import { FakeSocket } from "@/testing/fake-socket";
import type { Browser } from "@/testing/http";
import { changeState, createWorld, homeWithHa, type World } from "@/testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
let n = 0;

const power = (watts: number | string, unit = "W") => changeState(w.gw, "sensor.kettle_plug_power", String(watts), { friendly_name: "Kettle plug Power", device_class: "power", unit_of_measurement: unit });
const kettle = async () => (await h.admin.call("GET", "/devices")).json.devices.find((d: any) => d.name === "Kettle plug").id as string;
const setLimit = async (limit: number | null) => h.admin.call("PATCH", `/devices/${await kettle()}/settings`, { powerLimitW: limit });
const alerts = async (b: Browser, qs = "") => (await b.call("GET", `/alerts${qs}`)).json.alerts as any[];

function attach(b: Browser, ...resources: string[]) {
  const session = w.services.auth.getSession(b.cookie.split("=")[1]!)!;
  const s = new FakeSocket(`s${++n}`);
  w.services.realtime.connect(s, session, w.services.households.getMembership(session.userId)!);
  for (const r of resources) w.services.realtime.receive(s.id, JSON.stringify({ type: "subscribe", resource: r }));
  return s;
}

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("power limit alerts", () => {
  test("nothing happens without a limit; at 90% of it an alert is raised with the numbers", async () => {
    power(5000);
    expect(await alerts(h.admin)).toEqual([]); // no limit, nothing to compare with
    power(100);
    await setLimit(1500);
    power(1300);
    expect(await alerts(h.admin)).toEqual([]);
    power(1350);
    const [a] = await alerts(h.admin);
    expect(a).toMatchObject({ kind: "power_limit", title: "Kettle plug is at 90% of its 1,500 W limit", thingName: "Kettle plug", data: { watts: 1350, limitW: 1500, percent: 90 }, clearedAt: null, ackedAt: null });
    expect(a.detail).toMatch(/using 1,350 W/);
  });

  test("it does not flap: staying above 85% keeps the one alert, dropping below clears it, a new peak raises a new one", async () => {
    await setLimit(1500);
    power(1400);
    power(1420); // still the same alert
    power(1290); // 86%: still above the clear line
    expect(await alerts(h.admin)).toHaveLength(1);
    expect((await alerts(h.admin))[0].data.watts).toBe(1290);
    power(1200); // 80%
    expect(await alerts(h.admin)).toEqual([]);
    expect(await alerts(h.admin, "?includeCleared=true")).toHaveLength(1);
    power(1450);
    expect(await alerts(h.admin)).toHaveLength(1);
    expect(await alerts(h.admin, "?includeCleared=true")).toHaveLength(2);
  });

  test("kilowatts are converted, and unreadable values change nothing", async () => {
    await setLimit(2000);
    power(1.9, "kW");
    expect((await alerts(h.admin))[0].data).toMatchObject({ watts: 1900, percent: 95 });
    power("unavailable");
    power("unknown");
    expect(await alerts(h.admin)).toHaveLength(1);
  });

  test("changing the limit applies straight away, using the latest reading; removing it clears the alert", async () => {
    await setLimit(2000);
    power(1400);
    expect(await alerts(h.admin)).toEqual([]);
    await setLimit(1500);
    expect(await alerts(h.admin)).toHaveLength(1);
    await setLimit(3000);
    expect(await alerts(h.admin)).toEqual([]);
    await setLimit(1500);
    await setLimit(null);
    expect(await alerts(h.admin)).toEqual([]);
    power(9999);
    expect(await alerts(h.admin)).toEqual([]);
  });

  test("members and admins are notified, guests are not; notifications can be read", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    await setLimit(1500);
    power(1400);
    for (const b of [h.admin, meera]) {
      const r = (await b.call("GET", "/notifications")).json;
      expect(r.unread).toBe(1);
      expect(r.notifications[0]).toMatchObject({ kind: "power_limit", title: "Kettle plug is at 93% of its 1,500 W limit", readAt: null });
    }
    expect((await lakshmi.call("GET", "/notifications")).status).toBe(403);
    expect((await lakshmi.call("GET", "/alerts")).status).toBe(403);
    const id = (await meera.call("GET", "/notifications")).json.notifications[0].id;
    expect((await meera.call("POST", `/notifications/${id}/read`)).status).toBe(200);
    expect((await meera.call("GET", "/notifications")).json.unread).toBe(0);
    expect((await h.admin.call("GET", "/notifications?unread=true")).json.notifications).toHaveLength(1); // hers only
    expect((await h.admin.call("POST", `/notifications/${id}/read`)).status).toBe(404); // not his
    expect((await h.admin.call("POST", "/notifications/read-all")).json.marked).toBe(1);
  });

  test("a person with a deny policy on the device does not see its alert", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const meeraId = (await meera.call("GET", "/users/me")).json.id;
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "switch.kettle_plug", subjectType: "member", subjectId: meeraId, effect: "deny" });
    await setLimit(1500);
    power(1400);
    expect(await alerts(h.admin)).toHaveLength(1);
    expect(await alerts(meera)).toEqual([]);
    const id = (await alerts(h.admin))[0].id;
    expect((await meera.call("POST", `/alerts/${id}/ack`)).status).toBe(404);
  });

  test("acknowledging marks it seen but it stays until usage drops", async () => {
    await setLimit(1500);
    power(1400);
    const id = (await alerts(h.admin))[0].id;
    const ack = await h.admin.call("POST", `/alerts/${id}/ack`);
    expect(ack.json.ackedAt).toBe(w.clock.now);
    expect(await alerts(h.admin)).toHaveLength(1);
    expect((await h.admin.call("POST", "/alerts/alr_nope/ack")).status).toBe(404);
  });

  test("alerts and notifications are pushed over the socket, only to those who may see them", async () => {
    const meeraB = await h.join("Meera", { role: "member" });
    const meeraId = (await meeraB.call("GET", "/users/me")).json.id;
    const admin = attach(h.admin, "alerts", "notifications");
    const meera = attach(meeraB, "alerts", "notifications");
    await h.admin.call("POST", "/permissions/policies", { connectionId: h.connectionId, entityId: "switch.kettle_plug", subjectType: "member", subjectId: meeraId, effect: "deny" });
    await setLimit(1500);
    power(1400);
    expect(admin.of("alert.created")[0]).toMatchObject({ data: { title: expect.stringMatching(/Kettle plug is at 93%/), thingName: "Kettle plug" } });
    expect(admin.of("notification.created")).toHaveLength(1);
    expect(meera.of("alert.created")).toHaveLength(0); // the device is hidden from her
    expect(meera.of("notification.created")).toHaveLength(1); // the notification text is hers to get (it was addressed to her)
    power(1000);
    expect(admin.of("alert.cleared")).toHaveLength(1);
    expect(meera.of("alert.cleared")).toHaveLength(0);
  });
});

describe("notifications from automations (alice_notification events)", () => {
  const fire = (data: Record<string, unknown>) => w.gw.emitEvent("alice_notification", data);
  const inbox = async (b: Browser) => (await b.call("GET", "/notifications")).json.notifications as any[];

  test("an event notifies everyone who can receive notifications, or only the people named", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    const meeraId = (await meera.call("GET", "/users/me")).json.id;
    fire({ title: "Heater", message: "Water heater is hot" });
    expect((await inbox(h.admin)).map((x) => x.body)).toEqual(["Water heater is hot"]);
    expect((await inbox(meera)).map((x) => x.body)).toEqual(["Water heater is hot"]);
    expect((await lakshmi.call("GET", "/notifications")).status).toBe(403);
    fire({ message: "Just Meera", userIds: [meeraId] });
    expect(await inbox(h.admin)).toHaveLength(1);
    expect((await inbox(meera)).map((x) => x.body)).toEqual(["Just Meera", "Water heater is hot"]);
    expect((await inbox(meera))[0]).toMatchObject({ kind: "automation", title: "Home" });
  });

  test("bad or hostile payloads are bounded or ignored; strangers cannot be notified", async () => {
    fire({ title: "No message" });
    fire({ message: "" });
    fire({ message: "x".repeat(5000), title: "t".repeat(500) });
    fire({ message: "For nobody", userIds: ["usr_someone_elses"] });
    const got = await inbox(h.admin);
    expect(got).toHaveLength(1);
    expect(got[0].body).toHaveLength(500);
    expect(got[0].title).toHaveLength(100);
  });
});
