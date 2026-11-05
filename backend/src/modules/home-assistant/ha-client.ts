/** Contract the rest of the app uses to talk to Home Assistant. Implement with home-assistant-js-websocket (events/services) and fetch (REST). */
export interface HaEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
}

export interface HaClient {
  connect(): Promise<void>;
  disconnect(): void;
  getStates(): Promise<HaEntityState[]>;
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<void>;
  subscribeStateChanges(cb: (s: HaEntityState) => void): Promise<() => void>;
}
