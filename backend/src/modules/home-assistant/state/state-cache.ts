import type { Availability } from "@/core/events/app-events";
import { normalizeState, type NormalizedState } from "../capabilities/state-normalizer";
import { availabilityOf } from "../events/normalizer";
import type { HaEntityState } from "../types";

/** Latest known state of an entity. A disposable projection: Home Assistant stays authoritative. */
export interface EntityProjection {
  entityId: string;
  domain: string;
  state: string;
  attributes: Record<string, unknown>;
  normalized: NormalizedState;
  lastChanged: string;
  lastUpdated: string;
  availability: Availability;
  lastSyncedAt: string;
}

export const domainOf = (entityId: string) => entityId.split(".")[0] ?? "";

export class StateCache {
  private map = new Map<string, EntityProjection>();

  private project(s: HaEntityState, at: string): EntityProjection {
    return {
      entityId: s.entity_id,
      domain: domainOf(s.entity_id),
      state: s.state,
      attributes: s.attributes,
      normalized: normalizeState(domainOf(s.entity_id), s.state, s.attributes),
      lastChanged: s.last_changed,
      lastUpdated: s.last_updated,
      availability: availabilityOf(s.state),
      lastSyncedAt: at,
    };
  }

  /** Replace everything (initial load or reconciliation after a reconnect). */
  replaceAll(states: HaEntityState[], at = new Date().toISOString()) {
    this.map = new Map(states.map((s) => [s.entity_id, this.project(s, at)]));
  }

  apply(state: HaEntityState | null, entityId: string, at = new Date().toISOString()) {
    if (!state) this.map.delete(entityId);
    else this.map.set(entityId, this.project(state, at));
  }

  get(entityId: string) {
    return this.map.get(entityId);
  }

  list(filter?: (e: EntityProjection) => boolean) {
    const all = [...this.map.values()];
    return filter ? all.filter(filter) : all;
  }

  get size() {
    return this.map.size;
  }
}
