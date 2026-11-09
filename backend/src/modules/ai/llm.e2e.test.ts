import { beforeEach, describe, expect, test } from "bun:test";
import { createWorld, homeWithHa, type World } from "../../testing/world";
import { MODEL_CALLS_PER_MINUTE } from "./assistant.service";
import type { Interpreter } from "./llm";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
let calls: string[];
const ask = async (text: string) => (await h.admin.call("POST", "/ai/interpret", { text })).json.items as any[];
const lampId = async () => (await h.admin.call("GET", "/devices")).json.devices.find((d: any) => d.name === "Floor lamp").id as string;

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
  calls = [];
});
const fake = (fn: Interpreter["interpret"]) => { (w.services.assistant as any).model = { interpret: async (t: string, c: any) => { calls.push(t); return fn(t, c); } }; };

describe("Ask Alice with a model behind it", () => {
  test("the rules answer first, so the model is not asked and nothing leaves the house", async () => {
    fake(async () => []);
    expect((await ask("turn off the floor lamp"))[0].label).toBe("Turn off Floor lamp");
    expect(calls).toEqual([]);
  });
  test("when the rules find nothing the model's validated guess is offered, and it runs through the normal command path", async () => {
    const id = await lampId();
    fake(async () => [{ kind: "commands", label: "Dim the floor lamp", detail: "Floor lamp · Alice's best guess", icon: "sparkle", sensitive: false, plan: { type: "commands", commands: [{ thingId: id, action: "turn_off" }] } }]);
    const items = await ask("make the living room cosy");
    expect(calls).toEqual(["make the living room cosy"]);
    expect(items[0].label).toBe("Dim the floor lamp");
    const c = items[0].plan.commands[0];
    expect((await h.admin.call("POST", `/devices/${c.thingId}/commands`, { action: c.action })).status).toBe(202);
  });
  test("a model that fails, or a very short sentence, simply gives no answer", async () => {
    fake(async () => { throw new Error("down"); });
    expect(await ask("make the living room cosy")).toEqual([]);
    expect(await ask("hm")).toEqual([]);
    expect(calls).toEqual(["make the living room cosy"]);
  });

  test("one person can only send a few sentences a minute to the model; the rules still answer", async () => {
    fake(async () => []);
    for (let i = 0; i < MODEL_CALLS_PER_MINUTE + 3; i++) await ask(`make it cosy number ${i}`);
    expect(calls).toHaveLength(MODEL_CALLS_PER_MINUTE);
    expect((await ask("turn off the floor lamp"))[0].label).toBe("Turn off Floor lamp");
    w.clock.now += 61_000 * 1; await h.admin.login();
    await ask("make it cosy again");
    expect(calls).toHaveLength(MODEL_CALLS_PER_MINUTE + 1);
  });
});
