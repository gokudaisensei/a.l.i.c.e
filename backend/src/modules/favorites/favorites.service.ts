import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { favorites } from "@/core/database/schema";
import type { Thing } from "../home-assistant/things/types";
import type { ThingsService } from "../home-assistant/things/things.service";

export const MAX_FAVORITES = 50;

/** Does this stored (connection, ref) point at this Thing? A merged Thing answers to the refs of everything merged into it. */
export function refMatches(thing: Thing, ref: string): boolean {
  if (thing.ref === ref) return true;
  if (ref.startsWith("device:")) return thing.deviceIds.includes(ref.slice(7));
  return thing.entityIds.includes(ref.slice(7)) && thing.deviceIds.length === 0;
}

/** A person's ordered shortcuts, stored by HA reference so they survive resyncs and merges. */
export class FavoritesService {
  constructor(private readonly db: Db, private readonly things: ThingsService) {}

  /** Thing ids in the person's order. Favorites whose device no longer exists are left out (they come back if it does). */
  idsFor(householdId: string, userId: string): string[] {
    const rows = this.db.select().from(favorites).where(eq(favorites.userId, userId)).orderBy(asc(favorites.position)).all();
    const out: string[] = [];
    for (const r of rows) {
      for (const ct of this.things.forHousehold(householdId)) {
        if (ct.conn.config.id !== r.connectionId) continue;
        const t = ct.things.find((x) => refMatches(x, r.ref));
        if (t && !out.includes(t.id)) out.push(t.id);
      }
    }
    return out;
  }

  /** Replaces the whole list. Positions follow the order given. */
  save(userId: string, items: { connectionId: string; ref: string }[]) {
    this.db.transaction((tx) => {
      tx.delete(favorites).where(eq(favorites.userId, userId)).run();
      items.forEach((it, position) => tx.insert(favorites).values({ userId, connectionId: it.connectionId, ref: it.ref, position }).run());
    });
  }

  clearFor(userId: string, connectionId: string) {
    this.db.delete(favorites).where(and(eq(favorites.userId, userId), eq(favorites.connectionId, connectionId))).run();
  }
}
