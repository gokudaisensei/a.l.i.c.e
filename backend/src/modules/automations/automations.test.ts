import { describe, expect, test } from "bun:test";
import { validateOperation } from "../home-assistant/config-ops";
import { CompileError, compileAutomation, describeAutomation, type CompileContext, type Names } from "./compile";
import { type AutomationDefinition, parseDefinition } from "./definition";
import { automationConfigId } from "../home-assistant/compile";

const ctx: CompileContext = { personEntityIds: ["person.gokul", "person.meera"], personOfUser: (u) => (u === "usr_meera" ? "person.meera" : null), powerLimit: (id) => (id === "switch.kettle" ? { sensor: "sensor.kettle_power", limitW: 1500 } : null) };
const names: Names = {
  device: (id) => ({ "light.hall": "Hall lights", "light.floor": "Floor lamp", "lock.front": "Front door", "switch.kettle": "Kettle" })[id] ?? id,
  person: (id) => ({ "person.meera": "Meera" })[id] ?? id,
  user: (id) => ({ usr_meera: "Meera" })[id] ?? id,
  scene: () => "Movie night", routine: () => "Goodnight",
};
const def = (over: Partial<AutomationDefinition>): AutomationDefinition => ({ version: 1, trigger: { type: "arrive", person: "anyone" }, conditions: [], actions: [{ type: "device", entityId: "light.hall", action: "turn_on" }], ...over });
const accepted = (name: string, d: AutomationDefinition) => { const c = compileAutomation(name, d, ctx); validateOperation({ op: "automation.upsert", id: "alice_auto_1", enabled: true, config: c }); return c; };

describe("parseDefinition checks the shape", () => {
  test("accepts every trigger, condition and action", () => {
    for (const trigger of [{ type: "arrive", person: "person.meera" }, { type: "leave" }, { type: "time", at: "22:30" }, { type: "sunset", offsetMinutes: -30 }, { type: "sunrise" }, { type: "door_opens", entityId: "binary_sensor.door" }, { type: "motion", entityId: "binary_sensor.pir" }, { type: "power_over_limit", entityId: "switch.kettle" }]) {
      expect(() => parseDefinition({ version: 1, trigger, conditions: [{ type: "dark" }, { type: "someone_home" }, { type: "days", days: "weekdays" }, { type: "mode", mode: "night" }], actions: [{ type: "device", entityId: "light.hall", action: "set_brightness", parameters: { brightness_pct: 70 } }, { type: "scene", sceneId: "scn_1" }, { type: "routine", routineId: "rtn_1" }, { type: "notify", message: "hi" }, { type: "mode", mode: "away" }] })).not.toThrow();
    }
  });
  test("refuses everything else with a plain message", () => {
    const bad = (x: object) => expect(() => parseDefinition({ version: 1, trigger: { type: "leave" }, conditions: [], actions: [{ type: "mode", mode: "home" }], ...x })).toThrow();
    bad({ trigger: { type: "time", at: "25:00" } }); bad({ trigger: { type: "sunset", offsetMinutes: 9999 } }); bad({ trigger: { type: "webhook" } });
    bad({ trigger: { type: "door_opens", entityId: "not an entity" } }); bad({ conditions: [{ type: "weather" }] }); bad({ conditions: [{ type: "mode", mode: "party" }] });
    bad({ conditions: Array(11).fill({ type: "dark" }) }); bad({ actions: [] }); bad({ actions: Array(21).fill({ type: "mode", mode: "home" }) });
    bad({ actions: [{ type: "device", entityId: "light.a", action: "x".repeat(50) }] }); bad({ actions: [{ type: "notify", message: "" }] });
    bad({ actions: [{ type: "notify", message: "x", userIds: [1] }] });
    expect(() => parseDefinition({ ...def({}), version: 2 })).toThrow(/version/);
    expect(() => parseDefinition("nope")).toThrow();
  });
});

