import { beforeEach, describe, expect, test } from "bun:test";
import { ADMIN_TOKEN, createWorld, HA_TOKEN, homeWithHa, type World } from "../../testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
const health = async () => (await h.admin.call("GET", "/admin/health")).json;
const check = (r: any, name: string) => r.checks.find((c: any) => c.name === name);

beforeEach(async () => {
  w = createWorld();
});

describe("health", () => {
  test("says what is missing before Home Assistant is connected", async () => {
    const admin = w.browser();
    await admin.register("Gokul");
    const r = (await admin.call("GET", "/admin/health")).json;
    expect(r.status).toBe("warn");
    expect(check(r, "database")).toMatchObject({ status: "ok" });
    expect(check(r, "homeAssistant")).toMatchObject({ status: "warn", detail: "Home Assistant is not connected yet" });
    expect(check(r, "configWorker").status).toBe("ok");
    expect(r.version).toBe("0.1.0");
    expect(r.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  test("walks through connection, admin token and worker; push is a warning until it is set up", async () => {
    h = await homeWithHa(w);
    let r = await health();
    expect(check(r, "homeAssistant")).toMatchObject({ status: "ok", detail: expect.stringMatching(/Connected to Home Assistant 2026\.10\.4, \d+ entities/) });
    expect(check(r, "configWorker")).toMatchObject({ status: "warn", detail: expect.stringMatching(/No admin token/) });
    await h.withAdminToken();
    expect(check(await health(), "configWorker")).toMatchObject({ status: "warn", detail: expect.stringMatching(/not running and \d+ change/) });
    await w.sync();
    r = await health();
    expect(check(r, "configWorker")).toMatchObject({ status: "ok", detail: "Running" });
    expect(check(r, "push")).toMatchObject({ status: "warn", detail: expect.stringMatching(/not set up/) });
  });

  test("a Home Assistant that is not answering makes the whole thing 'down'; failed changes are called out", async () => {
    h = await homeWithHa(w);
    await h.withAdminToken();
    const { httpError } = await import("../../testing/fake-config-api");
    w.configApi.failWith = httpError(403);
    await h.admin.call("POST", "/scenes", { name: "S", actions: [{ entityId: "light.floor_lamp", action: "turn_off" }] });
    await w.worker.drain();
    expect(check(await health(), "configJobs")).toMatchObject({ status: "warn", detail: expect.stringMatching(/could not be applied/) });
    w.gw.setStatus("reconnecting");
    const r = await health();
    expect(r.status).toBe("down");
    expect(check(r, "homeAssistant")).toMatchObject({ status: "down", detail: "reconnecting" });
  });
});

describe("diagnostics", () => {
  test("shows what is configured and counts, and never a secret", async () => {
    h = await homeWithHa(w);
    await h.withAdminToken();
    await h.admin.call("POST", "/scenes", { name: "S", actions: [{ entityId: "light.floor_lamp", action: "turn_off" }] });
    const raw = await h.admin.call("GET", "/admin/diagnostics");
    const d = raw.json;
    expect(d.app).toMatchObject({ name: "alice-backend", version: "0.1.0", runtime: expect.stringMatching(/^bun /) });
    expect(d.homeAssistant).toMatchObject({ configured: true, version: "2026.10.4", host: "homeassistant.local:8123", status: "connected" });
    expect(d.counts).toMatchObject({ members: 1, scenes: 1, routines: 0, automations: 0 });
    expect(d.counts.devices).toBeGreaterThan(5);
    expect(d.features).toMatchObject({ pushChannels: [], trustProxy: false });
    for (const secret of [HA_TOKEN, ADMIN_TOKEN, "eyJ", "PRIVATE KEY", "BEGIN"]) expect(JSON.stringify(d)).not.toContain(secret);
    const h2 = JSON.stringify((await h.admin.call("GET", "/admin/health")).json);
    for (const secret of [HA_TOKEN, ADMIN_TOKEN, "eyJ"]) expect(h2).not.toContain(secret);
  });
});

describe("audit log", () => {
  beforeEach(async () => { h = await homeWithHa(w); });

  test("lists security-relevant actions newest first, with who did them", async () => {
    await h.withAdminToken();
    const meera = await h.join("Meera", { role: "member" });
    void meera;
    const { items } = (await h.admin.call("GET", "/admin/audit")).json;
    const actions = items.map((i: any) => i.action);
    expect(actions[0]).toBe("household.invitation_created"); // the latest thing that happened
    expect(actions).toContain("auth.first_user_registered");
    expect(actions).toContain("ha.connection_saved");
    expect(actions).toContain("ha.admin_token_set");
    expect(items.find((i: any) => i.action === "ha.admin_token_set").actor).toMatchObject({ type: "user", name: "Gokul" });
    expect(JSON.stringify(items)).not.toContain(ADMIN_TOKEN);
  });

  test("pages with a cursor without skipping or repeating, and filters by the start of the action name", async () => {
    for (let i = 0; i < 7; i++) { await h.admin.call("PUT", "/household/mode", { mode: i % 2 ? "home" : "night" }); w.clock.now += 1000; }
    const all: string[] = [];
    let cursor: string | null = null;
    do {
      const r: any = (await h.admin.call("GET", `/admin/audit?limit=4${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`)).json;
      all.push(...r.items.map((i: any) => i.id));
      cursor = r.nextCursor;
    } while (cursor);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeGreaterThanOrEqual(9); // 7 mode changes plus sign-up and Home Assistant setup
    const modes = (await h.admin.call("GET", "/admin/audit?action=household.mode")).json.items;
    expect(modes).toHaveLength(7);
    expect(modes.every((i: any) => i.action === "household.mode_changed")).toBe(true);
    expect(modes[0].detail).toEqual({ from: "home", to: "night" });
    expect((await h.admin.call("GET", "/admin/audit?action=nothing.like.this")).json).toEqual({ items: [], nextCursor: null });
    expect((await h.admin.call("GET", "/admin/audit?limit=500")).status).toBe(422);
  });

  test("only admins can see health, diagnostics or the audit log", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    for (const b of [meera, lakshmi]) for (const p of ["/admin/health", "/admin/diagnostics", "/admin/audit"]) expect((await b.call("GET", p)).status).toBe(403);
    expect((await w.browser().call("GET", "/admin/health")).status).toBe(401);
  });
});
