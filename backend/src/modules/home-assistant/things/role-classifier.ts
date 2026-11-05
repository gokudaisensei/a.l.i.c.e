import type { InventoryEntity } from "../discovery/inventory";
import type { EntityRole } from "./types";

export interface RoleResult {
  role: EntityRole;
  reason: string;
}

/** Domains that are a device's reason to exist. Lower index wins when several are on one device. */
export const PRIMARY_DOMAINS = [
  "media_player", "climate", "light", "lock", "cover", "fan", "vacuum", "humidifier", "water_heater",
  "alarm_control_panel", "valve", "siren", "remote", "camera",
] as const;

/** Domains that are meaningful on their own even without a device (helpers, presence, weather). */
const STANDALONE_PRIMARY = new Set(["scene", "script", "input_boolean", "input_number", "input_select", "person", "weather", "device_tracker", "automation"]);

/** Entities that are plumbing rather than something a person controls or reads at home. */
const SYSTEM_DOMAINS = new Set(["zone", "conversation", "tts", "stt", "notify", "todo", "calendar", "image_processing", "geo_location", "event"]);

const CONTROL_DOMAINS = new Set(["switch", "select", "number", "button", "text", "time", "datetime", "date", "input_text", "input_datetime", "input_button"]);

const DIAGNOSTIC_TOKENS = /\b(wi-?fi|rssi|signal|uptime|ip address|mac address|ssid|firmware|version|last seen|last boot|restart|reboot|identify|uptime|memory|cpu|free heap|connected)\b/i;
const FACET_TOKENS = /\b(shutter|privacy|muted|mute state|tamper|lid|cover open|door open|open state|occupied|presence|motion)\b/i;
const FACET_DEVICE_CLASSES = new Set(["tamper", "motion", "occupancy", "presence", "opening", "door", "window", "garage_door", "lock", "safety", "smoke", "moisture", "vibration", "sound", "running", "privacy"]);
const DIAGNOSTIC_DEVICE_CLASSES = new Set(["signal_strength", "timestamp", "duration", "data_size", "connectivity", "update", "firmware"]);

export interface RoleContext {
  /** The entity's cleaned name, for token matching. */
  name: string;
  /** Does its device already have an entity from PRIMARY_DOMAINS? */
  deviceHasPrimaryDomain: boolean;
  /** Is the entity attached to a physical/service device? */
  hasDevice: boolean;
}

/**
 * First-pass role from registry flags, device class, domain and (last resort) name tokens.
 * Promotion of a device's best entity to primary when it has no primary-class entity happens in the builder.
 */
export function classifyRole(e: InventoryEntity, ctx: RoleContext): RoleResult {
  if (e.entityCategory === "diagnostic") return { role: "diagnostic", reason: "entity_category=diagnostic" };
  if (e.entityCategory === "config") return { role: "config", reason: "entity_category=config" };
  if (SYSTEM_DOMAINS.has(e.domain)) return { role: "config", reason: `${e.domain} is plumbing, not a household item` };
  if (e.domain === "update") return { role: "diagnostic", reason: "update entity" };
  if (e.deviceClass && DIAGNOSTIC_DEVICE_CLASSES.has(e.deviceClass)) return { role: "diagnostic", reason: `device_class=${e.deviceClass}` };

  if ((PRIMARY_DOMAINS as readonly string[]).includes(e.domain)) return { role: "primary", reason: `${e.domain} domain` };
  if (!ctx.hasDevice && STANDALONE_PRIMARY.has(e.domain)) return { role: "primary", reason: `standalone ${e.domain}` };

  if (DIAGNOSTIC_TOKENS.test(ctx.name)) return { role: "diagnostic", reason: "name looks diagnostic" };

  if (e.domain === "binary_sensor") {
    if (e.deviceClass && FACET_DEVICE_CLASSES.has(e.deviceClass)) return { role: "facet", reason: `binary_sensor device_class=${e.deviceClass}` };
    if (FACET_TOKENS.test(ctx.name)) return { role: "facet", reason: "name looks like a state of the device" };
    return { role: "sensor", reason: "binary_sensor" };
  }
  if (e.domain === "sensor") return { role: "sensor", reason: "sensor domain" };

  if (CONTROL_DOMAINS.has(e.domain)) {
    // A switch on a device that has its own primary (mic mute on a speaker) is a control; alone (a plug) it is the device.
    return { role: "control", reason: ctx.deviceHasPrimaryDomain || e.domain !== "switch" ? `${e.domain} on a device with a primary` : "switch; may be promoted to primary" };
  }
  if (STANDALONE_PRIMARY.has(e.domain)) return { role: "control", reason: `${e.domain} on a device` };
  return { role: "sensor", reason: "no rule matched" };
}

/** When a device has no primary-class entity, which remaining entity best represents it? Lower is better. */
export function promotionRank(e: InventoryEntity): number {
  if (e.domain === "switch" || e.domain === "input_boolean") return 0;
  if (e.domain === "binary_sensor") return 1;
  if (e.domain === "sensor") return 2;
  if (e.domain === "number" || e.domain === "select" || e.domain === "button") return 3;
  return 9;
}

export const facetKey = (name: string): string => {
  const k = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (/shutter/.test(k)) return "privacy_shutter";
  if (/mute/.test(k)) return "mic_muted";
  return k || "state";
};
