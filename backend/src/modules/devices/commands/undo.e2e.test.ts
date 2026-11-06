import { beforeEach, describe, expect, test } from "bun:test";
import { createWorld, homeWithHa, MIN, type World } from "@/testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
const id = async (name: string) => (await h.admin.call("GET", "/devices")).json.devices.find((d: any) => d.name === name).id as string;
const run = async (name: string, action: string, parameters?: object, b = h.admin) => {
  const r = await b.call("POST", `/devices/${await id(name)}/commands`, { action, parameters });
  expect(r.status).toBe(202);
  await w.services.commands.done(r.json.id);
  return (await b.call("GET", `/commands/${r.json.id}`)).json;
};
const lampOn = () => w.gw.states.find((s) => s.entity_id === "light.floor_lamp")!.state;

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("undo", () => {
  test("turning a lamp off can be put back, once", async () => {
    expect(lampOn()).toBe("on");
    const c = await run("Floor lamp", "turn_off");
    expect(c).toMatchObject({ state: "confirmed", undoable: true, undoneBy: null });
    const back = await h.admin.call("POST", `/commands/${c.id}/undo`);
    expect(back.status).toBe(202);
    expect(back.json).toMatchObject({ action: "turn_on", undoOf: c.id, undoable: false });
    await w.services.commands.done(back.json.id);
    expect(lampOn()).toBe("on");
    const again = (await h.admin.call("GET", `/commands/${c.id}`)).json;
    expect(again).toMatchObject({ undoable: false, undoneBy: back.json.id });
    expect((await h.admin.call("POST", `/commands/${c.id}/undo`)).json.error.code).toBe("already_undone");
    expect((await h.admin.call("POST", `/commands/${back.json.id}/undo`)).json.error.code).toBe("not_undoable");
  });

  test("a brightness change goes back to the earlier brightness; with no known earlier value it says so", async () => {
    const first = await run("Floor lamp", "set_brightness", { brightness_pct: 50 });
    expect((await h.admin.call("POST", `/commands/${first.id}/undo`)).json.error.code).toBe("not_undoable"); // brightness was not reported before
    const c = await run("Floor lamp", "set_brightness", { brightness_pct: 20 });
    const back = (await h.admin.call("POST", `/commands/${c.id}/undo`)).json;
    expect(back).toMatchObject({ action: "set_brightness", parameters: { brightness_pct: 50 } });
  });

  test("a lock goes back to unlocked, and the passkey rules still apply to that", async () => {
    const c = await run("Front door", "unlock");
    expect(c.undoable).toBe(true);
    const back = await h.admin.call("POST", `/commands/${c.id}/undo`);
    expect(back.json.action).toBe("lock");
    const done = await w.services.commands.done(back.json.id);
    expect(done.state).toBe("confirmed");
    // unlocking again needs a fresh passkey: after the step-up window the undo of a lock is refused
    await run("Front door", "unlock");
    const c2 = await run("Front door", "lock");
    expect(c2.undoable).toBe(true);
    w.clock.now += 6 * MIN;
    const refused = await h.admin.call("POST", `/commands/${c2.id}/undo`);
    expect(refused.status).toBe(202);
    expect((await w.services.commands.done(refused.json.id)).failure?.code).toBe("step_up_required");
  });

  test("nothing to undo when nothing changed, after ten minutes, or for someone else's command", async () => {
    const same = await run("Floor lamp", "turn_on"); // already on
    expect(same).toMatchObject({ confirmedBy: "already", undoable: false });
    expect((await h.admin.call("POST", `/commands/${same.id}/undo`)).json.error.code).toBe("not_undoable");
    const c = await run("Floor lamp", "turn_off");
    const member = await h.join("Mia", { role: "member" });
    expect((await member.call("POST", `/commands/${c.id}/undo`)).status).toBe(404);
    w.clock.now += 11 * MIN;
    await h.admin.login();
    expect((await h.admin.call("POST", `/commands/${c.id}/undo`)).json.error.code).toBe("undo_expired");
    expect((await h.admin.call("GET", `/commands/${c.id}`)).json.undoable).toBe(false);
  });
});

describe("idempotency keys", () => {
  const send = (key: string | null, body: object = { action: "turn_off" }, b = h.admin) => (async () => {
    const res = await w.app.handle(new Request(`http://localhost/api/v1/devices/${await id("Floor lamp")}/commands`, {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: b.cookie, ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(body),
    }));
    return { status: res.status, replay: res.headers.get("idempotent-replay"), json: (await res.json()) as any };
  })();

  test("the same key and request runs once and returns the same command", async () => {
    const a = await send("tap-0001-abcdef");
    const b = await send("tap-0001-abcdef");
    expect(a.status).toBe(202); expect(b.status).toBe(202);
    expect(b.json.id).toBe(a.json.id);
    expect(a.replay).toBeNull(); expect(b.replay).toBe("true");
    await w.services.commands.done(a.json.id);
    expect(w.gw.calls.filter((x) => x.service === "turn_off")).toHaveLength(1);
  });

  test("without a key every request is its own command, as before", async () => {
    const a = await send(null), b = await send(null);
    expect(b.json.id).not.toBe(a.json.id);
  });

  test("the same key for a different request is refused, and a bad key is refused", async () => {
    await send("tap-0002-abcdef");
    const r = await send("tap-0002-abcdef", { action: "turn_on" });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("idempotency_key_reuse");
    expect((await send("short")).status).toBe(400);
  });

  test("keys belong to the person: someone else with the same key gets their own command", async () => {
    const member = await h.join("Mia", { role: "member" });
    const a = await send("shared-key-12345");
    const b = await send("shared-key-12345", { action: "turn_off" }, member);
    expect(b.json.id).not.toBe(a.json.id);
  });

  test("a key older than a day is forgotten", async () => {
    const a = await send("old-key-1234567");
    w.clock.now += 25 * 60 * MIN;
    await h.admin.login();
    const other = await send("another-key-1234"); // sweeps old keys
    const again = await send("old-key-1234567");
    expect(again.replay).toBeNull();
    expect(again.json.id).not.toBe(a.json.id);
    expect(other.status).toBe(202);
  });
});
