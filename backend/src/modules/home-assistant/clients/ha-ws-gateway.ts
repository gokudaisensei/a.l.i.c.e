import {
  createConnection,
  createLongLivedTokenAuth,
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  type Connection,
} from "home-assistant-js-websocket";
import type { Unsubscribe } from "../../../core/events/event-bus";
import type { HaConnectionConfig, HomeAssistantGateway } from "../gateway";
import type {
  ConnectionStatus,
  HaAreaRegistryEntry,
  HaDeviceRegistryEntry,
  HaEntityRegistryEntry,
  HaEntityState,
  HaHistoryPoint,
  HaStatisticsPeriod,
  HaStatisticsPoint,
  HaRawEvent,
  HaServiceCallInput,
  HaServiceCallResult,
  HaServices,
  HaStateChangedEvent,
} from "../types";

export class HaAuthError extends Error {
  constructor() {
    super("Home Assistant rejected the access token");
  }
}

/** Gateway backed by home-assistant-js-websocket (which handles reconnect after the first successful connect). */
export class HaWebSocketGateway implements HomeAssistantGateway {
  private conn: Connection | null = null;
  private _status: ConnectionStatus = "disconnected";
  private listeners = new Set<(s: ConnectionStatus) => void>();

  constructor(private readonly config: Pick<HaConnectionConfig, "baseUrl" | "token">) {}

  status() {
    return this._status;
  }

  onStatusChange(cb: (s: ConnectionStatus) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setStatus(s: ConnectionStatus) {
    if (s === this._status) return;
    this._status = s;
    for (const l of this.listeners) l(s);
  }

  async connect(): Promise<void> {
    if (this.conn) return;
    this.setStatus("connecting");
    try {
      const auth = createLongLivedTokenAuth(this.config.baseUrl, this.config.token);
      const conn = await createConnection({ auth });
      conn.addEventListener("disconnected", () => this.setStatus("reconnecting"));
      conn.addEventListener("ready", () => this.setStatus("connected"));
      this.conn = conn;
      this.setStatus("connected");
    } catch (err) {
      if (err === ERR_INVALID_AUTH) {
        this.setStatus("auth_failed");
        throw new HaAuthError();
      }
      this.setStatus("disconnected");
      throw new Error(err === ERR_CANNOT_CONNECT ? "Cannot connect to Home Assistant" : `Connection error: ${String(err)}`);
    }
  }

  async disconnect(): Promise<void> {
    this.conn?.close();
    this.conn = null;
    this.setStatus("disconnected");
  }

  private get c(): Connection {
    if (!this.conn) throw new Error("Not connected to Home Assistant");
    return this.conn;
  }

  getStates() {
    return this.c.sendMessagePromise<HaEntityState[]>({ type: "get_states" });
  }
  getAreas() {
    return this.c.sendMessagePromise<HaAreaRegistryEntry[]>({ type: "config/area_registry/list" });
  }
  getDevices() {
    return this.c.sendMessagePromise<HaDeviceRegistryEntry[]>({ type: "config/device_registry/list" });
  }
  getEntityRegistry() {
    return this.c.sendMessagePromise<HaEntityRegistryEntry[]>({ type: "config/entity_registry/list" });
  }
  getServices() {
    return this.c.sendMessagePromise<HaServices>({ type: "get_services" });
  }

  getConfig() {
    return this.c.sendMessagePromise<{ version: string; location_name?: string }>({ type: "get_config" });
  }

  async getHistory(entityIds: string[], from: number, to: number): Promise<Record<string, HaHistoryPoint[]>> {
    const raw = await this.c.sendMessagePromise<Record<string, { s: string; a?: Record<string, unknown>; lu?: number; lc?: number }[]>>({
      type: "history/history_during_period", start_time: new Date(from).toISOString(), end_time: new Date(to).toISOString(), entity_ids: entityIds,
      include_start_time_state: true, significant_changes_only: false, minimal_response: false, no_attributes: false,
    });
    const out: Record<string, HaHistoryPoint[]> = {};
    for (const [id, rows] of Object.entries(raw)) {
      let last: Record<string, unknown> = {};
      out[id] = rows.map((r) => {
        if (r.a) last = r.a; // attributes are only sent when they change
        return { at: Math.round((r.lu ?? r.lc ?? from / 1000) * 1000), state: r.s, attributes: last };
      });
    }
    return out;
  }

  async getStatistics(entityIds: string[], from: number, to: number, period: HaStatisticsPeriod): Promise<Record<string, HaStatisticsPoint[]>> {
    return this.c.sendMessagePromise<Record<string, HaStatisticsPoint[]>>({
      type: "recorder/statistics_during_period", start_time: new Date(from).toISOString(), end_time: new Date(to).toISOString(),
      statistic_ids: entityIds, period, types: ["change", "mean", "min", "max", "sum"],
    });
  }

  async callService(input: HaServiceCallInput): Promise<HaServiceCallResult> {
    const res = await this.c.sendMessagePromise<{ context: { id: string }; response?: unknown }>({
      type: "call_service",
      domain: input.domain,
      service: input.service,
      service_data: input.data,
      target: input.target,
    });
    return { contextId: res.context.id, response: res.response };
  }

  async subscribeStateChanges(cb: (e: HaStateChangedEvent) => void): Promise<Unsubscribe> {
    return this.subscribeEvents("state_changed", (ev) =>
      cb({
        entity_id: ev.data.entity_id,
        old_state: ev.data.old_state ?? null,
        new_state: ev.data.new_state ?? null,
        context: ev.context,
        timeFired: ev.time_fired,
      }),
    );
  }

  async subscribeEvents(eventType: string, cb: (e: HaRawEvent) => void): Promise<Unsubscribe> {
    // The library re-subscribes automatically after a reconnect.
    return this.c.subscribeEvents<HaRawEvent>(cb, eventType);
  }
}
