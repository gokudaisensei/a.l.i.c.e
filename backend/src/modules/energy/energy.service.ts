import { eq } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { households } from "@/core/database/schema";
import { AppError } from "@/core/errors/errors";
import type { Caller, DevicesService } from "../devices/devices.service";
import { powerLimitOf } from "../devices/settings";
import type { ThingView } from "../home-assistant/things/presentation";
import type { ThingsService } from "../home-assistant/things/things.service";
import type { HaStatisticsPeriod, HaStatisticsPoint } from "../home-assistant/types";
import { DAY, parseTime } from "../history/history.service";
import { timeOfDay } from "../insights/insights.service";

export const toWatts = (v: number, unit: unknown) => (unit === "kW" ? v * 1000 : unit === "MW" ? v * 1_000_000 : unit === "mW" ? v / 1000 : v);
export const toKwh = (v: number, unit: unknown) => (unit === "Wh" ? v / 1000 : unit === "MWh" ? v * 1000 : unit === "GJ" ? v * 277.778 : v);
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** Midnight at the start of today in a time zone, as milliseconds. */
export function startOfLocalDay(now: number, timezone: string): number {
  const label = timeOfDay(now, timezone).label; // e.g. "10:40 pm"
  const m = /^(\d{1,2}):(\d{2}) (am|pm)$/.exec(label)!;
  const minutes = (Number(m[1]) % 12 + (m[3] === "pm" ? 12 : 0)) * 60 + Number(m[2]);
  return now - minutes * 60_000 - (now % 60_000);
}

interface Meter {
  thing: ThingView;
  connectionId: string;
  powerSensor: string | null;
  energySensor: string | null;
  watts: number | null;
  unit: string | null;
}

export interface DeviceEnergy {
  thingId: string;
  name: string;
  watts: number | null;
  todayKwh: number | null;
  limitW: number | null;
  percentOfLimit: number | null;
}

/**
 * How much power the home is using and has used, from the power and energy sensors of the devices a person may see
 * (so a household total a member sees leaves out devices hidden from them). Consumption comes from Home Assistant's
 * long-term statistics; the live draw comes from the latest readings.
 */
export class EnergyService {
  constructor(private readonly db: Db, private readonly things: ThingsService, private readonly devices: DevicesService, private readonly now: () => number = Date.now) {}

  private timezone(householdId: string) {
    return this.db.select({ tz: households.timezone }).from(households).where(eq(households.id, householdId)).get()?.tz ?? "UTC";
  }

  /** The visible devices that have a power or an energy sensor. One sensor of each kind per device, to avoid counting a device twice. */
  private meters(c: Caller): Meter[] {
    const out: Meter[] = [];
    for (const view of this.devices.list(c)) {
      const found = this.things.find(c.householdId, view.id);
      if (!found) continue;
      const sensors = [view.primary, ...view.sensors].filter((e) => e !== null);
      const klass = (e: (typeof sensors)[number]) => (e.values.sensor as { deviceClass?: string } | undefined)?.deviceClass;
      const power = sensors.find((e) => klass(e) === "power");
      const energy = sensors.find((e) => klass(e) === "energy");
      if (!power && !energy) continue;
      const reading = power ? (power.values.sensor as { value?: unknown; unit?: unknown }) : null;
      out.push({
        thing: view, connectionId: found.conn.config.id, powerSensor: power?.entityId ?? null, energySensor: energy?.entityId ?? null,
        watts: reading && typeof reading.value === "number" ? round(toWatts(reading.value, reading.unit), 0) : null,
        unit: energy ? String((energy.values.sensor as { unit?: unknown }).unit ?? "kWh") : null,
      });
    }
    return out;
  }

  /** Energy used per period for these devices, converted to kWh. Empty when Home Assistant cannot be asked. */
  private async consumption(c: Caller, meters: Meter[], from: number, to: number, period: HaStatisticsPeriod): Promise<Map<string, HaStatisticsPoint[]> | null> {
    const wanted = meters.filter((m) => m.energySensor);
    if (!wanted.length) return new Map();
    const out = new Map<string, HaStatisticsPoint[]>();
    const byConn = new Map<string, Meter[]>();
    for (const m of wanted) byConn.set(m.connectionId, [...(byConn.get(m.connectionId) ?? []), m]);
    for (const [connectionId, ms] of byConn) {
      const conn = this.things.forHousehold(c.householdId).find((x) => x.conn.config.id === connectionId)?.conn;
      if (!conn || conn.status !== "connected") return null;
      try {
        const stats = await conn.gateway.getStatistics(ms.map((m) => m.energySensor!), from, to, period);
        for (const m of ms) out.set(m.thing.id, (stats[m.energySensor!] ?? []).map((p) => ({ ...p, change: p.change == null ? null : round(toKwh(p.change, m.unit), 4) })));
      } catch { return null; }
    }
    return out;
  }

