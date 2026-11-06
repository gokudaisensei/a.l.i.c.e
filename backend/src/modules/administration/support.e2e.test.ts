import { beforeEach, describe, expect, test } from "bun:test";
import { writeAudit } from "@/core/security/audit";
import { createWorld, homeWithHa, MIN, type World } from "@/testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
const HOUR = 60 * MIN;
const get = async () => (await h.admin.call("GET", "/admin/support")).json;
const hh = () => w.db.query.households.findFirst().sync()!.id;
const body = (hours = 1, scope: object = { health: true, devices: true }) => ({ hours, scope });

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("support access", () => {
  test("starts closed; granting opens it for a set time with the chosen scope, and is told to admins and logged in plain words", async () => {
    expect((await get()).active).toBeNull();
    const r = await h.admin.call("POST", "/admin/support", body(2, { health: true, cameras: true }));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ active: true, durationHours: 2, scope: { health: true, devices: false, cameras: true, control: false }, grantedBy: "Gokul" });
    const g = await get();
    expect(g.active.id).toBe(r.json.id);
    expect(g.householdLog[0].text).toBe("Gokul gave support access for 2 hours");
    expect((await h.admin.call("GET", "/notifications")).json.notifications.some((n: any) => n.kind === "support_access")).toBe(true);
    expect((await h.admin.call("POST", "/admin/support", body())).json.error.code).toBe("support_active");
  });

  test("it ends on its own when the time is up, and the household log says so", async () => {
    await h.admin.call("POST", "/admin/support", body(1));
    w.clock.now += 61 * MIN;
    await h.admin.login();
    const g = await get();
    expect(g.active).toBeNull();
    expect(g.history[0]).toMatchObject({ active: false, endedBy: "expiry" });
    expect(g.householdLog[0].text).toBe("Support access ended on its own");
  });

  test("it can be extended an hour at a time (24 in total) and ended early", async () => {
    const s = (await h.admin.call("POST", "/admin/support", body(23))).json;
    const e = await h.admin.call("POST", `/admin/support/${s.id}/extend`);
    expect(e.json).toMatchObject({ durationHours: 24, active: true });
    expect((await h.admin.call("POST", `/admin/support/${s.id}/extend`)).json.error.code).toBe("validation_error");
    const end = await h.admin.call("POST", `/admin/support/${s.id}/end`);
    expect(end.json).toMatchObject({ active: false, endedBy: "user" });
    expect((await get()).householdLog.map((x: any) => x.text)).toEqual(["Gokul ended support access", "Gokul added 1 hour of support access", "Gokul gave support access for 23 hours"]);
    expect((await h.admin.call("POST", `/admin/support/${s.id}/extend`)).json.error.code).toBe("support_ended");
  });

  test("it needs a scope and a sensible length, a fresh passkey, and an admin", async () => {
    expect((await h.admin.call("POST", "/admin/support", body(1, {}))).json.error.code).toBe("validation_error");
    expect((await h.admin.call("POST", "/admin/support", body(30))).status).toBe(422);
    const m = await h.join("Mia", { role: "member" });
    w.clock.now += 6 * MIN;
    expect((await h.admin.call("POST", "/admin/support", body())).json.error.code).toBe("step_up_required");
    expect((await m.call("GET", "/admin/support")).status).toBe(403);
    expect((await m.call("POST", "/admin/support", body())).status).toBe(403);
  });

  test("what support did is kept apart from what the household sees", async () => {
    expect((await get()).operatorTrail).toEqual([]);
    writeAudit(w.db, { householdId: hh(), actorType: "support", actorId: "ops-114", action: "health.read", resource: "/admin/health" }, w.clock.now);
    const g = await get();
    expect(g.operatorTrail[0]).toMatchObject({ operator: "ops-114", action: "health.read", target: "/admin/health" });
    expect(g.householdLog).toEqual([]);
  });
});
