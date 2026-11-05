import type { NormalizedState } from "@/modules/home-assistant/capabilities/state-normalizer";
import type { ConnectionStatus } from "@/modules/home-assistant/types";

export type Availability = "available" | "unavailable" | "unknown";

interface Scope {
  householdId: string;
  connectionId: string;
  timestamp: string;
}

export interface EntityStateChangedEvent extends Scope {
  type: "entity.state_changed";
  entityId: string;
  previousState: string | null;
  currentState: string;
  /** Raw HA attributes, kept for diagnostics and unmapped domains. */
  attributes: Record<string, unknown>;
  /** Application-level values keyed by capability name (e.g. brightness in %). Clients should use this. */
  normalized: NormalizedState;
  lastChanged: string;
  lastUpdated: string;
  context: { id: string; parentId: string | null; userId: string | null };
}

export interface EntityAvailabilityChangedEvent extends Scope {
  type: "entity.availability_changed";
  entityId: string;
  availability: Availability;
}

export interface EntityRemovedEvent extends Scope {
  type: "entity.removed";
  entityId: string;
}

export interface RegistryUpdatedEvent extends Scope {
  type: "registry.updated";
  registry: "area" | "device" | "entity";
}

export interface InventorySyncedEvent extends Scope {
  type: "inventory.synced";
  counts: { areas: number; devices: number; entities: number };
}

export interface ConnectionStatusEvent extends Scope {
  type: "connection.connected" | "connection.disconnected";
  status: ConnectionStatus;
  error?: string;
}

export type AppEvent =
  | EntityStateChangedEvent
  | EntityAvailabilityChangedEvent
  | EntityRemovedEvent
  | RegistryUpdatedEvent
  | InventorySyncedEvent
  | ConnectionStatusEvent;
