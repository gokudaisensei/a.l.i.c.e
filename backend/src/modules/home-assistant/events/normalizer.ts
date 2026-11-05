import type { AppEvent, Availability } from "@/core/events/app-events";
import { normalizeState } from "../capabilities/state-normalizer";
import type { HaRawEvent, HaStateChangedEvent } from "../types";

export interface EventScope {
  householdId: string;
  connectionId: string;
}

export const availabilityOf = (state: string): Availability =>
  state === "unavailable" ? "unavailable" : state === "unknown" ? "unknown" : "available";

/** Converts a raw HA state_changed into application events. */
export function normalizeStateChanged(scope: EventScope, ev: HaStateChangedEvent): AppEvent[] {
  const base = { ...scope, timestamp: ev.timeFired };
  if (!ev.new_state) return [{ type: "entity.removed", ...base, entityId: ev.entity_id }];

  const out: AppEvent[] = [];
  const next = ev.new_state;
  // State changes and attribute-only updates (e.g. brightness) are both updates for clients.
  out.push({
    type: "entity.state_changed",
    ...base,
    entityId: ev.entity_id,
    previousState: ev.old_state?.state ?? null,
    currentState: next.state,
    attributes: next.attributes,
    normalized: normalizeState(ev.entity_id.split(".")[0] ?? "", next.state, next.attributes),
    lastChanged: next.last_changed,
    lastUpdated: next.last_updated,
    context: { id: ev.context.id, parentId: ev.context.parent_id, userId: ev.context.user_id },
  });
  const before = ev.old_state ? availabilityOf(ev.old_state.state) : null;
  const after = availabilityOf(next.state);
  if (before !== null && before !== after) {
    out.push({ type: "entity.availability_changed", ...base, entityId: ev.entity_id, availability: after });
  }
  return out;
}

const REGISTRY_EVENTS: Record<string, "area" | "device" | "entity"> = {
  area_registry_updated: "area",
  device_registry_updated: "device",
  entity_registry_updated: "entity",
};

export function normalizeRegistryEvent(scope: EventScope, ev: HaRawEvent): AppEvent | null {
  const registry = REGISTRY_EVENTS[ev.event_type];
  return registry ? { type: "registry.updated", ...scope, timestamp: ev.time_fired, registry } : null;
}

export const REGISTRY_EVENT_TYPES = Object.keys(REGISTRY_EVENTS);

/** `alice_notification` events come from Alice's own automations; the payload is untrusted text and is bounded here. */
export function normalizeAliceNotification(scope: EventScope, ev: HaRawEvent): AppEvent | null {
  if (ev.event_type !== "alice_notification") return null;
  const d = ev.data ?? {};
  const message = typeof d.message === "string" ? d.message.slice(0, 500) : "";
  if (!message) return null;
  const title = typeof d.title === "string" && d.title ? d.title.slice(0, 100) : "Home";
  const userIds = Array.isArray(d.userIds) ? d.userIds.filter((x): x is string => typeof x === "string").slice(0, 50) : null;
  return { type: "ha.notification", ...scope, timestamp: ev.time_fired, title, message, userIds };
}

export function normalizeAutomationTriggered(scope: EventScope, ev: HaRawEvent): AppEvent | null {
  if (ev.event_type !== "automation_triggered") return null;
  const entityId = ev.data?.entity_id;
  if (typeof entityId !== "string") return null;
  return { type: "ha.automation_triggered", ...scope, timestamp: ev.time_fired, entityId, source: typeof ev.data?.source === "string" ? ev.data.source : null };
}
