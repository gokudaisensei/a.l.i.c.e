/** Raw shapes from Home Assistant, as far as the backend cares. */
export interface HaContext {
  id: string;
  parent_id: string | null;
  user_id: string | null;
}

export interface HaEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context: HaContext;
}

export interface HaAreaRegistryEntry {
  area_id: string;
  name: string;
  floor_id?: string | null;
  aliases?: string[];
}

export interface HaDeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user?: string | null;
  area_id: string | null;
  manufacturer: string | null;
  model: string | null;
  disabled_by?: string | null;
  via_device_id?: string | null;
  /** [integration, id] tuples, e.g. ["esphome", "abc"]. */
  identifiers?: [string, string][];
  /** [type, value] tuples, e.g. ["mac", "aa:bb:cc:dd:ee:ff"]. */
  connections?: [string, string][];
  /** "service" for non-physical devices such as Sun or Weather. */
  entry_type?: string | null;
}

export interface HaEntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  area_id: string | null;
  platform: string;
  name?: string | null;
  original_name?: string | null;
  disabled_by?: string | null;
  hidden_by?: string | null;
  entity_category?: "config" | "diagnostic" | null;
  has_entity_name?: boolean;
  translation_key?: string | null;
}

export type HaServices = Record<string, Record<string, { name?: string; description?: string; fields?: Record<string, unknown> }>>;

export interface HaRawEvent {
  event_type: string;
  data: Record<string, any>;
  time_fired: string;
  context: HaContext;
}

export interface HaStateChangedEvent {
  entity_id: string;
  old_state: HaEntityState | null;
  new_state: HaEntityState | null;
  context: HaContext;
  timeFired: string;
}

export interface HaServiceCallInput {
  domain: string;
  service: string;
  data?: Record<string, unknown>;
  target?: { entity_id?: string | string[]; device_id?: string | string[]; area_id?: string | string[] };
}

export interface HaServiceCallResult {
  contextId: string;
  response?: unknown;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "auth_failed";
