import { readFileSync } from "node:fs";
import { join } from "node:path";

const env = Object.fromEntries(readFileSync(join(__dirname, "../../backend/.env.test"), "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
export const HA_URL = env.HA_URL!;
export const HA_TOKEN = env.HA_TOKEN!;

/** Talks to the mock Home Assistant directly, to check what Alice really did there. */
export async function haState(entityId: string): Promise<string> {
  const r = await fetch(`${HA_URL}/api/states/${entityId}`, { headers: { authorization: `Bearer ${HA_TOKEN}` } });
  return ((await r.json()) as { state: string }).state;
}
export async function haService(domain: string, service: string, data: object) {
  await fetch(`${HA_URL}/api/services/${domain}/${service}`, { method: "POST", headers: { authorization: `Bearer ${HA_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(data) });
}
export async function haScripts(): Promise<string[]> {
  const r = await fetch(`${HA_URL}/api/states`, { headers: { authorization: `Bearer ${HA_TOKEN}` } });
  return ((await r.json()) as { entity_id: string; attributes: { friendly_name?: string } }[]).filter((s) => s.entity_id.startsWith("script.")).map((s) => s.attributes.friendly_name ?? "");
}
