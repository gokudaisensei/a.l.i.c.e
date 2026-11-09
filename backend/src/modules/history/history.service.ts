import { AppError, notFound } from "../../core/errors/errors";
import type { Caller, DevicesService } from "../devices/devices.service";
import { normalizeState, type NormalizedState } from "../home-assistant/capabilities/state-normalizer";
import { availabilityOf } from "../home-assistant/events/normalizer";
import type { ThingsService } from "../home-assistant/things/things.service";
import type { HaHistoryPoint } from "../home-assistant/types";

export const DAY = 24 * 3_600_000;
export const MAX_RANGE_MS = 31 * DAY;

export interface HistoryPoint {
  at: number;
  state: string;
  values: NormalizedState;
  availability: "available" | "unavailable" | "unknown";
}

export interface DeviceHistory {
  thingId: string;
  entityId: string;
  name: string;
  from: number;
  to: number;
  points: HistoryPoint[];
  /** How many points Home Assistant had before thinning, when it was thinned. */
  totalPoints: number;
  downsampled: boolean;
}

/**
 * Keeps at most `max` points: the first, and the last of each time slice, so the final state of every stretch survives and
 * nothing is invented. Order is preserved.
 */
export function downsample<T extends { at: number }>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const from = points[0]!.at;
  const span = points.at(-1)!.at - from || 1;
  const buckets = new Map<number, T>();
  for (const p of points) buckets.set(Math.min(max - 1, Math.floor(((p.at - from) / span) * max)), p); // later points replace earlier ones in a slice
  const out = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  if (out[0] !== points[0]) {
    out.unshift(points[0]!); // keep where it started...
    if (out.length > max) out.splice(1, 1); // ...at the cost of the first slice's own survivor, never the final state
  }
  return out;
}

/** Parses "2026-11-05T10:00:00Z" or epoch milliseconds. */
export function parseTime(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = /^\d{10,}$/.test(v) ? Number(v) : Date.parse(v);
  if (!Number.isFinite(n)) throw new AppError(400, "validation_error", `"${v}" is not a time`);
  return n;
}

export function parseRange(from: string | undefined, to: string | undefined, now: number): { from: number; to: number } {
  const end = parseTime(to, now);
  const start = parseTime(from, end - DAY);
  if (start >= end) throw new AppError(400, "validation_error", "The start must be before the end");
  if (end - start > MAX_RANGE_MS) throw new AppError(400, "validation_error", "At most 31 days at a time");
  return { from: start, to: end };
}

/** What a device was doing over time, from Home Assistant's recorder, for the devices a person may see. */
export class HistoryService {
  constructor(private readonly things: ThingsService, private readonly devices: DevicesService, private readonly now: () => number = Date.now) {}

  /** Which entities of this device the caller may look at, in the order they would expect (main entity first). */
  private allowed(c: Caller, thingId: string) {
    const v = this.devices.get(c, thingId); // 404 when the device is not theirs
    const ents = [v.primary, ...v.others, ...v.controls, ...v.sensors, ...v.facets.map((f) => ({ entityId: f.entityId, name: f.name }))].filter((e) => e !== null);
    return { view: v, ents: ents as { entityId: string; name: string }[] };
  }

  async device(c: Caller, thingId: string, o: { from?: string; to?: string; entityId?: string; maxPoints?: number }): Promise<DeviceHistory> {
    const { view, ents } = this.allowed(c, thingId);
    const target = o.entityId ? ents.find((e) => e.entityId === o.entityId) : ents[0];
    if (!target) throw o.entityId ? notFound("Entity") : new AppError(404, "not_found", "Nothing to show for this device");
    const range = parseRange(o.from, o.to, this.now());
    const found = this.things.find(c.householdId, thingId)!;
    if (found.conn.status !== "connected") throw new AppError(503, "ha_unreachable", "Home Assistant is not connected");
    const rows: HaHistoryPoint[] = (await found.conn.gateway.getHistory([target.entityId], range.from, range.to))[target.entityId] ?? [];
    const domain = target.entityId.split(".")[0] ?? "";
    const all = rows.map((r): HistoryPoint => ({ at: r.at, state: r.state, values: normalizeState(domain, r.state, r.attributes), availability: availabilityOf(r.state) }));
    const max = Math.min(Math.max(o.maxPoints ?? 300, 10), 1000);
    const points = downsample(all, max);
    return { thingId, entityId: target.entityId, name: target.entityId === view.primary?.entityId ? view.name : `${view.name} ${target.name}`, ...range, points, totalPoints: all.length, downsampled: points.length < all.length };
  }
}
