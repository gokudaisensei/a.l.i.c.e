/**
 * Gives the mock Home Assistant a home that looks like the design: rooms, friendly names, doors locked.
 * Usage: bun run ha:seed   (needs bun run ha:up and ha:bootstrap first; safe to run again)
 */
const env = Object.fromEntries((await Bun.file(new URL("../../.env.test", import.meta.url)).text()).split("\n").filter(Boolean).map((l) => l.split("=") as [string, string]));

const ROOMS = ["Living room", "Kitchen", "Bedroom", "Arjun's room", "Bathroom", "Guest room", "Hall", "Garden"];
/** entity id -> [room, friendly name?] */
const PLACE: Record<string, [string, string?]> = {
  "light.living_room_rgbww_lights": ["Living room", "Floor lamp"], "fan.living_room_fan": ["Living room", "Ceiling fan"], "climate.ecobee": ["Living room", "Living AC"],
  "cover.living_room_window": ["Living room", "Balcony door"], "switch.decorative_lights": ["Living room", "TV and console"],
  "light.kitchen_lights": ["Kitchen", "Pendant lights"], "cover.kitchen_window": ["Kitchen", "Kitchen window"],
  "light.bed_light": ["Bedroom", "Bedside lamps"], "climate.heatpump": ["Bedroom", "Bedroom AC"],
  "light.office_rgbw_lights": ["Arjun's room", "Night light"],
  "switch.ac": ["Bathroom", "Water heater"],
  "light.ceiling_lights": ["Guest room", "Guest lamp"], "climate.hvac": ["Guest room", "Guest AC"], "fan.ceiling_fan": ["Guest room", "Guest fan"],
  "light.entrance_color_white_lights": ["Hall", "Hall lights"], "lock.front_door": ["Hall", "Front door"], "cover.hall_window": ["Hall", "Hall window"], "camera.demo_camera": ["Hall", "Doorbell camera"],
  "lock.kitchen_door": ["Garden", "Back door"], "cover.garage_door": ["Garden", "Garage door"],
};

const ws = new WebSocket(env.HA_URL!.replace("http", "ws") + "/api/websocket");
let n = 0;
const waiting = new Map<number, (m: any) => void>();
const call = (m: object) => new Promise<any>((res) => { const id = ++n; waiting.set(id, res); ws.send(JSON.stringify({ id, ...m })); });
const ready = new Promise<void>((res, rej) => {
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: env.HA_TOKEN }));
    else if (m.type === "auth_ok") res();
    else if (m.type === "auth_invalid") rej(new Error("The test token was rejected. Run bun run ha:bootstrap again."));
    else if (m.type === "result") { waiting.get(m.id)?.(m); waiting.delete(m.id); }
  };
});
await ready;

const have = ((await call({ type: "config/area_registry/list" })).result as { area_id: string; name: string }[]);
const areaId: Record<string, string> = Object.fromEntries(have.map((a) => [a.name.toLowerCase(), a.area_id]));
for (const r of ROOMS) {
  if (areaId[r.toLowerCase()]) continue;
  const c = await call({ type: "config/area_registry/create", name: r });
  if (!c.success) throw new Error(`Could not create ${r}: ${JSON.stringify(c.error)}`);
  areaId[r.toLowerCase()] = c.result.area_id;
}

const registry = (await call({ type: "config/entity_registry/list" })).result as { entity_id: string; device_id: string | null }[];
const entities = registry.map((e) => e.entity_id);
const deviceOf = Object.fromEntries(registry.map((e) => [e.entity_id, e.device_id]));
let placed = 0;
for (const [entity, [room, name]] of Object.entries(PLACE)) {
  if (!entities.includes(entity)) continue;
  const r = await call({ type: "config/entity_registry/update", entity_id: entity, area_id: areaId[room.toLowerCase()], ...(name ? { name } : {}) });
  // Devices carry the name Alice shows, so rename and place the device as well.
  if (deviceOf[entity]) await call({ type: "config/device_registry/update", device_id: deviceOf[entity], area_id: areaId[room.toLowerCase()], ...(name ? { name_by_user: name } : {}) });
  if (r.success) placed++;
}
// Doors locked, like the design.
for (const lock of ["lock.front_door", "lock.kitchen_door"]) await fetch(`${env.HA_URL}/api/services/lock/lock`, { method: "POST", headers: { authorization: `Bearer ${env.HA_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ entity_id: lock }) });
console.log(`Seeded ${ROOMS.length} rooms and placed ${placed} devices.`);
process.exit(0);
