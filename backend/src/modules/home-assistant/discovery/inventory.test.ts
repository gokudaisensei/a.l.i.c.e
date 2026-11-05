import { expect, test } from "bun:test";
import { state } from "../testing";
import { buildInventory } from "./inventory";

test("resolves area via device, drops disabled/hidden, derives capabilities and names", () => {
  const inv = buildInventory({
    areas: [{ area_id: "living", name: "Living room" }],
    devices: [
      { id: "d1", name: "Hue lamp", area_id: "living", manufacturer: "Signify", model: "A60" },
      { id: "d2", name: "Old", area_id: null, manufacturer: null, model: null, disabled_by: "user" },
    ],
    entityRegistry: [
      { entity_id: "light.lamp", device_id: "d1", area_id: null, platform: "hue" },
      { entity_id: "light.hidden", device_id: null, area_id: null, platform: "hue", hidden_by: "user" },
      { entity_id: "switch.override", device_id: "d1", area_id: "kitchen", platform: "x" },
    ],
    states: [
      state("light.lamp", "on", { friendly_name: "Floor lamp", supported_color_modes: ["brightness"] }),
      state("light.hidden", "on"),
      state("switch.override", "off"),
      state("sensor.orphan", "5"),
    ],
    services: {},
  });
  const byId = Object.fromEntries(inv.entities.map((e) => [e.entityId, e]));
  expect(Object.keys(byId).sort()).toEqual(["light.lamp", "sensor.orphan", "switch.override"]);
  expect(byId["light.lamp"]).toMatchObject({ name: "Floor lamp", areaId: "living", deviceId: "d1" });
  expect(byId["light.lamp"]!.capabilities.map((c) => c.name)).toEqual(["power", "brightness"]);
  expect(byId["switch.override"]!.areaId).toBe("kitchen"); // entity area beats device area
  expect(byId["sensor.orphan"]!.areaId).toBeNull();
  expect(inv.devices.map((d) => d.deviceId)).toEqual(["d1"]);
});
