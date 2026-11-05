import { detectCapabilities } from "../capabilities/capability-detector";
import type { DeviceCapability } from "../capabilities/types";
import { domainOf } from "../state/state-cache";
import type {
  HaAreaRegistryEntry,
  HaDeviceRegistryEntry,
  HaEntityRegistryEntry,
  HaEntityState,
  HaServices,
} from "../types";

export interface InventoryArea {
  areaId: string;
  name: string;
}
export interface InventoryDevice {
  deviceId: string;
  name: string;
  areaId: string | null;
  manufacturer: string | null;
  model: string | null;
  viaDeviceId: string | null;
  identifiers: [string, string][];
  connections: [string, string][];
  entryType: string | null;
}
export interface InventoryEntity {
  entityId: string;
  domain: string;
  name: string;
  deviceId: string | null;
  areaId: string | null;
  platform: string | null;
  /** HA's `friendly_name` as shown in states; the noisy source name. */
  sourceName: string;
  /** The entity's own name part when `hasEntityName` (HA prefixes it with the device name). */
  ownName: string | null;
  hasEntityName: boolean;
  entityCategory: "config" | "diagnostic" | null;
  deviceClass: string | null;
  translationKey: string | null;
  capabilities: DeviceCapability[];
}
export interface Inventory {
  areas: InventoryArea[];
  devices: InventoryDevice[];
  entities: InventoryEntity[];
  services: HaServices;
  syncedAt: string;
}

export interface RawDiscovery {
  areas: HaAreaRegistryEntry[];
  devices: HaDeviceRegistryEntry[];
  entityRegistry: HaEntityRegistryEntry[];
  states: HaEntityState[];
  services: HaServices;
}

/** Pure: merges the registries and current states into our inventory. Disabled/hidden entities are dropped. */
export function buildInventory(raw: RawDiscovery, at = new Date().toISOString()): Inventory {
  const devices = raw.devices.filter((d) => !d.disabled_by);
  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const regById = new Map(raw.entityRegistry.map((e) => [e.entity_id, e]));

  const entities: InventoryEntity[] = [];
  for (const s of raw.states) {
    const reg = regById.get(s.entity_id);
    if (reg?.disabled_by || reg?.hidden_by) continue;
    const device = reg?.device_id ? deviceById.get(reg.device_id) : undefined;
    const domain = domainOf(s.entity_id);
    entities.push({
      entityId: s.entity_id,
      domain,
      name: (s.attributes.friendly_name as string | undefined) ?? reg?.name ?? reg?.original_name ?? s.entity_id,
      sourceName: (s.attributes.friendly_name as string | undefined) ?? reg?.name ?? reg?.original_name ?? s.entity_id,
      ownName: reg?.name ?? reg?.original_name ?? null,
      hasEntityName: reg?.has_entity_name ?? false,
      entityCategory: reg?.entity_category ?? null,
      deviceClass: typeof s.attributes.device_class === "string" ? s.attributes.device_class : null,
      translationKey: reg?.translation_key ?? null,
      deviceId: reg?.device_id ?? null,
      areaId: reg?.area_id ?? device?.area_id ?? null,
      platform: reg?.platform ?? null,
      capabilities: detectCapabilities({ entityId: s.entity_id, domain, attributes: s.attributes }),
    });
  }

  return {
    areas: raw.areas.map((a) => ({ areaId: a.area_id, name: a.name })),
    devices: devices.map((d) => ({
      deviceId: d.id,
      name: d.name_by_user ?? d.name ?? d.id,
      areaId: d.area_id,
      manufacturer: d.manufacturer,
      model: d.model,
      viaDeviceId: d.via_device_id ?? null,
      identifiers: d.identifiers ?? [],
      connections: d.connections ?? [],
      entryType: d.entry_type ?? null,
    })),
    entities,
    services: raw.services,
    syncedAt: at,
  };
}
