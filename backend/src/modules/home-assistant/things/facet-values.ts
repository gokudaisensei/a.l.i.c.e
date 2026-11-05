import type { EntityProjection } from "../state/state-cache";
import type { Thing, ThingOverrides } from "./types";

/**
 * A facet is a state of a device ("shutter closed", "mic muted"), not a device.
 * HA only gives us on/off for most of them, and what "on" means depends on the entity, so we work it out here.
 */
export type FacetTone = "ok" | "warn" | "alert" | "neutral";
export type FacetBasis = "override" | "device_class" | "name" | "state" | "none";

export interface FacetValue {
  key: string;
  entityId: string;
  /** Canonical value: "open" | "closed" | "muted" | "locked" | "detected" | …, or "unknown". */
  value: string;
  /** Human wording for the UI. */
  label: string;
  /** Is the underlying binary sensor triggered (on)? Null for enum sensors or unknown state. */
  active: boolean | null;
  tone: FacetTone;
  /** True when we could not tell what "on" means. The label then just says On/Off until an override sets it. */
  ambiguous: boolean;
  basis: FacetBasis;
  sensitive: boolean;
}

interface Polarity {
  on: string;
  off: string;
  onTone: FacetTone;
  offTone: FacetTone;
}

const P = (on: string, off: string, onTone: FacetTone = "neutral", offTone: FacetTone = "neutral"): Polarity => ({ on, off, onTone, offTone });

/** HA binary_sensor device classes where "on" has a fixed documented meaning. */
const BY_DEVICE_CLASS: Record<string, Polarity> = {
  door: P("open", "closed", "warn", "ok"),
  window: P("open", "closed", "warn", "ok"),
  opening: P("open", "closed", "warn", "ok"),
  garage_door: P("open", "closed", "warn", "ok"),
  lock: P("unlocked", "locked", "warn", "ok"), // for binary_sensor, on = unlocked
  motion: P("detected", "clear"),
  occupancy: P("occupied", "vacant"),
  presence: P("home", "away"),
  tamper: P("tampered", "ok", "alert", "ok"),
  smoke: P("detected", "clear", "alert", "ok"),
  gas: P("detected", "clear", "alert", "ok"),
  carbon_monoxide: P("detected", "clear", "alert", "ok"),
  moisture: P("wet", "dry", "alert", "ok"),
  safety: P("unsafe", "safe", "alert", "ok"),
  sound: P("detected", "clear"),
  vibration: P("detected", "clear"),
  running: P("running", "idle"),
  privacy: P("private", "normal"),
};

/** Wording in the entity's own name; checked in order, first match wins. */
const BY_NAME: [RegExp, Polarity][] = [
  [/\b(shutter|cover|lid)\b.*\b(closed|covered)\b|\b(closed|covered)\b.*\b(shutter|cover|lid)\b/i, P("closed", "open", "ok", "ok")],
  [/\b(shutter|cover|lid)\b.*\bopen\b|\bopen\b.*\b(shutter|cover|lid)\b/i, P("open", "closed", "ok", "ok")],
  [/\bunmuted\b/i, P("unmuted", "muted")],
  [/\bmuted?\b/i, P("muted", "unmuted", "warn", "ok")],
  [/\bprivacy\b/i, P("private", "normal")],
  [/\btamper/i, P("tampered", "ok", "alert", "ok")],
  [/\bopen( state)?\b/i, P("open", "closed", "warn", "ok")],
  [/\b(motion|movement)\b/i, P("detected", "clear")],
  [/\b(occupied|occupancy)\b/i, P("occupied", "vacant")],
];

/** Which value is the opposite of which, so an override only needs to say what "on" means. */
const OPPOSITE: Record<string, string> = {
  open: "closed", closed: "open", muted: "unmuted", unmuted: "muted", locked: "unlocked", unlocked: "locked",
  detected: "clear", clear: "detected", occupied: "vacant", vacant: "occupied", tampered: "ok", ok: "tampered",
  running: "idle", idle: "running", private: "normal", normal: "private", home: "away", away: "home", wet: "dry", dry: "wet",
  unsafe: "safe", safe: "unsafe",
};

const WARN = new Set(["open", "unlocked", "muted", "tampered", "wet", "unsafe"]);
const toneFor = (value: string): FacetTone => (value === "tampered" || value === "wet" || value === "unsafe" ? "alert" : WARN.has(value) ? "warn" : "ok");
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Sensitive facets whose changes deserve extra care (camera shutter, mic mute, tamper). */
const SENSITIVE = new Set(["privacy_shutter", "mic_muted", "tamper"]);

export interface FacetInput {
  key: string;
  entityId: string;
  domain: string;
  deviceClass: string | null;
  name: string;
  /** Live HA state string, or undefined if the entity is not in the cache. */
  state: string | undefined;
  /** User-supplied meaning of "on", e.g. "closed". */
  onMeans?: string;
}

const unknown = (i: FacetInput, ambiguous = false): FacetValue => ({
  key: i.key, entityId: i.entityId, value: "unknown", label: "Unavailable", active: null, tone: "neutral", ambiguous, basis: "none", sensitive: SENSITIVE.has(i.key),
});

export function describeFacet(i: FacetInput): FacetValue {
  if (i.state === undefined || i.state === "unavailable" || i.state === "unknown") return unknown(i);
  const sensitive = SENSITIVE.has(i.key);
  const base = { key: i.key, entityId: i.entityId, sensitive };

  // Enum-style sensors report the value themselves ("open", "closed", "tilted").
  if (i.domain !== "binary_sensor" && i.domain !== "switch") {
    const v = i.state.toLowerCase();
    return { ...base, value: v, label: cap(i.state), active: null, tone: toneFor(v), ambiguous: false, basis: "state" };
  }

  const isOn = i.state === "on";
  const make = (pol: Polarity, basis: FacetBasis): FacetValue => {
    const value = isOn ? pol.on : pol.off;
    return { ...base, value, label: cap(value), active: isOn, tone: isOn ? pol.onTone : pol.offTone, ambiguous: false, basis };
  };

  if (i.onMeans) {
    const off = OPPOSITE[i.onMeans] ?? `not ${i.onMeans}`;
    return make({ on: i.onMeans, off, onTone: toneFor(i.onMeans), offTone: toneFor(off) }, "override");
  }
  if (i.deviceClass && BY_DEVICE_CLASS[i.deviceClass]) return make(BY_DEVICE_CLASS[i.deviceClass]!, "device_class");
  for (const [re, pol] of BY_NAME) if (re.test(i.name)) return make(pol, "name");

  // "Camera shutter" with no polarity word: HA gives us on/off and nothing that says which is which.
  return { ...base, value: i.state, label: cap(i.state), active: isOn, tone: "neutral", ambiguous: true, basis: "none" };
}

/** Live facet values for a Thing, joined from the state cache. */
export function describeThingFacets(
  thing: Thing,
  lookup: (entityId: string) => EntityProjection | undefined,
  overrides: ThingOverrides = {},
): FacetValue[] {
  return thing.facets.map((f) =>
    describeFacet({
      key: f.key, entityId: f.entityId, domain: f.domain, deviceClass: f.deviceClass, name: f.name,
      state: lookup(f.entityId)?.state, onMeans: overrides.entities?.[f.entityId]?.onMeans,
    }),
  );
}
