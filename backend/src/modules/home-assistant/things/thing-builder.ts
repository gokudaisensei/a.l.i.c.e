import { createHash } from "node:crypto";
import type { Inventory, InventoryDevice, InventoryEntity } from "../discovery/inventory";
import { buildAliases, cleanEntityName, cleanThingName } from "./name-cleaner";
import { classifyRole, facetKey, PRIMARY_DOMAINS, promotionRank } from "./role-classifier";
import type { EntityRole, Thing, ThingEntity, ThingKind, ThingOverrides } from "./types";

const deviceRef = (id: string) => `device:${id}`;
const entityRef = (id: string) => `entity:${id}`;
const thingId = (connectionId: string, ref: string) => "thing_" + createHash("sha1").update(`${connectionId}:${ref}`).digest("hex").slice(0, 16);

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p === x) return x;
    const r = this.find(p);
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const [ra, rb] = [this.find(a), this.find(b)];
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

const primaryRank = (e: InventoryEntity) => {
  const i = (PRIMARY_DOMAINS as readonly string[]).indexOf(e.domain);
  return i === -1 ? 99 : i;
};

/**
 * Pure: groups the inventory into Things (one per physical device), classifies entity roles,
 * cleans names and applies user overrides. No I/O; live values are joined from the state cache at read time.
 */
