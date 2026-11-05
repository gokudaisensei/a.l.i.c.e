import type { Unsubscribe } from "@/core/events/event-bus";
import type { HomeAssistantGateway } from "./gateway";
import type {
  ConnectionStatus,
  HaAreaRegistryEntry,
  HaDeviceRegistryEntry,
  HaEntityRegistryEntry,
  HaEntityState,
  HaRawEvent,
  HaServiceCallInput,
  HaStateChangedEvent,
} from "./types";

export const state = (entity_id: string, s: string, attributes: Record<string, unknown> = {}): HaEntityState => ({
  entity_id, state: s, attributes,
  last_changed: "2026-01-01T00:00:00Z", last_updated: "2026-01-01T00:00:00Z",
  context: { id: "ctx", parent_id: null, user_id: null },
});

/** In-memory gateway for unit tests. */
export class FakeGateway implements HomeAssistantGateway {
  _status: ConnectionStatus = "disconnected";
  states: HaEntityState[] = [];
  areas: HaAreaRegistryEntry[] = [];
  devices: HaDeviceRegistryEntry[] = [];
  entityRegistry: HaEntityRegistryEntry[] = [];
  calls: HaServiceCallInput[] = [];
  connectFailures: Error[] = [];
  connectAttempts = 0;
  /** Simulates HA reacting to a service call (emit state changes, throw to simulate a rejection). */
  onCallService?: (input: HaServiceCallInput) => void | Promise<void>;
  private statusCbs = new Set<(s: ConnectionStatus) => void>();
  private stateCbs = new Set<(e: HaStateChangedEvent) => void>();
  private eventCbs = new Map<string, Set<(e: HaRawEvent) => void>>();

  status() { return this._status; }
  onStatusChange(cb: (s: ConnectionStatus) => void): Unsubscribe { this.statusCbs.add(cb); return () => this.statusCbs.delete(cb); }
  setStatus(s: ConnectionStatus) { this._status = s; this.statusCbs.forEach((c) => c(s)); }

  async connect() {
    this.connectAttempts++;
    const fail = this.connectFailures.shift();
    if (fail) { this.setStatus("disconnected"); throw fail; }
    this.setStatus("connected");
  }
  async disconnect() { this.setStatus("disconnected"); }
  async getStates() { return this.states; }
  async getAreas() { return this.areas; }
  async getDevices() { return this.devices; }
  async getEntityRegistry() { return this.entityRegistry; }
  async getServices() { return {}; }
  async getConfig() { return { version: "2026.10.4", location_name: "Fake Home" }; }
  async callService(input: HaServiceCallInput) { this.calls.push(input); await this.onCallService?.(input); return { contextId: `ctx-${this.calls.length}` }; }
  async subscribeStateChanges(cb: (e: HaStateChangedEvent) => void) { this.stateCbs.add(cb); return () => this.stateCbs.delete(cb); }
  async subscribeEvents(type: string, cb: (e: HaRawEvent) => void) {
    const set = this.eventCbs.get(type) ?? new Set(); set.add(cb); this.eventCbs.set(type, set);
    return () => set.delete(cb);
  }

  emitState(next: HaEntityState | null, prev: HaEntityState | null = null, entityId = next?.entity_id ?? prev!.entity_id) {
    this.stateCbs.forEach((c) => c({ entity_id: entityId, old_state: prev, new_state: next, context: { id: "c", parent_id: null, user_id: null }, timeFired: "2026-01-01T00:00:01Z" }));
  }
  emitEvent(type: string, data: Record<string, unknown> = {}) {
    this.eventCbs.get(type)?.forEach((c) => c({ event_type: type, data, time_fired: "2026-01-01T00:00:01Z", context: { id: "c", parent_id: null, user_id: null } }));
  }
}
