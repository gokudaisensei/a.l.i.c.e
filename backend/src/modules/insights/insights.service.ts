import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { households, type HouseholdMode, insightDismissals } from "@/core/database/schema";
import { notFound } from "@/core/errors/errors";
import type { AppEvent } from "@/core/events/app-events";
import type { EventBus, Unsubscribe } from "@/core/events/event-bus";
import type { ThingsService } from "../home-assistant/things/things.service";
import type { ModesService } from "../household-modes/modes.service";
import type { PresenceService } from "../households/presence.service";

export type TimeOfDay = "morning" | "day" | "evening" | "night";

export interface Insight {
  id: string;
  kind: "mode_suggestion";
  title: string;
  reason: string;
  action: { type: "set_mode"; mode: HouseholdMode };
  /** Used to remember "not now". */
  key: string;
}

const MODE_NAMES: Record<HouseholdMode, string> = { home: "Home", away: "Away", night: "Night", vacation: "Vacation" };
const DISMISS_FOR_MS = 6 * 3_600_000;

export function timeOfDay(now: number, timezone: string): { tod: TimeOfDay; label: string } {
  let tz = timezone;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); } catch { tz = "UTC"; }
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  const label = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(now).toLowerCase();
  return { tod: hour >= 5 && hour < 11 ? "morning" : hour < 17 && hour >= 11 ? "day" : hour >= 17 && hour < 22 ? "evening" : "night", label };
}

/**
 * Deterministic household suggestions (no AI): "Everyone has left, switch to Away?" and so on, from who is home (Home
 * Assistant `person` entities), the time of day in the household's time zone and the current mode.
 */
export class InsightsService {
  private unsubs: Unsubscribe[] = [];
  private lastSeen = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus<AppEvent>,
    private readonly things: ThingsService,
    private readonly modes: ModesService,
    private readonly presenceSvc: PresenceService,
    private readonly now: () => number = Date.now,
  ) {}

  /** Re-evaluates when someone arrives or leaves and when the mode changes; call `tick()` on a timer for the time of day. */
  start(intervalMs: number | null = null) {
    this.unsubs.push(
      this.bus.subscribe("presence.changed", (e) => this.tick(e.householdId)),
      this.bus.subscribe("presence.links_changed", (e) => this.tick(e.householdId)),
      this.bus.subscribe("household.mode_changed", (e) => this.tick(e.householdId)),
    );
    if (intervalMs) {
      this.timer = setInterval(() => { for (const h of this.db.select({ id: households.id }).from(households).all()) this.tick(h.id); }, intervalMs);
      this.timer.unref?.();
    }
  }

  stop() {
    for (const u of this.unsubs.splice(0)) u();
    if (this.timer) clearInterval(this.timer);
  }

  /** Tells clients to refetch if the set of suggestions changed since the last look. */
  tick(householdId: string) {
    const ids = this.list(householdId).map((i) => i.id).join(",");
    if (this.lastSeen.get(householdId) === ids) return;
    this.lastSeen.set(householdId, ids);
    this.bus.publish({ type: "insights.changed", householdId, timestamp: new Date(this.now()).toISOString() });
  }

  /** Who is home: the linked people of household members (or every Home Assistant person until people are linked). */
  presence(householdId: string): { total: number; home: number } {
    return this.presenceSvc.counts(householdId);
  }

  list(householdId: string): Insight[] {
    const hh = this.db.select().from(households).where(eq(households.id, householdId)).get();
    if (!hh) return [];
    const mode = this.modes.get(householdId).mode;
    const { total, home } = this.presence(householdId);
    const { tod, label } = timeOfDay(this.now(), hh.timezone);

    let to: HouseholdMode | null = null;
    let reason = "";
    if (total > 0 && home === 0 && mode === "home") { to = "away"; reason = "Everyone has left."; }
    else if (tod === "night" && mode === "home") { to = "night"; reason = `It is ${label}.`; }
    else if (home > 0 && mode === "away") { to = "home"; reason = "Someone just got home."; }
    else if (tod === "morning" && mode === "night") { to = "home"; reason = "It is morning."; }
    if (!to) return [];

    const key = `${to}|${tod}`;
    const dismissed = this.db.select().from(insightDismissals).where(and(eq(insightDismissals.householdId, householdId), eq(insightDismissals.key, key), gt(insightDismissals.until, this.now()))).get();
    if (dismissed) return [];
    return [{ id: `mode:${to}`, kind: "mode_suggestion", title: `Switch to ${MODE_NAMES[to]} mode?`, reason, action: { type: "set_mode", mode: to }, key }];
  }

  /** "Not now": hides this suggestion for a few hours. */
  dismiss(householdId: string, id: string) {
    const found = this.list(householdId).find((i) => i.id === id);
    if (!found) throw notFound("Suggestion");
    this.db.insert(insightDismissals).values({ householdId, key: found.key, until: this.now() + DISMISS_FOR_MS })
      .onConflictDoUpdate({ target: [insightDismissals.householdId, insightDismissals.key], set: { until: this.now() + DISMISS_FOR_MS } }).run();
    this.tick(householdId);
  }
}
