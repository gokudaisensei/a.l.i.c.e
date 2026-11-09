import { beforeEach, describe, expect, test } from "bun:test";
import { households as householdsTable, routineRuns as routineRunsTable } from "../../core/database/schema";
import { createWorld, homeWithHa, type World } from "../../testing/world";

/** Waits are controlled by the test: each one parks until released. */
const pending: { ms: number; release: () => void }[] = [];
const sleep = (ms: number, wake: (fn: () => void) => void) =>
  new Promise<void>((resolve) => {
    pending.push({ ms, release: resolve });
    wake(resolve);
  });
const tick = () => new Promise((r) => setTimeout(r, 15));

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
const stateOf = (id: string) => w.gw.states.find((s) => s.entity_id === id)!.state;
const device = (entityId: string, action: string, parameters?: object) => ({ type: "device", entityId, action, ...(parameters ? { parameters } : {}) });

beforeEach(async () => {
  pending.length = 0;
  w = createWorld({ sleep });
  h = await homeWithHa(w);
});

describe("saving routines", () => {
  test("steps are checked: devices, scenes, modes and waits", async () => {
    const post = (steps: any[]) => h.admin.call("POST", "/routines", { name: "R", steps });
    expect((await post([device("light.nope", "turn_on")])).json.error.code).toBe("unknown_entity");
    expect((await post([{ type: "scene", sceneId: "scn_nope" }])).status).toBe(404);
    expect((await post([{ type: "delay", seconds: 0 }])).json.error.code).toBe("validation_error");
    expect((await post([{ type: "delay", seconds: 99999 }])).json.error.code).toBe("validation_error");
    expect((await post([{ type: "mode", mode: "party" }])).status).toBe(422);
    expect((await post([])).status).toBe(422);
    const ok = await post([device("light.floor_lamp", "turn_on"), { type: "delay", seconds: 5 }, { type: "mode", mode: "night" }]);
    expect(ok.status).toBe(200);
    expect(ok.json.steps).toHaveLength(3);
  });

  test("members can save and run routines; guests can do neither", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    expect((await meera.call("POST", "/routines", { name: "Mine", steps: [device("light.floor_lamp", "turn_on")] })).status).toBe(200);
    expect((await lakshmi.call("GET", "/routines")).status).toBe(403);
    expect((await lakshmi.call("POST", "/routines", { name: "No", steps: [device("light.floor_lamp", "turn_on")] })).status).toBe(403);
  });

  test("edit and delete", async () => {
    const r = (await h.admin.call("POST", "/routines", { name: "A", steps: [device("light.floor_lamp", "turn_on")] })).json;
    const upd = await h.admin.call("PATCH", `/routines/${r.id}`, { name: "B", onFailure: "stop", steps: [device("light.floor_lamp", "turn_off")] });
    expect(upd.json).toMatchObject({ name: "B", onFailure: "stop" });
    expect((await h.admin.call("DELETE", `/routines/${r.id}`)).status).toBe(200);
    expect((await h.admin.call("GET", `/routines/${r.id}`)).status).toBe(404);
  });
});

