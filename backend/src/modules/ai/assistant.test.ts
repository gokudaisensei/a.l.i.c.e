import { describe, expect, test } from "bun:test";
import { type AssistantContext, interpret } from "./assistant";

const light = (id: string, name: string, areaId: string, dim = true) => ({ id, name, areaId, domain: "light", manufacturer: null, ops: ["turn_on", "turn_off", "toggle", ...(dim ? ["set_brightness"] : [])] });
const ctx: AssistantContext = {
  devices: [
    light("t1", "Pendant lights", "kitchen"), light("t2", "Strip", "kitchen", false), light("t3", "Floor lamp", "living"),
    { id: "t4", name: "Front door", areaId: "hall", domain: "lock", manufacturer: null, ops: ["lock", "unlock"] },
    { id: "t5", name: "Living AC", areaId: "living", domain: "climate", manufacturer: "Daikin", ops: ["turn_on", "turn_off", "set_temperature"] },
    { id: "t6", name: "Kettle", areaId: "kitchen", domain: "switch", manufacturer: null, ops: ["turn_on", "turn_off"] },
  ],
  areas: [{ id: "kitchen", name: "Kitchen" }, { id: "living", name: "Living room" }, { id: "hall", name: "Hall" }],
  scenes: [{ id: "s1", name: "Movie night", description: "Floor lamp 15%" }, { id: "s2", name: "Heading out", description: null }],
  routines: [{ id: "r1", name: "Goodnight" }],
  modes: ["home", "away", "night", "vacation"],
};
const first = (t: string) => interpret(t, ctx)[0];

describe("devices", () => {
  test("turn off the kitchen lights picks the lights in that room", () => {
    const s = first("turn off the kitchen lights")!;
    expect(s).toMatchObject({ label: "Turn off 2 lights in Kitchen", sensitive: false });
    expect(s.plan).toEqual({ type: "commands", commands: [{ thingId: "t1", action: "turn_off" }, { thingId: "t2", action: "turn_off" }] });
  });
  test("a single named device uses its name", () => {
    expect(first("turn on floor lamp")).toMatchObject({ label: "Turn on Floor lamp" });
    expect(first("switch on the kettle")!.plan).toEqual({ type: "commands", commands: [{ thingId: "t6", action: "turn_on" }] });
  });
  test("brightness and temperature", () => {
    expect(first("set pendant lights to 40%")!.plan).toEqual({ type: "commands", commands: [{ thingId: "t1", action: "set_brightness", parameters: { brightness_pct: 40 } }] });
    expect(first("set living ac to 23")!.plan).toEqual({ type: "commands", commands: [{ thingId: "t5", action: "set_temperature", parameters: { temperature: 23 } }] });
    expect((first("set living ac to 99")!.plan as any).commands[0].parameters.temperature).toBe(30);
  });
  test("lock is plain, unlock is sensitive and says so", () => {
    expect(first("lock everything")).toMatchObject({ label: "Lock Front door", sensitive: false });
    expect(first("unlock the front door")).toMatchObject({ label: "Unlock Front door", sensitive: true, detail: "Asks for your passkey first" });
  });
  test("only offers what a device can do, and nothing for an unknown word", () => {
    expect(interpret("turn off the front door", ctx).some((s) => s.kind === "commands")).toBe(false);
    expect(interpret("turn off the dishwasher", ctx).some((s) => s.kind === "commands")).toBe(false);
    expect(interpret("zzzz", ctx)).toEqual([]);
  });
});

describe("scenes, routines, modes", () => {
  test("by name, partial name, and mode wording", () => {
    expect(first("movie night")).toMatchObject({ kind: "scene", plan: { type: "scene", id: "s1" } });
    expect(first("heading out")).toMatchObject({ kind: "scene", plan: { type: "scene", id: "s2" } });
    expect(first("goodnight")).toMatchObject({ kind: "routine", plan: { type: "routine", id: "r1" } });
    expect(first("switch to night mode")).toMatchObject({ kind: "mode", plan: { type: "mode", mode: "night" } });
    expect(first("away")).toMatchObject({ kind: "mode" });
  });
  test("a device name shows the device", () => {
    expect(interpret("floor", ctx).find((s) => s.kind === "device")).toMatchObject({ plan: { type: "device", thingId: "t3" } });
  });
  test("nothing typed gives a few real suggestions", () => {
    const labels = interpret("", ctx).map((s) => s.label);
    expect(labels).toContain("Turn off 3 lights");
    expect(labels).toContain("Lock Front door");
    expect(labels).toContain("Run “Movie night”");
    expect(labels).toContain("Switch to Night mode");
  });
  test("a guest context offers no scenes, routines or modes", () => {
    const g = { ...ctx, scenes: [], routines: [], modes: [] };
    expect(interpret("night mode", g)).toEqual([]);
    expect(interpret("movie night", g)).toEqual([]);
  });
});
