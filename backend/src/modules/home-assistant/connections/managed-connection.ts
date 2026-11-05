import type { Logger } from "pino";
import type { AppEvent } from "@/core/events/app-events";
import type { EventBus, Unsubscribe } from "@/core/events/event-bus";
import { HaAuthError } from "../clients/ha-ws-gateway";
import { discover } from "../discovery/discovery";
import type { Inventory } from "../discovery/inventory";
import { normalizeAliceNotification, normalizeAutomationTriggered, normalizeRegistryEvent, normalizeStateChanged, REGISTRY_EVENT_TYPES } from "../events/normalizer";
import type { HaConnectionConfig, HomeAssistantGateway } from "../gateway";
import { StateCache } from "../state/state-cache";
import type { ConnectionStatus } from "../types";
import { Backoff } from "./backoff";

const RESYNC_DEBOUNCE_MS = 500;

/**
 * One Home Assistant connection: connects with backoff, discovers the inventory,
 * keeps the state cache current, republishes events, and re-syncs after reconnects.
 */
export class ManagedConnection {
  readonly cache = new StateCache();
  inventory: Inventory | null = null;
  lastError: string | null = null;
  haVersion: string | null = null;

  private stopped = false;
  private ready = false;
  private unsubs: Unsubscribe[] = [];
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private wake: (() => void) | null = null;

  constructor(
    readonly config: HaConnectionConfig,
    readonly gateway: HomeAssistantGateway,
    private readonly bus: EventBus<AppEvent>,
    private readonly log: Logger,
    private readonly backoff = new Backoff(),
  ) {}

  get status(): ConnectionStatus {
    return this.gateway.status();
  }

  private scope() {
    return { householdId: this.config.householdId, connectionId: this.config.id, timestamp: new Date().toISOString() };
  }

  /** Resolves after the first successful connect and sync. Rejects if the token is rejected. Retries other failures forever. */
  async start(): Promise<void> {
    this.stopped = false;
    this.unsubs.push(this.gateway.onStatusChange((s) => this.onStatus(s)));

    while (!this.stopped) {
      try {
        await this.gateway.connect();
        break;
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        this.bus.publish({ type: "connection.disconnected", ...this.scope(), status: this.gateway.status(), error: this.lastError });
        if (err instanceof HaAuthError) throw err; // retrying cannot fix a bad token
        const delay = this.backoff.next();
        this.log.warn({ connectionId: this.config.id, delay, err: this.lastError }, "HA connect failed, retrying");
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, delay);
          this.wake = () => { clearTimeout(t); resolve(); };
        });
      }
    }
    if (this.stopped) return;

    this.backoff.reset();
    this.lastError = null;
    await this.subscribe();
    await this.subscribeAliceEvents();
    await this.sync();
    this.ready = true;
    this.bus.publish({ type: "connection.connected", ...this.scope(), status: "connected" });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    this.wake?.();
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    for (const u of this.unsubs.splice(0)) u();
    await this.gateway.disconnect();
  }

  private async subscribe() {
    this.unsubs.push(
      await this.gateway.subscribeStateChanges((ev) => {
        this.cache.apply(ev.new_state, ev.entity_id);
        for (const e of normalizeStateChanged(this.scope(), ev)) this.bus.publish(e);
      }),
    );
    for (const type of REGISTRY_EVENT_TYPES) {
      this.unsubs.push(
        await this.gateway.subscribeEvents(type, (raw) => {
          const e = normalizeRegistryEvent(this.scope(), raw);
          if (e) this.bus.publish(e);
          this.scheduleResync();
        }),
      );
    }
  }

  private async subscribeAliceEvents() {
    for (const [type, normalize] of [["alice_notification", normalizeAliceNotification], ["automation_triggered", normalizeAutomationTriggered]] as const) {
      this.unsubs.push(await this.gateway.subscribeEvents(type, (raw) => {
        const e = normalize({ householdId: this.config.householdId, connectionId: this.config.id }, raw);
        if (e) this.bus.publish(e);
      }));
    }
  }

  private scheduleResync() {
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.resyncTimer = setTimeout(() => void this.sync().catch((err) => this.log.error({ err }, "resync failed")), RESYNC_DEBOUNCE_MS);
  }

  /** Full reconciliation from HA: registries, states, services. */
  async sync(): Promise<void> {
    const { inventory, states } = await discover(this.gateway);
    this.inventory = inventory;
    this.cache.replaceAll(states);
    this.haVersion = await this.gateway.getConfig().then((c) => c.version, () => this.haVersion);
    this.bus.publish({
      type: "inventory.synced",
      ...this.scope(),
      counts: { areas: inventory.areas.length, devices: inventory.devices.length, entities: inventory.entities.length },
    });
    this.log.info({ connectionId: this.config.id, entities: inventory.entities.length }, "HA inventory synced");
  }

  private onStatus(s: ConnectionStatus) {
    if (!this.ready) return; // initial connect is handled in start()
    if (s === "reconnecting") {
      this.bus.publish({ type: "connection.disconnected", ...this.scope(), status: s });
    } else if (s === "connected") {
      // The library resubscribes events itself; we reconcile whatever changed while offline.
      void this.sync()
        .then(() => this.bus.publish({ type: "connection.connected", ...this.scope(), status: s }))
        .catch((err) => this.log.error({ err }, "post-reconnect sync failed"));
    }
  }
}
