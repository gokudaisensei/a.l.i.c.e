import { describe, expect, test } from "bun:test";
import { compileDeviceAction, compileRoutine, compileScene, ownerOfScript, routineObjectId, sceneObjectId } from "./compile";
import { validateOperation } from "./config-ops";

const id = "scn_01JABCDEFGHJKMNPQRSTVWXYZ0";

describe("compiling to Home Assistant scripts", () => {
  test("a device action becomes the service call that implements it, with application values converted", () => {
    expect(compileDeviceAction({ entityId: "light.floor_lamp", action: "set_brightness", parameters: { brightness_pct: 30 } })).toEqual({ service: "light.turn_on", target: { entity_id: "light.floor_lamp" }, data: { brightness_pct: 30 } });
    expect(compileDeviceAction({ entityId: "lock.front", action: "lock" })).toEqual({ service: "lock.lock", target: { entity_id: "lock.front" } });
    expect(compileDeviceAction({ entityId: "cover.c", action: "close" }, true)).toEqual({ service: "cover.close_cover", target: { entity_id: "cover.c" }, continue_on_error: true });
    expect(() => compileDeviceAction({ entityId: "sensor.t", action: "turn_on" })).toThrow(/No Home Assistant service/);
  });

  test("a scene is one parallel block that keeps going if a device fails, named so it is clearly Alice's", () => {
    const { objectId, config } = compileScene({ id, name: "Movie night", icon: "play", actions: [{ entityId: "light.a", action: "turn_off" }, { entityId: "switch.b", action: "turn_on" }] });
    expect(objectId).toBe(`alice_scene_${id.slice(4).toLowerCase()}`);
    expect(config).toMatchObject({ alias: "Alice scene: Movie night", icon: "mdi:play", mode: "single" });
    expect(config.sequence).toHaveLength(1);
    expect((config.sequence[0] as { parallel: unknown[] }).parallel).toHaveLength(2);
    expect(() => validateOperation({ op: "script.upsert", objectId, config })).not.toThrow(); // the worker accepts what we compile
  });

  test("a routine is a sequence: devices, scene scripts, the mode helper, waits; failure policy decides continue_on_error", () => {
    const steps = [
      { type: "device", entityId: "light.a", action: "turn_off" },
      { type: "delay", seconds: 30 },
      { type: "scene", sceneId: id },
      { type: "mode", mode: "night" },
    ] as const;
    const go = compileRoutine({ id: "rtn_01JABCDEFGHJKMNPQRSTVWXYZ0", name: "Goodnight", steps: [...steps], onFailure: "continue" });
    expect(go.config.sequence).toEqual([
      { service: "light.turn_off", target: { entity_id: "light.a" }, continue_on_error: true },
      { delay: { seconds: 30 } },
      { service: `script.${sceneObjectId(id)}`, continue_on_error: true },
      { service: "input_select.select_option", target: { entity_id: "input_select.alice_household_mode" }, data: { option: "night" } },
    ]);
    expect(() => validateOperation({ op: "script.upsert", objectId: go.objectId, config: go.config })).not.toThrow();
    const stop = compileRoutine({ id: "rtn_01JABCDEFGHJKMNPQRSTVWXYZ0", name: "G", steps: [...steps], onFailure: "stop" });
    expect(JSON.stringify(stop.config)).not.toContain("continue_on_error");
  });

  test("script ids map back to their owner", () => {
    expect(ownerOfScript(sceneObjectId(id))).toEqual({ kind: "scene", id });
    expect(ownerOfScript(routineObjectId("rtn_01JABCDEFGHJKMNPQRSTVWXYZ0"))).toEqual({ kind: "routine", id: "rtn_01JABCDEFGHJKMNPQRSTVWXYZ0" });
    expect(ownerOfScript("something_else")).toBeNull();
  });
});
