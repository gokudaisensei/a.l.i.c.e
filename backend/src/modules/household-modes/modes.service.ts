import { eq } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { HOUSEHOLD_MODES, type HouseholdMode, householdSettings, users } from "@/core/database/schema";
import { AppError } from "@/core/errors/errors";
import type { AppEvent } from "@/core/events/app-events";
import type { EventBus } from "@/core/events/event-bus";
import { writeAudit } from "@/core/security/audit";

export interface ModeState {
  mode: HouseholdMode;
  changedAt: number | null;
  changedBy: { id: string; displayName: string } | null;
}

/** The household's mode (Home, Away, Night, Vacation). Automations and routines can read it and change it. */
export class ModesService {
  constructor(private readonly db: Db, private readonly bus: EventBus<AppEvent>, private readonly now: () => number = Date.now) {}

  get(householdId: string): ModeState {
    const s = this.db.select().from(householdSettings).where(eq(householdSettings.householdId, householdId)).get();
    const by = s?.modeChangedBy ? this.db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, s.modeChangedBy)).get() : undefined;
    return { mode: s?.mode ?? "home", changedAt: s?.modeChangedAt ?? null, changedBy: by ?? null };
  }

  /** Sets the mode. Setting the mode it already has changes nothing and sends nothing. */
  set(householdId: string, userId: string | null, mode: string): ModeState {
    if (!(HOUSEHOLD_MODES as readonly string[]).includes(mode)) throw new AppError(400, "validation_error", `Mode must be one of ${HOUSEHOLD_MODES.join(", ")}`);
    const next = mode as HouseholdMode;
    const current = this.get(householdId);
    if (current.mode === next) return current;
    const t = this.now();
    this.db.update(householdSettings).set({ mode: next, modeChangedAt: t, modeChangedBy: userId }).where(eq(householdSettings.householdId, householdId)).run();
    writeAudit(this.db, { householdId, actorType: userId ? "user" : "system", actorId: userId, action: "household.mode_changed", detail: { from: current.mode, to: next } }, t);
    this.bus.publish({ type: "household.mode_changed", householdId, mode: next, previous: current.mode, changedBy: userId, timestamp: new Date(t).toISOString() });
    return this.get(householdId);
  }
}
