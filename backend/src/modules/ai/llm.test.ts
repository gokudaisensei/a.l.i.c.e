import { describe, expect, test } from "bun:test";
import type { AssistantContext } from "./assistant";
import { AnthropicInterpreter, validateProposals } from "./llm";

const ctx: AssistantContext = {
  devices: [
    { id: "t1", name: "Pendant lights", areaId: "kitchen", domain: "light", manufacturer: null, ops: ["turn_on", "turn_off", "set_brightness"] },
    { id: "t2", name: "Front door", areaId: "hall", domain: "lock", manufacturer: null, ops: ["lock", "unlock"] },
    { id: "t3", name: "Living AC", areaId: "living", domain: "climate", manufacturer: null, ops: ["turn_on", "turn_off", "set_temperature"] },
  ],
  areas: [{ id: "kitchen", name: "Kitchen" }, { id: "hall", name: "Hall" }, { id: "living", name: "Living room" }],
  scenes: [{ id: "s1", name: "Movie night", description: null }], routines: [{ id: "r1", name: "Goodnight" }], modes: ["home", "away", "night", "vacation"],
};

describe("what the model may propose", () => {
  test("real ids and supported actions pass; values are clamped; unlock is always sensitive", () => {
    const out = validateProposals({ proposals: [
      { type: "devices", label: "Dim the kitchen", commands: [{ thingId: "t1", action: "set_brightness", parameters: { brightness_pct: 400 } }] },
      { type: "devices", label: "Cooler", commands: [{ thingId: "t3", action: "set_temperature", parameters: { temperature: 5 } }] },
      { type: "devices", label: "Let me in", commands: [{ thingId: "t2", action: "unlock" }] },
      { type: "scene", label: "Movie", id: "s1" }, { type: "mode", label: "Night", mode: "night" },
    ] }, ctx);
    expect(out).toHaveLength(5);
    expect((out[0]!.plan as any).commands[0].parameters).toEqual({ brightness_pct: 100 });
    expect((out[1]!.plan as any).commands[0].parameters).toEqual({ temperature: 16 });
    expect(out[2]).toMatchObject({ sensitive: true });
    expect(out.slice(3).map((x) => x.kind)).toEqual(["scene", "mode"]);
    expect(validateProposals({ proposals: [{ type: "routine", label: "Bed", id: "r1" }] }, ctx)[0]!.kind).toBe("routine");
    expect(out.every((x) => x.detail.includes("best guess"))).toBe(true);
  });
  test("invented ids, actions a device cannot do, other services, and nonsense are all dropped", () => {
    const out = validateProposals({ proposals: [
      { type: "devices", label: "x", commands: [{ thingId: "ghost", action: "turn_off" }] },
      { type: "devices", label: "x", commands: [{ thingId: "t1", action: "lock" }] },
      { type: "devices", label: "x", commands: [{ thingId: "t1", action: "factory_reset" }] },
      { type: "devices", label: "x", commands: [{ thingId: "t1", action: "set_brightness", parameters: { brightness_pct: "NaN" } }] },
      { type: "scene", label: "x", id: "nope" }, { type: "mode", label: "x", mode: "party" }, { type: "shell", label: "rm -rf" }, { type: "devices", commands: [] }, "text", null,
    ] }, ctx);
    expect(out).toEqual([]);
    expect(validateProposals(undefined, ctx)).toEqual([]);
    expect(validateProposals({ proposals: "all" }, ctx)).toEqual([]);
  });
  test("at most five proposals and twenty commands are considered", () => {
    const many = Array.from({ length: 9 }, () => ({ type: "scene", label: "Movie", id: "s1" }));
    expect(validateProposals({ proposals: many }, ctx)).toHaveLength(5);
  });
});

describe("the Claude reader", () => {
  const reply = (input: unknown, status = 200) => (async (_u: unknown, init?: RequestInit) => { seen.push(JSON.parse(String(init!.body))); seen.push(init!.headers); return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "propose_actions", input }] }), { status }); }) as unknown as typeof fetch;
  let seen: any[] = [];
  test("sends names and rooms only, forces the tool, and returns the validated plan", async () => {
    seen = [];
    const r = new AnthropicInterpreter("sk-test", "claude-haiku-5-5", reply({ proposals: [{ type: "devices", label: "Turn off the kitchen lights", commands: [{ thingId: "t1", action: "turn_off" }] }] }));
    const out = await r.interpret("make the kitchen go dark", ctx);
    expect(out[0]).toMatchObject({ label: "Turn off the kitchen lights" });
    const [body, headers] = seen;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.tool_choice).toEqual({ type: "tool", name: "propose_actions" });
    const sent = body.messages[0].content as string;
    expect(sent).toContain("Pendant lights");
    expect(sent).toContain("Kitchen");
    expect(sent).not.toMatch(/token|password|passkey|brightness_pct\":\d|temperature\":\d/);
  });
  test("a failing service is an error the caller can handle", async () => {
    seen = [];
    await expect(new AnthropicInterpreter("k", "m", reply({}, 529)).interpret("anything at all", ctx)).rejects.toThrow(/529/);
  });
});
