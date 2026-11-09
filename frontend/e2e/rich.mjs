/**
 * Makes a signed-in test home look like a real, busy one: long device names, several things left open (so several
 * alerts), and an automation with a long name and many steps. Works through the app's own API from inside the page
 * (the session cookie and the app header travel with the request), and the mock Home Assistant directly.
 */
const LONG = [
  "The kitchen counter under-cabinet warm white strip light by the window",
  "Master bedroom reading lamp on the left side of the bed",
  "Garden pergola roof louvres, east side, with rain sensor",
  "Front hallway ceiling light above the stairs and coat rack",
];

export async function seedRich(page, ha) {
  const api = (method, path, body) => page.evaluate(async ([m, p, b]) => {
    const r = await fetch(`/api/v1${p}`, { method: m, credentials: "include", headers: { "content-type": "application/json", "x-requested-with": "alice" }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [method, path, body]);
  const devs = (await api("GET", "/devices")).json.devices;
  const by = (d) => d.primary?.domain;
  // long names on a few lights, a fan and a cover
  const targets = [...devs.filter((d) => by(d) === "light").slice(0, 3), ...devs.filter((d) => by(d) === "cover").slice(0, 1)];
  const renamed = [];
  for (const [i, d] of targets.entries()) { const r = await api("PATCH", `/devices/${d.id}/name`, { name: LONG[i % LONG.length] }); if (r.status < 300) renamed.push(d.id); }
  // leave every cover open: several "left open" alerts
  const covers = devs.filter((d) => by(d) === "cover").map((d) => d.primary.entityId);
  for (const e of covers) await fetch(`${ha.url}/api/services/cover/open_cover`, { method: "POST", headers: { authorization: `Bearer ${ha.token}`, "content-type": "application/json" }, body: JSON.stringify({ entity_id: e }) });
  // an automation with a long name and many steps
  const lights = devs.filter((d) => by(d) === "light").slice(0, 4).map((d) => d.primary.entityId);
  const auto = await api("POST", "/automations", {
    name: "Everyone has left on a weekday evening: lights off, garden closed for the night",
    definition: { version: 1, trigger: { type: "leave" }, conditions: [{ type: "dark" }, { type: "days", days: "weekdays" }], actions: lights.map((e) => ({ type: "device", entityId: e, action: "turn_off" })) },
  });
  return { renamed: renamed.length, covers: covers.length, automation: auto.status, automationError: auto.status >= 300 ? JSON.stringify(auto.json).slice(0, 200) : null };
}
