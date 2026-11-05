import type { DeviceCapability } from "../capabilities/types";

export type EntityRole = "primary" | "control" | "facet" | "sensor" | "diagnostic" | "config";

export type ThingKind = "device" | "service" | "virtual";

export interface ThingEntity {
  entityId: string;
  domain: string;
  /** Cleaned name relative to its Thing, e.g. "Microphone mute". */
  name: string;
  role: EntityRole;
  deviceClass: string | null;
  /** Why the role was chosen; handy for the admin UI and for debugging heuristics. */
  roleReason: string;
  capabilities: DeviceCapability[];
}

/** One card per physical device (or helper/service). Structural only: live values come from the state cache. */
export interface Thing {
  id: string;
  kind: ThingKind;
  name: string;
  nameSource: "override" | "computed" | "source";
  sourceName: string;
  areaId: string | null;
  hidden: boolean;
  /** The main entity. Null only for Things made entirely of diagnostics/config. */
  primary: ThingEntity | null;
  /** Other primary-class entities on the same device, e.g. the camera of a smart display. */
  others: ThingEntity[];
  controls: ThingEntity[];
  /** Properties of the primary (shutter state, "muted"), never shown as their own items. */
  facets: (ThingEntity & { key: string; attachedTo: string | null })[];
  sensors: ThingEntity[];
  diagnostics: ThingEntity[];
  entityIds: string[];
  /** Thing that this one hangs off (hub/child), if any. */
  hubThingId: string | null;
  deviceIds: string[];
  aliases: string[];
  manufacturer: string | null;
  model: string | null;
}

/** User decisions that beat every automatic default. Backed by DB tables later; pure data here. */
export interface ThingOverrides {
  /** Keyed by a Thing ref: `device:<haDeviceId>` or `entity:<entityId>`. */
  things?: Record<string, { displayName?: string | null; hidden?: boolean; areaId?: string | null }>;
  entities?: Record<
    string,
    {
      role?: EntityRole;
      displayName?: string | null;
      attachTo?: string | null;
      hidden?: boolean;
      /** For facets whose polarity cannot be inferred: what the facet means when its state is "on" (e.g. "closed"). */
      onMeans?: string;
    }
  >;
  /** Merge Thing refs into the first ref of each group. */
  merges?: string[][];
  /** Move these entities out of their device's Thing into their own Thing. */
  splits?: string[];
}
