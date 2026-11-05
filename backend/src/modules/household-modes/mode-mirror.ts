import type { Logger } from "pino";
import { HOUSEHOLD_MODES } from "@/core/database/schema";
import type { AppEvent } from "@/core/events/app-events";
import type { EventBus, Unsubscribe } from "@/core/events/event-bus";
import { MODE_HELPER_ENTITY } from "../home-assistant/config-ops";
import type { ConfigJobService } from "../home-assistant/config-jobs.service";
import type { ConnectionManager, ManagedConnection } from "../home-assistant";
import type { ModesService } from "./modes.service";

export interface MirrorStatus {
  status: "active" | "waiting" | "unavailable";
  reason: string | null;
}

/**
 * Keeps the household mode and a Home Assistant helper (`input_select.alice_household_mode`) in step, both ways, so Home
 * Assistant automations can use the mode and a change made in Home Assistant reaches Alice. Alice is the source of truth
 * whenever they disagree on connect. The helper is created by the config-worker (it needs the admin token).
 */
export class ModeMirror {
  private unsubs: Unsubscribe[] = [];

  constructor(
    private readonly bus: EventBus<AppEvent>,
    private readonly manager: ConnectionManager,
    private readonly modes: ModesService,
    private readonly jobs: ConfigJobService,
    private readonly log: Logger,
  ) {}

  start() {
    this.unsubs.push(
      this.bus.subscribe("household.mode_changed", (e) => this.push(e.householdId, e.mode)),
      this.bus.subscribe("entity.state_changed", (e) => {
        if (e.entityId !== MODE_HELPER_ENTITY) return;
        if (e.previousState === null) return void this.push(e.householdId, this.modes.get(e.householdId).mode); // just created: Alice's mode wins over the helper's default
        if (!(HOUSEHOLD_MODES as readonly string[]).includes(e.currentState)) return;
        if (e.currentState !== this.modes.get(e.householdId).mode) this.modes.set(e.householdId, null, e.currentState); // changed in Home Assistant
      }),
      this.bus.subscribe("inventory.synced", (e) => this.reconcile(e.householdId)),
    );
  }

  stop() {
    for (const u of this.unsubs.splice(0)) u();
  }

  private helper(householdId: string): ManagedConnection | null {
    return this.manager.forHousehold(householdId).find((c) => c.status === "connected" && c.cache.get(MODE_HELPER_ENTITY)) ?? null;
  }

  private push(householdId: string, mode: string) {
    const conn = this.helper(householdId);
    if (!conn || conn.cache.get(MODE_HELPER_ENTITY)?.state === mode) return;
    conn.gateway.callService({ domain: "input_select", service: "select_option", data: { option: mode }, target: { entity_id: MODE_HELPER_ENTITY } })
      .catch((err) => this.log.warn({ err: String(err) }, "could not set the mode helper in Home Assistant"));
  }

  /** Makes the helper exist and agree with Alice. Safe to call any time. */
  reconcile(householdId: string) {
    if (this.helper(householdId)) { this.push(householdId, this.modes.get(householdId).mode); return; }
    const s = this.jobs.status(householdId);
    if (s.connected && s.adminTokenSet) this.jobs.enqueue(householdId, { op: "helper.ensure_mode_select", options: [...HOUSEHOLD_MODES] }, { dedupeKey: "helper:mode" });
  }

  status(householdId: string): MirrorStatus {
    if (this.helper(householdId)) return { status: "active", reason: null };
    const s = this.jobs.status(householdId);
    if (!s.connected) return { status: "unavailable", reason: "Home Assistant is not connected" };
    if (!s.adminTokenSet) return { status: "unavailable", reason: "Add a Home Assistant admin token so Home Assistant can use the household mode" };
    return { status: "waiting", reason: "Waiting for the config-worker to create the mode helper in Home Assistant" };
  }
}