describe("compiling to a Home Assistant automation", () => {
  test("arrive: anyone or one person; leave also requires that nobody is left home", () => {
    expect(accepted("A", def({})).trigger).toEqual([{ platform: "state", entity_id: ["person.gokul", "person.meera"], to: "home" }]);
    expect(accepted("A", def({ trigger: { type: "arrive", person: "person.meera" } })).trigger).toEqual([{ platform: "state", entity_id: ["person.meera"], to: "home" }]);
    const leave = accepted("L", def({ trigger: { type: "leave" } }));
    expect(leave.trigger).toEqual([{ platform: "state", entity_id: ["person.gokul", "person.meera"], to: "not_home" }]);
    expect(leave.condition[0]).toMatchObject({ condition: "template" });
  });
  test("arrive by household member uses whichever person they are linked to", () => {
    expect(accepted("A", def({ trigger: { type: "arrive", userId: "usr_meera" } })).trigger).toEqual([{ platform: "state", entity_id: ["person.meera"], to: "home" }]);
    expect(() => compileAutomation("A", def({ trigger: { type: "arrive", userId: "usr_other" } }), ctx)).toThrow(/not linked/);
    expect(describeAutomation(def({ trigger: { type: "arrive", userId: "usr_meera" } }), names)).toMatch(/^When Meera gets home/);
  });
  test("time, sun with offsets, sensors, power", () => {
    expect(accepted("T", def({ trigger: { type: "time", at: "22:30" } })).trigger).toEqual([{ platform: "time", at: "22:30:00" }]);
    expect(accepted("S", def({ trigger: { type: "sunset", offsetMinutes: -30 } })).trigger).toEqual([{ platform: "sun", event: "sunset", offset: "-00:30:00" }]);
    expect(accepted("S", def({ trigger: { type: "sunrise", offsetMinutes: 90 } })).trigger).toEqual([{ platform: "sun", event: "sunrise", offset: "+01:30:00" }]);
    expect(accepted("S", def({ trigger: { type: "sunrise" } })).trigger).toEqual([{ platform: "sun", event: "sunrise" }]);
    expect(accepted("D", def({ trigger: { type: "door_opens", entityId: "binary_sensor.door" } })).trigger).toEqual([{ platform: "state", entity_id: "binary_sensor.door", to: "on" }]);
    expect(accepted("P", def({ trigger: { type: "power_over_limit", entityId: "switch.kettle" } })).trigger).toEqual([{ platform: "numeric_state", entity_id: "sensor.kettle_power", above: 1350 }]);
  });
  test("conditions", () => {
    const c = accepted("C", def({ conditions: [{ type: "dark" }, { type: "someone_home" }, { type: "days", days: "weekends" }, { type: "mode", mode: "night" }] })).condition;
    expect(c).toEqual([
      { condition: "state", entity_id: "sun.sun", state: "below_horizon" },
      expect.objectContaining({ condition: "template" }),
      { condition: "time", weekday: ["sat", "sun"] },
      { condition: "state", entity_id: "input_select.alice_household_mode", state: "night" },
    ]);
  });
  test("actions: devices keep going on error, scenes and routines call their scripts, notify fires the Alice event", () => {
    const a = accepted("X", def({ actions: [
      { type: "device", entityId: "light.floor", action: "set_brightness", parameters: { brightness_pct: 70 } },
      { type: "scene", sceneId: "scn_01JABCDEFGHJKMNPQRSTVWXYZ0" }, { type: "routine", routineId: "rtn_01JABCDEFGHJKMNPQRSTVWXYZ0" },
      { type: "notify", title: "Heater", message: "It is hot", userIds: ["usr_1"] }, { type: "mode", mode: "away" },
    ] })).action;
    expect(a).toEqual([
      { service: "light.turn_on", target: { entity_id: "light.floor" }, data: { brightness_pct: 70 }, continue_on_error: true },
      { service: "script.alice_scene_01jabcdefghjkmnpqrstvwxyz0", continue_on_error: true },
      { service: "script.alice_routine_01jabcdefghjkmnpqrstvwxyz0", continue_on_error: true },
      { event: "alice_notification", event_data: { title: "Heater", message: "It is hot", userIds: ["usr_1"] } },
      { service: "input_select.select_option", target: { entity_id: "input_select.alice_household_mode" }, data: { option: "away" } },
    ]);
  });
  test("what cannot be expressed is reported, not guessed", () => {
    const none: CompileContext = { personEntityIds: [], personOfUser: () => null, powerLimit: () => null };
    expect(() => compileAutomation("A", def({}), none)).toThrow(CompileError);
    expect(() => compileAutomation("A", def({ trigger: { type: "leave" } }), none)).toThrow(/people/);
    expect(() => compileAutomation("A", def({ trigger: { type: "arrive", person: "person.stranger" } }), ctx)).toThrow(/not in Home Assistant/);
    expect(() => compileAutomation("A", def({ trigger: { type: "power_over_limit", entityId: "switch.other" } }), ctx)).toThrow(/power limit/);
  });
  test("the id Home Assistant sees is stable and Alice's own", () => {
    expect(automationConfigId("atm_01JABCDEFGHJKMNPQRSTVWXYZ0")).toBe("alice_auto_01jabcdefghjkmnpqrstvwxyz0");
    expect(compileAutomation("Lights on", def({}), ctx).alias).toBe("Alice: Lights on");
  });
});

describe("plain-language summaries", () => {
  test("read like the sentence a person would say", () => {
    expect(describeAutomation(def({ conditions: [{ type: "dark" }], actions: [{ type: "device", entityId: "light.hall", action: "turn_on" }, { type: "device", entityId: "light.floor", action: "set_brightness", parameters: { brightness_pct: 70 } }] }), names))
      .toBe("When someone gets home, if it is dark, turn on Hall lights and set Floor lamp to 70%.");
    expect(describeAutomation(def({ trigger: { type: "time", at: "22:30" }, actions: [{ type: "device", entityId: "lock.front", action: "lock" }, { type: "mode", mode: "night" }] }), names))
      .toBe("When it is 10:30 pm, lock Front door and switch to Night mode.");
    expect(describeAutomation(def({ trigger: { type: "arrive", person: "person.meera" }, conditions: [{ type: "days", days: "weekdays" }, { type: "mode", mode: "away" }], actions: [{ type: "scene", sceneId: "s" }, { type: "notify", message: "x" }] }), names))
      .toBe("When Meera gets home, if it is a weekday and the mode is Away, run the “Movie night” scene and send a notification.");
    expect(describeAutomation(def({ trigger: { type: "sunset", offsetMinutes: -30 }, actions: [{ type: "routine", routineId: "r" }] }), names)).toBe("When 30 minutes before the sun sets, run the “Goodnight” routine.");
    expect(describeAutomation(def({ trigger: { type: "power_over_limit", entityId: "switch.kettle" }, actions: [{ type: "device", entityId: "switch.kettle", action: "turn_off" }] }), names)).toBe("When Kettle goes over its power limit, turn off Kettle.");
  });
});
