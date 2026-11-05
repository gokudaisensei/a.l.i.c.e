const SMALL = new Set(["a", "an", "and", "of", "the", "in", "on", "to", "for"]);

/** Words that must stay upper-case when we title-case. */
const KEEP_UPPER = new Set(["tv", "ac", "led", "usb", "uv", "co2", "pm", "ip", "dns", "nas", "hdmi", "rgb", "dc"]);

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Fixes casing only when the text is all one case; mixed case is assumed deliberate. */
export function fixCase(s: string): string {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(" ")
    .map((w, i) => (KEEP_UPPER.has(w) ? w.toUpperCase() : i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Removes a leading phrase (case-insensitive, whole words) and any separator after it. */
export function stripPrefix(text: string, prefix: string | null | undefined): string {
  if (!prefix) return text;
  const p = prefix.trim().toLowerCase();
  const t = text.trim();
  if (!p || t.toLowerCase() === p || !t.toLowerCase().startsWith(p)) return t;
  const rest = t.slice(p.length);
  if (!/^[\s\-_:·]/.test(rest)) return t; // "Kitchenette" must not lose "Kitchen"
  return collapse(rest.replace(/^[\s\-_:·]+/, ""));
}

/** Removes integration artifacts: underscores, "None", trailing "_2"/" 2" duplicate suffixes added by HA. */
export function scrub(text: string): string {
  return collapse(
    text
      .replace(/_/g, " ")
      .replace(/\bnone\b/gi, " ")
      .replace(/\s+\d+$/, (m) => (/^\s+[2-9]$/.test(m) ? "" : m)), // " 2" is a dedupe artifact; " 10" is not
  );
}

export interface NameInput {
  /** HA's `friendly_name` (device + entity part joined). */
  sourceName: string;
  /** The entity's own name part when HA composes names from device + entity. */
  ownName: string | null;
  hasEntityName: boolean;
  deviceName: string | null;
  areaName: string | null;
}

/**
 * Display name for an entity *within its Thing* ("Microphone mute", not "Kitchen display Microphone mute").
 * Returns null when the entity is the device itself (its name equals the device name).
 */
export function cleanEntityName(i: NameInput): string | null {
  let n = i.hasEntityName && i.ownName ? i.ownName : i.sourceName;
  n = scrub(n);
  n = stripPrefix(n, i.deviceName ? scrub(i.deviceName) : null);
  n = stripPrefix(n, i.areaName);
  n = scrub(n);
  if (!n) return null;
  if (i.deviceName && n.toLowerCase() === scrub(i.deviceName).toLowerCase()) return null;
  return fixCase(n);
}

/** Display name for a Thing: user name wins, then device name minus the area prefix. */
export function cleanThingName(deviceName: string, areaName: string | null): string {
  const n = scrub(stripPrefix(scrub(deviceName), areaName)) || scrub(deviceName) || deviceName;
  return fixCase(n);
}

const SYNONYMS: Record<string, string[]> = {
  light: ["lamp", "bulb", "light"],
  switch: ["switch", "plug", "socket"],
  media_player: ["speaker", "tv", "player", "music"],
  climate: ["ac", "thermostat", "heater", "aircon"],
  lock: ["lock", "door"],
  cover: ["blind", "shade", "curtain", "shutter", "garage"],
  fan: ["fan"],
  camera: ["camera", "cam"],
  vacuum: ["vacuum", "robot"],
};

/** Search phrases for resolving things like "kitchen lamp". Lower-case, unique. */
export function buildAliases(name: string, areaName: string | null, domain: string): string[] {
  const base = name.toLowerCase();
  const out = new Set<string>([base]);
  if (areaName) out.add(`${areaName.toLowerCase()} ${base}`);
  for (const syn of SYNONYMS[domain] ?? []) {
    if (!base.includes(syn)) {
      out.add(`${base} ${syn}`);
      if (areaName) out.add(`${areaName.toLowerCase()} ${syn}`);
    }
  }
  return [...out];
}
