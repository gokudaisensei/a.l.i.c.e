import { expect, test } from "bun:test";
import { state } from "../testing";
import { normalizeRegistryEvent, normalizeStateChanged } from "./normalizer";

const scope = { householdId: "h1", connectionId: "c1" };
const ev = (old: ReturnType<typeof state> | null, next: ReturnType<typeof state> | null) => ({
  entity_id: "light.a", old_state: old, new_state: next, context: { id: "x", parent_id: null, user_id: "u1" }, timeFired: "t",
});

test("state change becomes entity.state_changed with context", () => {
  const out = normalizeStateChanged(scope, ev(state("light.a", "off"), state("light.a", "on")));
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ type: "entity.state_changed", previousState: "off", currentState: "on", householdId: "h1", context: { id: "x", userId: "u1" } });
});

test("events carry capability-level values alongside raw attributes", () => {
  const next = state("light.a", "on", { brightness: 76, color_mode: "brightness" });
  const [e] = normalizeStateChanged(scope, ev(state("light.a", "off"), next));
  expect(e).toMatchObject({ attributes: { brightness: 76 }, normalized: { power: true, brightness: 30 } });
});

test("going unavailable adds an availability event", () => {
  const out = normalizeStateChanged(scope, ev(state("light.a", "on"), state("light.a", "unavailable")));
  expect(out.map((e) => e.type)).toEqual(["entity.state_changed", "entity.availability_changed"]);
  expect(out[1]).toMatchObject({ availability: "unavailable" });
});

test("removal becomes entity.removed", () => {
  expect(normalizeStateChanged(scope, ev(state("light.a", "on"), null))[0]).toMatchObject({ type: "entity.removed", entityId: "light.a" });
});

test("registry events are mapped; others ignored", () => {
  const raw = (event_type: string) => ({ event_type, data: {}, time_fired: "t", context: { id: "x", parent_id: null, user_id: null } });
  expect(normalizeRegistryEvent(scope, raw("area_registry_updated"))).toMatchObject({ type: "registry.updated", registry: "area" });
  expect(normalizeRegistryEvent(scope, raw("something_else"))).toBeNull();
});
