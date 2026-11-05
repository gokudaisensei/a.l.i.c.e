import type { Unsubscribe } from "@/core/events/event-bus";
import type {
  ConnectionStatus,
  HaAreaRegistryEntry,
  HaDeviceRegistryEntry,
  HaEntityRegistryEntry,
  HaEntityState,
  HaRawEvent,
  HaServiceCallInput,
  HaServiceCallResult,
  HaServices,
  HaStateChangedEvent,
} from "./types";

/**
 * The only surface other modules may use to reach Home Assistant.
 * Tests mock this; the real implementation lives in clients/ha-ws-gateway.ts.
 */
export interface HomeAssistantGateway {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): ConnectionStatus;
  onStatusChange(cb: (status: ConnectionStatus) => void): Unsubscribe;

  getStates(): Promise<HaEntityState[]>;
  getAreas(): Promise<HaAreaRegistryEntry[]>;
  getDevices(): Promise<HaDeviceRegistryEntry[]>;
  getEntityRegistry(): Promise<HaEntityRegistryEntry[]>;
  getServices(): Promise<HaServices>;
  getConfig(): Promise<{ version: string; location_name?: string }>;

  callService(input: HaServiceCallInput): Promise<HaServiceCallResult>;

  subscribeStateChanges(cb: (e: HaStateChangedEvent) => void): Promise<Unsubscribe>;
  subscribeEvents(eventType: string, cb: (e: HaRawEvent) => void): Promise<Unsubscribe>;
}

export interface HaConnectionConfig {
  id: string;
  householdId: string;
  baseUrl: string;
  /** Operational token only. The admin token is never given to this module. */
  token: string;
}
