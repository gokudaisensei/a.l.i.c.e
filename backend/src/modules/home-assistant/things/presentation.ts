import type { DeviceCapability } from "../capabilities/types";
import type { NormalizedState } from "../capabilities/state-normalizer";
import type { EntityProjection } from "../state/state-cache";
import { describeThingFacets, type FacetValue } from "./facet-values";
import type { EntityRole, Thing, ThingEntity, ThingOverrides } from "./types";

export interface EntityView {
  entityId: string;
  name: string;
  domain: string;
  role: EntityRole;
  availability: "available" | "unavailable" | "unknown";
  /** Application-level values (brightness in %, lock state, ...). Empty while unavailable. */
  values: NormalizedState;
  capabilities: DeviceCapability[];
}

export interface ThingView {
  id: string;
  name: string;
  nameSource: Thing["nameSource"];
  sourceName: string;
  kind: Thing["kind"];
  areaId: string | null;
  hidden: boolean;
  manufacturer: string | null;
  model: string | null;
  hubThingId: string | null;
  /** True when the primary (or, failing that, any entity) is reachable. */
  available: boolean;
  primary: EntityView | null;
  others: EntityView[];
  controls: EntityView[];
  facets: (FacetValue & { name: string })[];
  sensors: EntityView[];
  diagnosticCount: number;
  diagnostics?: EntityView[];
  /** Is this one of the caller's favorites? Filled in by the devices service. */
  favorite?: boolean;
  /** Application settings of the main entity. Filled in by the devices service. */
  settings?: { powerLimitW: number | null; voiceExposed: boolean; voiceSync: { status: "none" | "pending" | "synced" | "failed"; error: string | null } };
}

export interface PresentOptions {
  lookup: (entityId: string) => EntityProjection | undefined;
  /** Is the caller allowed to see this entity? Entities they cannot see are removed entirely. */
  canSee: (entityId: string) => boolean;
  overrides?: ThingOverrides;
  includeDiagnostics?: boolean;
}

const entityView = (e: ThingEntity, lookup: PresentOptions["lookup"]): EntityView => {
  const p = lookup(e.entityId);
  return { entityId: e.entityId, name: e.name, domain: e.domain, role: e.role, availability: p?.availability ?? "unknown", values: p?.normalized ?? {}, capabilities: e.capabilities };
};

/**
 * Joins a Thing with live state and removes everything the caller may not see.
 * Returns null when nothing is left, so the Thing does not exist as far as that caller can tell.
 */
export function presentThing(thing: Thing, o: PresentOptions): ThingView | null {
  const allowed = (e: ThingEntity) => o.canSee(e.entityId);
  const primary = thing.primary && allowed(thing.primary) ? thing.primary : null;
  const others = thing.others.filter(allowed);
  const controls = thing.controls.filter(allowed);
  const sensors = thing.sensors.filter(allowed);
  const facetEntities = thing.facets.filter(allowed);
  const diagnostics = thing.diagnostics.filter(allowed);
  const anyVisible = primary || others.length || controls.length || sensors.length || facetEntities.length;
  if (!anyVisible) return null;

  const names = new Map(thing.facets.map((f) => [f.entityId, f.name]));
  const facets = describeThingFacets({ ...thing, facets: facetEntities }, o.lookup, o.overrides).map((f) => ({ ...f, name: names.get(f.entityId) ?? f.key }));
  const main = primary ?? others[0] ?? controls[0] ?? null;
  const mainView = main ? entityView(main, o.lookup) : null;

  return {
    id: thing.id, name: thing.name, nameSource: thing.nameSource, sourceName: thing.sourceName, kind: thing.kind, areaId: thing.areaId, hidden: thing.hidden,
    manufacturer: thing.manufacturer, model: thing.model, hubThingId: thing.hubThingId,
    available: mainView ? mainView.availability !== "unavailable" : false,
    primary: primary ? entityView(primary, o.lookup) : null,
    others: others.map((e) => entityView(e, o.lookup)),
    controls: controls.map((e) => entityView(e, o.lookup)),
    facets,
    sensors: sensors.map((e) => entityView(e, o.lookup)),
    diagnosticCount: diagnostics.length,
    ...(o.includeDiagnostics ? { diagnostics: diagnostics.map((e) => entityView(e, o.lookup)) } : {}),
  };
}

/** Free-text match on the name and aliases; every word must appear. */
export function matchesQuery(thing: Thing, q: string): boolean {
  const hay = `${thing.name} ${thing.aliases.join(" ")}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