export function buildThings(inv: Inventory, connectionId: string, ov: ThingOverrides = {}): Thing[] {
  const areaName = new Map(inv.areas.map((a) => [a.areaId, a.name]));
  const deviceById = new Map(inv.devices.map((d) => [d.deviceId, d]));
  const split = new Set(ov.splits ?? []);

  // 1. Which Thing ref does each entity belong to?
  const refOf = (e: InventoryEntity) => (e.deviceId && deviceById.has(e.deviceId) && !split.has(e.entityId) ? deviceRef(e.deviceId) : entityRef(e.entityId));

  // 2. Union devices that are the same physical thing, then apply manual merges.
  const uf = new UnionFind();
  const byHardwareId = new Map<string, string>();
  for (const d of inv.devices) {
    uf.find(deviceRef(d.deviceId));
    for (const t of [...d.identifiers, ...d.connections]) {
      const key = t.join("\u0000");
      const seen = byHardwareId.get(key);
      if (seen) uf.union(seen, deviceRef(d.deviceId));
      else byHardwareId.set(key, deviceRef(d.deviceId));
    }
  }
  for (const group of ov.merges ?? []) for (const ref of group.slice(1)) uf.union(group[0]!, ref);
  // A merge keeps the id of its first member.
  const preferred = new Map<string, string>();
  for (const group of ov.merges ?? []) preferred.set(uf.find(group[0]!), group[0]!);

  // 3. Bucket entities by root.
  const buckets = new Map<string, InventoryEntity[]>();
  for (const e of inv.entities) {
    const root = uf.find(refOf(e));
    (buckets.get(root) ?? buckets.set(root, []).get(root)!).push(e);
  }
  const devicesByRoot = new Map<string, InventoryDevice[]>();
  for (const d of inv.devices) {
    const root = uf.find(deviceRef(d.deviceId));
    (devicesByRoot.get(root) ?? devicesByRoot.set(root, []).get(root)!).push(d);
    if (!buckets.has(root)) buckets.set(root, []); // device with no entities yet
  }
  const canonical = (root: string) => preferred.get(root) ?? root;

  const things: Thing[] = [];
  const rootOfDevice = new Map<string, string>();

  for (const [root, ents] of buckets) {
    const devices = devicesByRoot.get(root) ?? [];
    if (!ents.length) continue;
    for (const d of devices) rootOfDevice.set(d.deviceId, root);
    const ref = canonical(root);
    const mainDevice = devices[0] ?? null;
    const thingOv = ov.things?.[ref] ?? ov.things?.[root];

    // Area: override, then device area, then the primary's, then the most common entity area.
    const areaCounts = new Map<string, number>();
    for (const e of ents) if (e.areaId) areaCounts.set(e.areaId, (areaCounts.get(e.areaId) ?? 0) + 1);
    const commonArea = [...areaCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const areaId = thingOv?.areaId !== undefined ? thingOv.areaId : (mainDevice?.areaId ?? commonArea);
    const aName = areaId ? (areaName.get(areaId) ?? null) : null;

    // Names and first-pass roles.
    const deviceHasPrimaryDomain = ents.some((e) => (PRIMARY_DOMAINS as readonly string[]).includes(e.domain) && !e.entityCategory);
    const looseEntity = !mainDevice ? ents[0]! : null;
    const sourceName = mainDevice ? mainDevice.name : looseEntity!.sourceName;
    const computedName = mainDevice ? cleanThingName(mainDevice.name, aName) : cleanThingName(looseEntity!.sourceName, aName);

    type Row = { e: InventoryEntity; name: string | null; role: EntityRole; reason: string };
    const rows: Row[] = ents.map((e) => {
      const eo = ov.entities?.[e.entityId];
      const cleaned = cleanEntityName({ sourceName: e.sourceName, ownName: e.ownName, hasEntityName: e.hasEntityName, deviceName: mainDevice?.name ?? null, areaName: aName });
      const name = eo?.displayName ?? cleaned;
      const auto = classifyRole(e, { name: name ?? computedName, deviceHasPrimaryDomain, hasDevice: !!mainDevice });
      if (eo?.hidden) return { e, name, role: "diagnostic" as const, reason: "hidden by user" };
      return eo?.role ? { e, name, role: eo.role, reason: "set by user" } : { e, name, ...auto };
    });

    // Primary: best primary-class entity; otherwise promote the most representative remaining one.
    const primaries = rows.filter((r) => r.role === "primary").sort((a, b) => primaryRank(a.e) - primaryRank(b.e) || a.e.entityId.localeCompare(b.e.entityId));
    let primaryRow = primaries[0] ?? null;
    if (!primaryRow) {
      const candidates = rows
        .filter((r) => r.role === "control" || r.role === "sensor" || r.role === "facet")
        .sort((a, b) => promotionRank(a.e) - promotionRank(b.e) || a.e.entityId.localeCompare(b.e.entityId));
      primaryRow = candidates[0] ?? null;
      if (primaryRow) Object.assign(primaryRow, { role: "primary", reason: "promoted: best entity on a device with no primary-class entity" });
    }

    const toEntity = (r: Row): ThingEntity => ({
      entityId: r.e.entityId, domain: r.e.domain, name: r.name ?? computedName, role: r.role, deviceClass: r.e.deviceClass, roleReason: r.reason, capabilities: r.e.capabilities,
    });

    const nameOverride = thingOv?.displayName;
    const name = nameOverride ?? computedName;
    const kind: ThingKind = !devices.length ? "virtual" : devices.every((d) => d.entryType === "service") ? "service" : "device";
    const primary = primaryRow ? toEntity(primaryRow) : null;

    const facets = rows
      .filter((r) => r.role === "facet")
      .map((r) => ({ ...toEntity(r), key: facetKey(r.name ?? ""), attachedTo: ov.entities?.[r.e.entityId]?.attachTo ?? primary?.entityId ?? null }));

    things.push({
      id: thingId(connectionId, ref),
      kind,
      name,
      nameSource: nameOverride ? "override" : computedName === sourceName ? "source" : "computed",
      sourceName,
      areaId,
      hidden: thingOv?.hidden ?? !primary,
      primary,
      others: rows.filter((r) => r.role === "primary" && r !== primaryRow).map(toEntity),
      controls: rows.filter((r) => r.role === "control").map(toEntity),
      facets,
      sensors: rows.filter((r) => r.role === "sensor").map(toEntity),
      diagnostics: rows.filter((r) => r.role === "diagnostic" || r.role === "config").map(toEntity),
      entityIds: ents.map((e) => e.entityId),
      hubThingId: null,
      deviceIds: devices.map((d) => d.deviceId),
      aliases: buildAliases(name, aName, primaryRow?.e.domain ?? ""),
      manufacturer: mainDevice?.manufacturer ?? null,
      model: mainDevice?.model ?? null,
    });
  }

  // Hub/child links (a bridge and its bulbs stay separate Things but point at each other).
  const idOfRoot = new Map(things.map((t) => [t.deviceIds[0] ? uf.find(deviceRef(t.deviceIds[0])) : "", t.id]));
  for (const t of things) {
    const via = t.deviceIds.map((id) => deviceById.get(id)?.viaDeviceId).find(Boolean);
    const hubRoot = via && rootOfDevice.get(via);
    const hubId = hubRoot ? idOfRoot.get(hubRoot) : undefined;
    if (hubId && hubId !== t.id) t.hubThingId = hubId;
  }

  return things.sort((a, b) => a.name.localeCompare(b.name));
}
