import type { Thing } from "./types";

export type TargetResult = { ok: true; entityId: string } | { ok: false; code: "unknown_thing" | "entity_not_in_thing" | "no_primary"; message: string };

/** Which entity does a request for a Thing mean? Defaults to the primary; an explicit entity must belong to the Thing. */
export function resolveThingTarget(things: Thing[], thingId: string, entityId?: string): TargetResult {
  const thing = things.find((t) => t.id === thingId);
  if (!thing) return { ok: false, code: "unknown_thing", message: `No such device: ${thingId}` };
  if (entityId) {
    return thing.entityIds.includes(entityId)
      ? { ok: true, entityId }
      : { ok: false, code: "entity_not_in_thing", message: `${entityId} does not belong to ${thing.name}` };
  }
  return thing.primary
    ? { ok: true, entityId: thing.primary.entityId }
    : { ok: false, code: "no_primary", message: `${thing.name} has nothing to control` };
}