describe("running routines", () => {
  test("steps run in order, a wait holds the run until it is over, and progress is visible while it runs", async () => {
    const r = (await h.admin.call("POST", "/routines", {
      name: "Goodnight",
      steps: [device("light.floor_lamp", "turn_off"), { type: "delay", seconds: 30 }, device("switch.kettle_plug", "turn_on"), { type: "mode", mode: "night" }],
    })).json;
    const start = await h.admin.call("POST", `/routines/${r.id}/execute`);
    expect(start.status).toBe(202);
    expect(start.json).toMatchObject({ state: "running", routineName: "Goodnight" });
    await tick();
    const mid = (await h.admin.call("GET", `/routines/runs/${start.json.id}`)).json;
    expect(mid.state).toBe("running");
    expect(mid.steps.map((s: any) => s.state)).toEqual(["ok", "running", "pending", "pending"]);
    expect(stateOf("light.floor_lamp")).toBe("off");
    expect(stateOf("switch.kettle_plug")).toBe("off"); // not yet
    expect(pending[0]!.ms).toBe(30_000);
    pending[0]!.release();
    const done = await w.services.routines.finished(start.json.id);
    expect(done.state).toBe("completed");
    expect(done.steps.map((s) => s.state)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(stateOf("switch.kettle_plug")).toBe("on");
    expect((await h.admin.call("GET", "/household/mode")).json.mode).toBe("night");
    expect((await h.admin.call("GET", `/routines/${r.id}`)).json.lastRunAt).toBe(w.clock.now);
  });

  test("a scene can be a step", async () => {
    const scene = (await h.admin.call("POST", "/scenes", { name: "Off", actions: [{ entityId: "light.floor_lamp", action: "turn_off" }, { entityId: "switch.kettle_plug", action: "turn_off" }] })).json;
    const r = (await h.admin.call("POST", "/routines", { name: "R", steps: [{ type: "scene", sceneId: scene.id }] })).json;
    const run = await w.services.routines.finished((await h.admin.call("POST", `/routines/${r.id}/execute`)).json.id);
    expect(run.state).toBe("completed");
    expect(run.steps[0]!.commandIds).toHaveLength(2);
  });

  test("when a step fails: 'continue' carries on and ends failed; 'stop' skips the rest", async () => {
    const normal = w.gw.onCallService!;
    w.gw.onCallService = (call) => { if (call.target?.entity_id === "switch.kettle_plug") throw new Error("device offline at 10.0.0.9"); return normal(call); };
    const steps = [device("switch.kettle_plug", "turn_on"), device("light.floor_lamp", "turn_off")];
    const cont = (await h.admin.call("POST", "/routines", { name: "C", steps, onFailure: "continue" })).json;
    const stop = (await h.admin.call("POST", "/routines", { name: "S", steps, onFailure: "stop" })).json;
    const a = await w.services.routines.finished((await h.admin.call("POST", `/routines/${cont.id}/execute`)).json.id);
    expect(a.state).toBe("failed");
    expect(a.steps.map((s) => s.state)).toEqual(["failed", "ok"]);
    expect(a.steps[0]!.detail).toBe("switch.kettle_plug: Home Assistant refused the command"); // raw HA text never leaks into a run
    const b = await w.services.routines.finished((await h.admin.call("POST", `/routines/${stop.id}/execute`)).json.id);
    expect(b.state).toBe("stopped");
    expect(b.steps.map((s) => s.state)).toEqual(["failed", "skipped"]);
  });

  test("cancelling during a wait ends the run and skips what is left", async () => {
    const r = (await h.admin.call("POST", "/routines", { name: "R", steps: [device("light.floor_lamp", "turn_off"), { type: "delay", seconds: 60 }, device("switch.kettle_plug", "turn_on")] })).json;
    const run = (await h.admin.call("POST", `/routines/${r.id}/execute`)).json;
    await tick();
    expect((await h.admin.call("POST", `/routines/runs/${run.id}/cancel`)).status).toBe(200);
    const done = await w.services.routines.finished(run.id);
    expect(done.state).toBe("cancelled");
    expect(done.steps.map((s) => s.state)).toEqual(["ok", "skipped", "skipped"]);
    expect(stateOf("switch.kettle_plug")).toBe("off");
    expect((await h.admin.call("POST", `/routines/runs/${run.id}/cancel`)).status).toBe(409);
  });

  test("a passkey confirmation does not stretch over a long wait", async () => {
    const lock = (action: string) => device("lock.front_door", action);
    const r = (await h.admin.call("POST", "/routines", { name: "Doors", steps: [lock("unlock"), { type: "delay", seconds: 600 }, lock("lock"), { type: "delay", seconds: 600 }, lock("unlock")] })).json;
    const run = (await h.admin.call("POST", `/routines/${r.id}/execute`)).json;
    await tick();
    w.clock.now += 6 * 60_000; // the 10-minute wait passes
    pending[0]!.release();
    await tick();
    w.clock.now += 6 * 60_000;
    pending[1]!.release();
    const done = await w.services.routines.finished(run.id);
    expect(done.steps.map((s) => s.state)).toEqual(["ok", "ok", "ok", "ok", "failed"]);
    expect(done.steps[4]!.detail).toMatch(/passkey/);
    expect(stateOf("lock.front_door")).toBe("locked");
  });

  test("a step that changes the mode needs permission to change the mode; losing access mid-run stops it", async () => {
    const meeraB = await h.join("Meera", { role: "member" });
    const r = (await meeraB.call("POST", "/routines", { name: "R", steps: [{ type: "delay", seconds: 10 }, device("light.floor_lamp", "turn_off")] })).json;
    const run = (await meeraB.call("POST", `/routines/${r.id}/execute`)).json;
    await tick();
    const members = (await h.admin.call("GET", "/household/members")).json.members;
    await h.admin.call("DELETE", `/household/members/${members.find((m: any) => m.displayName === "Meera").id}`);
    pending[0]!.release();
    const done = await w.services.routines.finished(run.id);
    expect(done.steps[1]).toMatchObject({ state: "failed", detail: "You no longer have access" });
  });

  test("runs are visible to whoever started them and to admins only", async () => {
    const meeraB = await h.join("Meera", { role: "member" });
    const arjunB = await h.join("Arjun", { role: "member" });
    const r = (await meeraB.call("POST", "/routines", { name: "R", steps: [device("light.floor_lamp", "turn_off")] })).json;
    const run = (await meeraB.call("POST", `/routines/${r.id}/execute`)).json;
    await w.services.routines.finished(run.id);
    expect((await meeraB.call("GET", `/routines/runs/${run.id}`)).status).toBe(200);
    expect((await h.admin.call("GET", `/routines/runs/${run.id}`)).status).toBe(200);
    expect((await arjunB.call("GET", `/routines/runs/${run.id}`)).status).toBe(404);
    expect((await arjunB.call("POST", `/routines/runs/${run.id}/cancel`)).status).toBe(404);
  });
});

describe("runs survive a restart", () => {
  /** "Restarts" Alice: new services over the same database, with their own parked waits. */
  async function restart() {
    const parked: { ms: number; release: () => void }[] = [];
    const { createServices } = await import("../../services");
    const fresh = createServices(w.db, {
      now: () => w.clock.now, secretsKey: (await import("../../testing/world")).SECRETS_KEY, gatewayFactory: () => w.gw,
      sleep: (ms, wake) => new Promise<void>((resolve) => { parked.push({ ms, release: resolve }); wake(resolve); }),
    });
    fresh.ha.startAll();
    await new Promise((r) => setTimeout(r, 30));
    return { fresh, parked };
  }

  test("a run is stored, readable afterwards, and listed", async () => {
    const r = (await h.admin.call("POST", "/routines", { name: "R", steps: [device("light.floor_lamp", "turn_off")] })).json;
    const run = (await h.admin.call("POST", `/routines/${r.id}/execute`)).json;
    await w.services.routines.finished(run.id);
    const got = (await h.admin.call("GET", `/routines/runs/${run.id}`)).json;
    expect(got).toMatchObject({ state: "completed", routineName: "R" });
    expect(got.steps[0].def).toEqual({ type: "device", entityId: "light.floor_lamp", action: "turn_off" });
    expect((await h.admin.call("GET", "/routines/runs")).json.runs.map((x: any) => x.id)).toEqual([run.id]);
  });

  test("a run waiting in a delay carries on after a restart, for the time that is left", async () => {
    const r = (await h.admin.call("POST", "/routines", { name: "R", steps: [device("light.floor_lamp", "turn_off"), { type: "delay", seconds: 600 }, device("switch.kettle_plug", "turn_on")] })).json;
    const run = (await h.admin.call("POST", `/routines/${r.id}/execute`)).json;
    await tick();
    expect(stateOf("switch.kettle_plug")).toBe("off");
    w.clock.now += 200_000; // 200 s pass, then Alice restarts
    const { fresh, parked } = await restart();
    expect(fresh.routines.resumeInterrupted()).toBe(1);
    await tick();
    expect(parked[0]!.ms).toBe(400_000); // only the remaining 400 s
    parked[0]!.release();
    const done = await fresh.routines.finished(run.id);
    expect(done.state).toBe("completed");
    expect(done.steps.map((s) => s.state)).toEqual(["ok", "ok", "ok"]);
    expect(stateOf("switch.kettle_plug")).toBe("on");
  });

  test("a step that was in flight is marked failed, and the routine's failure setting decides what happens next", async () => {
    const mk = async (onFailure: "continue" | "stop") => (await h.admin.call("POST", "/routines", { name: onFailure, onFailure, steps: [device("switch.kettle_plug", "turn_on"), device("light.floor_lamp", "turn_off")] })).json;
    const insert = (routine: any, state: "running") => {
      const id = `run_${routine.name}`;
      const steps = routine.steps.map((def: any, index: number) => ({ index, type: def.type, def, state: index === 0 ? state : "pending" }));
      w.db.insert(routineRunsTable).values({ id, routineId: routine.id, routineName: routine.name, householdId: householdOf, userId: userIdOf, state: "running", startedAt: w.clock.now, steps, onFailure: routine.onFailure, nextStep: 0, stepUpUntil: 0 }).run();
      return id;
    };
    const userIdOf = (await h.admin.call("GET", "/users/me")).json.id as string;
    const householdOf = w.db.select().from(householdsTable).get()!.id;
    const cont = insert(await mk("continue"), "running");
    const stop = insert(await mk("stop"), "running");
    const { fresh } = await restart();
    expect(fresh.routines.resumeInterrupted()).toBe(2);
    const a = await fresh.routines.finished(cont);
    expect(a.steps.map((s) => s.state)).toEqual(["failed", "ok"]);
    expect(a.steps[0]!.detail).toMatch(/Interrupted by a restart/);
    const b = await fresh.routines.finished(stop);
    expect(b.state).toBe("stopped");
    expect(b.steps.map((s) => s.state)).toEqual(["failed", "skipped"]);
  });

  test("a run carries on even if the routine was edited or deleted meanwhile, and ends if its owner lost access", async () => {
    const r = (await h.admin.call("POST", "/routines", { name: "R", steps: [{ type: "delay", seconds: 60 }, device("light.floor_lamp", "turn_off")] })).json;
    const meeraB = await h.join("Meera", { role: "member" });
    const mine = (await meeraB.call("POST", "/routines", { name: "M", steps: [{ type: "delay", seconds: 60 }, device("light.floor_lamp", "turn_off")] })).json;
    const run = (await h.admin.call("POST", `/routines/${r.id}/execute`)).json;
    const hers = (await meeraB.call("POST", `/routines/${mine.id}/execute`)).json;
    await tick();
    await h.admin.call("DELETE", `/routines/${r.id}`); // the routine is gone, the run has its own copy of the steps
    const members = (await h.admin.call("GET", "/household/members")).json.members;
    await h.admin.call("DELETE", `/household/members/${members.find((m: any) => m.displayName === "Meera").id}`);
    const { fresh, parked } = await restart();
    fresh.routines.resumeInterrupted();
    await tick();
    expect((await fresh.routines.finished(hers.id)).steps.map((s) => s.detail)).toContain("You no longer have access");
    parked[0]!.release();
    expect((await fresh.routines.finished(run.id)).state).toBe("completed");
  });
});
