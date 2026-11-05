import type { Logger } from "pino";
import type { AppEvent } from "@/core/events/app-events";
import type { EventBus } from "@/core/events/event-bus";
import type { HaConnectionConfig, HomeAssistantGateway } from "../gateway";
import { ManagedConnection } from "./managed-connection";

export type GatewayFactory = (config: HaConnectionConfig) => HomeAssistantGateway;

/** Owns every HA connection in the process. Each connection has an independent lifecycle. */
export class ConnectionManager {
  private conns = new Map<string, ManagedConnection>();

  constructor(
    private readonly createGateway: GatewayFactory,
    private readonly bus: EventBus<AppEvent>,
    private readonly log: Logger,
  ) {}

  /** Registers and starts a connection. Resolves after first sync, rejects on a rejected token. */
  async add(config: HaConnectionConfig): Promise<ManagedConnection> {
    if (this.conns.has(config.id)) throw new Error(`Connection ${config.id} already exists`);
    const conn = new ManagedConnection(config, this.createGateway(config), this.bus, this.log);
    this.conns.set(config.id, conn);
    await conn.start();
    return conn;
  }

  /** Registers and starts without waiting; failures are logged and retried by the connection. */
  addInBackground(config: HaConnectionConfig): ManagedConnection {
    const conn = new ManagedConnection(config, this.createGateway(config), this.bus, this.log);
    this.conns.set(config.id, conn);
    conn.start().catch((err) => this.log.error({ connectionId: config.id, err: String(err) }, "HA connection not started"));
    return conn;
  }

  get(id: string) {
    return this.conns.get(id);
  }

  forHousehold(householdId: string) {
    return [...this.conns.values()].filter((c) => c.config.householdId === householdId);
  }

  statuses() {
    return [...this.conns.values()].map((c) => ({
      id: c.config.id, householdId: c.config.householdId, status: c.status, lastError: c.lastError,
      entities: c.cache.size, syncedAt: c.inventory?.syncedAt ?? null,
    }));
  }

  async remove(id: string) {
    const c = this.conns.get(id);
    if (!c) return;
    await c.stop();
    this.conns.delete(id);
  }

  async stopAll() {
    await Promise.all([...this.conns.keys()].map((id) => this.remove(id)));
  }
}
