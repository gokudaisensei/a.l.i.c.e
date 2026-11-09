import { beforeEach, describe, expect, test } from "bun:test";
import { createWorld, homeWithHa, MIN, type World } from "../../testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
let token: string;
const hh = () => w.db.query.households.findFirst().sync()!.id;
const op = async (path: string, t: string | null = token) => {
  const res = await w.app.handle(new Request(`http://localhost/api/v1/operator${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {} }));
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
};
const grant = (hours = 1, scope: object = { health: true, devices: true }) => h.admin.call("POST", "/admin/support", { hours, scope });

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
  token = w.services.operators.create("ops-114").token;
});

describe("support staff", () => {
  test("a token is needed, and a household login is not a token", async () => {
    expect((await op("/homes", null)).status).toBe(401);
    expect((await op("/homes", "alice_op_nope")).status).toBe(401);
    expect((await op("/homes", h.admin.cookie.split("=")[1])).status).toBe(401);
    expect((await op("/homes")).status).toBe(200);
  });

  test("without a grant they see no homes and can reach nothing", async () => {
    expect((await op("/homes")).json.homes).toEqual([]);
    expect((await op(`/homes/${hh()}/health`)).json.error.code).toBe("no_grant");
    expect((await op(`/homes/${hh()}/devices`)).json.error.code).toBe("no_grant");
  });

  test("with a grant they see what was allowed, and each look is written in the household's log under their name", async () => {
    await grant(1, { health: true, devices: true });
    const homes = (await op("/homes")).json.homes;
    expect(homes).toHaveLength(1);
    expect(homes[0].grant.scope).toMatchObject({ health: true, devices: true, cameras: false, control: false });
    const health = await op(`/homes/${hh()}/health`);
    expect(health.status).toBe(200);
    expect(health.json.checks.find((c: any) => c.name === "database").status).toBe("ok");
    const devices = (await op(`/homes/${hh()}/devices`)).json.devices as any[];
    expect(devices.some((d) => d.name === "Floor lamp")).toBe(true);
    expect(devices.every((d) => d.domain !== "camera")).toBe(true);
    const trail = (await h.admin.call("GET", "/admin/support")).json;
    expect(trail.operatorTrail.map((x: any) => [x.operator, x.target])).toEqual([["ops-114", "/devices"], ["ops-114", "/admin/health"]]);
    expect(trail.householdLog[0].text).toBe("Support looked at something you allowed");
  });

  test("only what was granted: no health without that scope, and nothing after the grant ends", async () => {
    await grant(1, { devices: true });
    expect((await op(`/homes/${hh()}/health`)).json.error.code).toBe("out_of_scope");
    expect((await op(`/homes/${hh()}/devices`)).status).toBe(200);
    w.clock.now += 61 * MIN;
    expect((await op(`/homes/${hh()}/devices`)).json.error.code).toBe("no_grant");
    expect((await op("/homes")).json.homes).toEqual([]);
  });

  test("a revoked operator is locked out; there is no way to act on a device", async () => {
    await grant();
    w.services.operators.revoke("ops-114");
    expect((await op("/homes")).status).toBe(401);
    const t2 = w.services.operators.create("ops-115").token;
    const res = await w.app.handle(new Request(`http://localhost/api/v1/operator/homes/${hh()}/devices`, { method: "POST", headers: { authorization: `Bearer ${t2}` } }));
    expect(res.status).toBe(404);
  });

  test("a token stops working when it expires, and its length is bounded", async () => {
    await grant();
    const short = w.services.operators.create("ops-116", 1).token;
    expect((await op("/homes", short)).status).toBe(200);
    w.clock.now += 25 * 60 * MIN;
    expect((await op("/homes", short)).status).toBe(401);
    expect(() => w.services.operators.create("ops-117", 0)).toThrow();
    expect(() => w.services.operators.create("ops-118", 400)).toThrow();
  });

  test("operator names are checked and unique", () => {
    expect(() => w.services.operators.create("Bad Name")).toThrow();
    expect(() => w.services.operators.create("ops-114")).toThrow(/already exists/);
  });
});
