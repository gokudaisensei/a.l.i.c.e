import { and, eq } from "drizzle-orm";
import type { Db } from "../../core/database/client";
import { entitySettings } from "../../core/database/schema";
import type { ManagedConnection } from "../home-assistant";
import type { Thing } from "../home-assistant/things/types";

/** The first power limit (watts) stored for any of these entities. */
export function powerLimitOf(db: Db, connectionId: string, entityIds: string[]): number | null {
  for (const id of entityIds) {
    const r = db.select({ l: entitySettings.powerLimitW }).from(entitySettings).where(and(eq(entitySettings.connectionId, connectionId), eq(entitySettings.entityId, id))).get();
    if (r?.l) return r.l;
  }
  return null;
}

/** The device's power reading entity (device class "power"), if it has one. */
export function powerSensorOf(conn: ManagedConnection, thing: Thing): string | null {
  return thing.entityIds.find((id) => (conn.cache.get(id)?.normalized.sensor as { deviceClass?: string } | undefined)?.deviceClass === "power") ?? null;
}
