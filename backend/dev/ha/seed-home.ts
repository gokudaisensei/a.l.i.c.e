/**
 * Gives the mock Home Assistant a home that looks like the design: rooms, friendly names, doors locked.
 * Usage: bun run ha:seed   (needs bun run ha:up and ha:bootstrap first; safe to run again)
 */
const env = Object.fromEntries((await Bun.file(process.env.ENV_FILE ?? new URL("../../.env.test", import.meta.url).pathname).text()).split("\n").filter(Boolean).map((l) => l.split("=") as [string, string]));

import { LIGHTS, SWITCHES, slug } from "./demo/generate-pack";

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

// DEMO=1 (the demo Home Assistant): also place the extra pack devices and the demo integration's spare ones.
if (process.env.DEMO) {
  for (const [n, room] of SWITCHES) PLACE[`switch.${slug(n)}`] = [room];
  for (const [n, room] of LIGHTS) PLACE[`light.${slug(n)}`] = [room];
  Object.assign(PLACE, {
    "cover.pergola_roof": ["Garden", "Pergola roof"], "fan.percentage_full_fan": ["Living room", "Standing fan"],
    "fan.percentage_limited_fan": ["Bedroom", "Bedroom fan"], "fan.preset_only_limited_fan": ["Arjun's room", "Desk fan"],
    "vacuum.demo_vacuum_0_ground_floor": ["Hall", "Robot vacuum"],
    "media_player.living_room": ["Living room", "TV"], "media_player.lounge_room": ["Living room", "Lounge speaker"], "media_player.kitchen": ["Kitchen", "Kitchen speaker"],
    "media_player.bedroom": ["Bedroom", "Bedroom speaker"], "media_player.walkman": ["Arjun's room", "Walkman"], "media_player.browse": ["Guest room", "Guest speaker"],
    "media_player.search": ["Hall", "Hall speaker"], "media_player.group": ["Garden", "Garden speaker"],
    "lock.poorly_installed_door": ["Garden", "Side gate"], "lock.openable_lock": ["Garden", "Shed"],
  } satisfies Record<string, [string, string?]>);
}

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

// A freshly started Home Assistant is still loading its integrations: wait until everything we want to place exists.
type Reg = { entity_id: string; device_id: string | null }[];
let registry = (await call({ type: "config/entity_registry/list" })).result as Reg;
for (let i = 0; i < (process.env.DEMO ? 45 : 0) && Object.keys(PLACE).some((e) => !registry.some((r) => r.entity_id === e)); i++) {
  await Bun.sleep(2000);
  registry = (await call({ type: "config/entity_registry/list" })).result as Reg;
}
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
