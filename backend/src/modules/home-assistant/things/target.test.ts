import { expect, test } from "bun:test";
import { homeInventory } from "./fixtures/home";
import { resolveThingTarget } from "./target";
import { buildThings } from "./thing-builder";

const things = buildThings(homeInventory(), "c1");
const echo = things.find((t) => t.deviceIds.includes("echo"))!;

test("defaults to the primary entity", () => {
  expect(resolveThingTarget(things, echo.id)).toEqual({ ok: true, entityId: "media_player.echo_show" });
});
test("an explicit entity must belong to the Thing", () => {
  expect(resolveThingTarget(things, echo.id, "switch.echo_show_microphone_mute")).toEqual({ ok: true, entityId: "switch.echo_show_microphone_mute" });
  expect(resolveThingTarget(things, echo.id, "light.floor_lamp")).toMatchObject({ ok: false, code: "entity_not_in_thing" });
});
test("unknown Thing, and a Thing with nothing to control", () => {
  expect(resolveThingTarget(things, "thing_nope")).toMatchObject({ ok: false, code: "unknown_thing" });
  const bridge = things.find((t) => t.name === "Hue Bridge")!;
  expect(resolveThingTarget(things, bridge.id)).toMatchObject({ ok: false, code: "no_primary" });
});
