/** The whole stack against the mock Home Assistant (bun run ha:up && bun run ha:bootstrap). Skipped when HA_TOKEN is not set. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { buildApp } from "@/app";
import { createTestDb } from "@/core/database/client";
import { createServices } from "@/services";
import { Browser } from "@/testing/http";

const url = process.env.HA_URL;
const token = process.env.HA_TOKEN;
const run = url && token ? describe : describe.skip;

run("Alice over HTTP against the mock Home Assistant", () => {
  const services = createServices(createTestDb(), { secretsKey: randomBytes(32).toString("base64") });
  const app = buildApp(services);
  const admin = new Browser(app);
  const guest = new Browser(app);
  let connectionId = "";
  const things = async (b: Browser) => (await b.call("GET", "/devices")).json.devices as any[];
  const byPrimary = (list: any[], entityId: string) => list.find((d) => d.primary?.entityId === entityId);

  beforeAll(async () => {
    await admin.register("Gokul");
    const put = await admin.call("PUT", "/ha/connection", { baseUrl: url, token });
    expect(put.status).toBe(200);
    connectionId = put.json.id;
  }, 30_000);
  afterAll(async () => {
    await services.manager.stopAll();
    await Promise.race([app.stop(true), Bun.sleep(300)]); // see note in realtime/ws.test.ts
  });

  test("real devices appear as Things with capabilities and live values", async () => {
    const list = await things(admin);
    expect(list.length).toBeGreaterThan(20);
    const lamp = byPrimary(list, "light.bed_light");
    expect(lamp.primary.capabilities.map((c: any) => c.name)).toContain("brightness");
    expect(lamp.primary.values).toHaveProperty("power");
    expect((await admin.call("GET", "/ha/connection")).json).toMatchObject({ status: "connected", entities: expect.any(Number) });
  });

  test("a brightness command goes through HTTP, Home Assistant, and back as an observed value", async () => {
    const lamp = byPrimary(await things(admin), "light.bed_light");
    const pct = lamp.primary.values.brightness === 35 ? 45 : 35;
    const res = await admin.call("POST", `/devices/${lamp.id}/commands`, { action: "set_brightness", parameters: { brightness_pct: pct } });
    expect(res.status).toBe(202);
    const done = await services.commands.done(res.json.id);
    expect(done).toMatchObject({ state: "confirmed", confirmedBy: "state" });
    expect(byPrimary(await things(admin), "light.bed_light").primary.values.brightness).toBe(pct);
  });

  test("a guest sees only the one helper they were given, and can switch it", async () => {
    const inv = await admin.call("POST", "/household/invitations", { role: "guest", guestAccessHours: 24 });
    await guest.register("Lakshmi", inv.json.code);
    expect(await things(guest)).toEqual([]);
    await admin.call("POST", "/permissions/policies", { connectionId, entityId: "input_boolean.test_switch", subjectType: "role", subjectId: "guest", effect: "allow" });
    const seen = await things(guest);
    expect(seen).toHaveLength(1);
    expect(seen[0].primary.entityId).toBe("input_boolean.test_switch");
    const before = seen[0].primary.values.power;
    const res = await guest.call("POST", `/devices/${seen[0].id}/commands`, { action: before ? "turn_off" : "turn_on" });
    expect((await services.commands.done(res.json.id)).state).toBe("confirmed");
    expect((await things(guest))[0].primary.values.power).toBe(!before);
    const lamp = byPrimary(await things(admin), "light.bed_light");
    expect((await guest.call("POST", `/devices/${lamp.id}/commands`, { action: "turn_on" })).status).toBe(404);
  });

  test("a change made in Home Assistant itself is pushed to a client over a real WebSocket", async () => {
    app.listen(0);
    const ws = new WebSocket(`ws://localhost:${app.server!.port}/ws`, { headers: { cookie: admin.cookie } } as never);
    const got: any[] = [];
    ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
    const until = async (pred: () => boolean) => { const end = Date.now() + 5000; while (!pred() && Date.now() < end) await Bun.sleep(20); expect(pred()).toBe(true); };
    await until(() => got.some((m) => m.type === "hello"));
    ws.send(JSON.stringify({ type: "subscribe", resource: "devices" }));
    ws.send(JSON.stringify({ type: "subscribe", resource: "commands" }));
    await until(() => got.filter((m) => m.type === "subscribed").length === 2);

    const helper = byPrimary(await things(admin), "input_boolean.test_switch_2");
    const was = helper.primary.values.power;
    const res = await admin.call("POST", `/devices/${helper.id}/commands`, { action: was ? "turn_off" : "turn_on" });
    await until(() => got.some((m) => m.type === "command.confirmed" && m.data.id === res.json.id));
    const update = got.find((m) => m.type === "entity.updated" && m.data.entityId === "input_boolean.test_switch_2");
    expect(update.data.values.power).toBe(!was);
    ws.close();
  });
});
