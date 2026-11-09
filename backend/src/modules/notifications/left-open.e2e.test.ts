import { beforeEach, describe, expect, test } from "bun:test";
import { state } from "../home-assistant/testing";
import { createWorld, homeWithHa, MIN, type World } from "../../testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
const DOOR = "binary_sensor.front_door_sensor_door";
const alerts = async () => (await h.admin.call("GET", "/alerts")).json.alerts as any[];
const notes = async () => (await h.admin.call("GET", "/notifications")).json.notifications as any[];

/** Changes the door sensor in the fake Home Assistant, stamped with the world's current time. */
function setDoor(value: "on" | "off") {
  const prev = w.gw.states.find((s) => s.entity_id === DOOR)!;
  const next = { ...state(DOOR, value, prev.attributes), last_changed: new Date(w.clock.now).toISOString() };
  w.gw.states = w.gw.states.map((s) => (s.entity_id === DOOR ? next : s));
  w.gw.emitState(next, prev);
}

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("left-open alerts", () => {
  test("a door open for ten minutes raises an alert and a notification; closing it clears the alert", async () => {
    setDoor("on");
    w.services.alerts.sweepAll();
    expect(await alerts()).toHaveLength(0); // not yet
    w.clock.now += 9 * MIN; w.services.alerts.sweepAll();
    expect(await alerts()).toHaveLength(0);
    w.clock.now += 2 * MIN; w.services.alerts.sweepAll();
    const a = await alerts();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "left_open", title: "Front door sensor is open", detail: "Left open for 11 minutes." });
    expect((await notes()).some((n) => n.kind === "left_open")).toBe(true);
    w.clock.now += 5 * MIN; w.services.alerts.sweepAll();
    expect(await alerts()).toHaveLength(1); // still one, now 16 minutes
    expect((await alerts())[0].detail).toBe("Left open for 16 minutes.");
    setDoor("off");
    expect(await alerts()).toHaveLength(0);
  });

  test("a door that was closed in time never raises one, and a closed door is never reported", async () => {
    setDoor("on");
    w.clock.now += 5 * MIN;
    setDoor("off");
    w.clock.now += 20 * MIN; w.services.alerts.sweepAll();
    expect(await alerts()).toHaveLength(0);
  });
});
