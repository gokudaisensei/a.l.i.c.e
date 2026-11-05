import type { NormalizedState } from "@/modules/home-assistant/capabilities/state-normalizer";
import type { DeviceCommand } from "@/modules/devices/commands/command-types";
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

export interface ConnectionConnectedEvent extends Scope {
  type: "connection.connected";
  status: ConnectionStatus;
}

export interface ConnectionDisconnectedEvent extends Scope {
  type: "connection.disconnected";
  status: ConnectionStatus;
  error?: string;
}

/** The set or shape of devices a person sees changed (rename, hide, merge, split, policy). Clients should refetch. */
export interface ThingsChangedEvent {
  type: "things.changed";
  householdId: string;
  connectionId: string | null;
  reason: "overrides" | "permissions";
  timestamp: string;
}

export interface CommandEvent {
  type: "command.created" | "command.authorized" | "command.dispatched" | "command.accepted" | "command.confirmed" | "command.failed" | "command.timed_out" | "command.cancelled";
  householdId: string;
  timestamp: string;
  command: DeviceCommand;
}

export type AppEvent =
  | CommandEvent
  | ThingsChangedEvent
  | EntityStateChangedEvent
  | EntityAvailabilityChangedEvent
  | EntityRemovedEvent
  | RegistryUpdatedEvent
  | InventorySyncedEvent
  | ConnectionConnectedEvent
  | ConnectionDisconnectedEvent;
