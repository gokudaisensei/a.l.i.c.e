import { describe, expect, test } from "bun:test";
import { canonicalConfig, sameConfig } from "./config-ops";

const ours = { alias: "Alice scene: Movie", mode: "single", sequence: [{ parallel: [{ service: "light.turn_on", target: { entity_id: "light.a" }, data: { brightness_pct: 15 }, continue_on_error: true }] }] };

describe("comparing with what Home Assistant stores", () => {
  test("the rewrites Home Assistant does are not differences", () => {
    const stored = { sequence: [{ parallel: [{ continue_on_error: true, data: { brightness_pct: 15 }, action: "light.turn_on", target: { entity_id: "light.a" } }] }], alias: "Alice scene: Movie" }; // other key order, service renamed, default mode dropped
    expect(sameConfig(ours, stored)).toBe(true);
  });
  test("automations: platform becomes trigger, an empty condition list may vanish, an id appears", () => {
    const a = { alias: "A", mode: "single", trigger: [{ platform: "state", entity_id: ["person.a"], to: "home" }], condition: [], action: [{ service: "script.alice_scene_x" }] };
    const stored = { id: "alice_auto_1", alias: "A", trigger: [{ trigger: "state", entity_id: ["person.a"], to: "home" }], action: [{ action: "script.alice_scene_x" }] };
    expect(sameConfig(a, stored)).toBe(true);
  });
  test("newer Home Assistant stores triggers, conditions and actions in the plural", () => {
    const a = { alias: "A", mode: "single", trigger: [{ platform: "state", entity_id: "x.y", to: "on" }], condition: [{ condition: "time", weekday: ["mon"] }], action: [{ service: "a.b", target: { entity_id: "c.d" } }] };
    const stored = { id: "alice_auto_1", alias: "A", triggers: [{ platform: "state", entity_id: "x.y", to: "on" }], conditions: [{ condition: "time", weekday: ["mon"] }], actions: [{ target: { entity_id: "c.d" }, action: "a.b" }], mode: "single" };
    expect(sameConfig(a, stored)).toBe(true);
    expect(sameConfig(a, { ...stored, actions: [] })).toBe(false);
  });
  test("real differences are noticed: a value, a missing step, an extra step, a different device", () => {
    const edit = (f: (c: any) => void) => { const c = structuredClone(ours) as any; f(c); return c; };
    expect(sameConfig(ours, edit((c) => { c.sequence[0].parallel[0].data.brightness_pct = 90; }))).toBe(false);
    expect(sameConfig(ours, edit((c) => { c.sequence[0].parallel = []; }))).toBe(false);
    expect(sameConfig(ours, edit((c) => { c.sequence.push({ delay: { seconds: 5 } }); }))).toBe(false);
    expect(sameConfig(ours, edit((c) => { c.sequence[0].parallel[0].target.entity_id = "light.b"; }))).toBe(false);
    expect(sameConfig(ours, edit((c) => { c.mode = "parallel"; }))).toBe(false);
    expect(sameConfig(ours, edit((c) => { c.alias = "Renamed"; }))).toBe(false);
  });
  test("continue_on_error false is the same as absent; order of steps matters", () => {
    expect(sameConfig({ sequence: [{ service: "a.b", continue_on_error: false }] }, { sequence: [{ action: "a.b" }] })).toBe(true);
    expect(sameConfig({ sequence: [{ service: "a.b" }, { service: "c.d" }] }, { sequence: [{ service: "c.d" }, { service: "a.b" }] })).toBe(false);
    expect(canonicalConfig({ b: 1, a: 2 })).toEqual({ a: 2, b: 1 });
  });
});