  private sum(points: HaStatisticsPoint[] | undefined) {
    return round((points ?? []).reduce((a, p) => a + (p.change ?? 0), 0));
  }

  /** Current draw, today's use so far, and the biggest users today. */
  async summary(c: Caller) {
    const meters = this.meters(c);
    const now = this.now();
    const from = startOfLocalDay(now, this.timezone(c.householdId));
    const stats = await this.consumption(c, meters, from, now + 3_600_000, "hour");
    const perDevice = meters.map((m) => ({ thingId: m.thing.id, name: m.thing.name, watts: m.watts, todayKwh: stats ? this.sum(stats.get(m.thing.id)) : null }));
    const withStats = perDevice.filter((d) => d.todayKwh !== null && d.todayKwh > 0);
    return {
      nowWatts: round(meters.reduce((a, m) => a + (m.watts ?? 0), 0), 0),
      todayKwh: stats ? round(withStats.reduce((a, d) => a + d.todayKwh!, 0)) : null,
      since: from,
      statisticsAvailable: stats !== null,
      monitoredDevices: meters.length,
      topToday: withStats.sort((a, b) => b.todayKwh! - a.todayKwh!).slice(0, 3),
    };
  }

  /** Consumption over time, summed across the devices you may see, plus a line per device. */
  async history(c: Caller, o: { from?: string; to?: string; resolution?: "hour" | "day" }) {
    const resolution = o.resolution ?? "hour";
    const to = parseTime(o.to, this.now());
    const from = parseTime(o.from, to - (resolution === "hour" ? DAY : 30 * DAY));
    const maxSpan = resolution === "hour" ? 7 * DAY : 366 * DAY;
    if (from >= to) throw new AppError(400, "validation_error", "The start must be before the end");
    if (to - from > maxSpan) throw new AppError(400, "validation_error", resolution === "hour" ? "Hourly figures cover at most 7 days; ask for days instead" : "At most 366 days at a time");
    const meters = this.meters(c);
    const stats = await this.consumption(c, meters, from, to, resolution);
    if (!stats) throw new AppError(503, "ha_unreachable", "Home Assistant could not be asked for energy figures");
    const total = new Map<number, number>();
    for (const pts of stats.values()) for (const p of pts) total.set(p.start, round((total.get(p.start) ?? 0) + (p.change ?? 0), 4));
    return {
      from, to, resolution,
      totalKwh: round([...total.values()].reduce((a, b) => a + b, 0)),
      series: [...total.entries()].sort((a, b) => a[0] - b[0]).map(([start, kwh]) => ({ start, kwh })),
      devices: meters.filter((m) => m.energySensor).map((m) => ({ thingId: m.thing.id, name: m.thing.name, kwh: this.sum(stats.get(m.thing.id)), series: (stats.get(m.thing.id) ?? []).map((p) => ({ start: p.start, kwh: p.change ?? 0 })) })).sort((a, b) => b.kwh - a.kwh),
    };
  }

  /** Each device with a meter: draw now, use today, and where it is against its limit. */
  async deviceList(c: Caller): Promise<{ devices: DeviceEnergy[]; statisticsAvailable: boolean }> {
    const meters = this.meters(c);
    const now = this.now();
    const stats = await this.consumption(c, meters, startOfLocalDay(now, this.timezone(c.householdId)), now + 3_600_000, "hour");
    const devices = meters.map((m): DeviceEnergy => {
      const found = this.things.find(c.householdId, m.thing.id)!;
      const limit = powerLimitOf(this.db, m.connectionId, [...(found.thing.primary ? [found.thing.primary.entityId] : []), ...(m.powerSensor ? [m.powerSensor] : [])]);
      return { thingId: m.thing.id, name: m.thing.name, watts: m.watts, todayKwh: stats && m.energySensor ? this.sum(stats.get(m.thing.id)) : null, limitW: limit, percentOfLimit: limit && m.watts !== null ? Math.round((m.watts / limit) * 100) : null };
    });
    return { devices: devices.sort((a, b) => (b.todayKwh ?? -1) - (a.todayKwh ?? -1) || (b.watts ?? -1) - (a.watts ?? -1)), statisticsAvailable: stats !== null };
  }
}
