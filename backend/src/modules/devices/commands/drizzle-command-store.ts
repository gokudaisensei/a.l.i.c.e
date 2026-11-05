import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { commands } from "@/core/database/schema";
import type { CommandStore } from "./command-store";
import type { DeviceCommand } from "./command-types";

/** SQLite-backed command store. bun:sqlite is synchronous, so this satisfies the sync CommandStore interface. */
export class DrizzleCommandStore implements CommandStore {
  constructor(private readonly db: Db) {}

  create(cmd: DeviceCommand) {
    this.db.insert(commands).values(cmd).run();
  }

  update(id: string, patch: Partial<DeviceCommand>) {
    const { id: _ignored, ...rest } = patch;
    if (Object.keys(rest).length) this.db.update(commands).set(rest).where(eq(commands.id, id)).run();
    const row = this.get(id);
    if (!row) throw new Error(`Unknown command ${id}`);
    return row;
  }

  get(id: string) {
    return this.db.select().from(commands).where(eq(commands.id, id)).get() as DeviceCommand | undefined;
  }

  list(f: { householdId?: string; state?: DeviceCommand["state"]; entityId?: string; limit?: number } = {}) {
    const where = and(
      f.householdId ? eq(commands.householdId, f.householdId) : undefined,
      f.state ? eq(commands.state, f.state) : undefined,
      f.entityId ? eq(commands.entityId, f.entityId) : undefined,
    );
    // rowid breaks ties between commands created in the same millisecond (ids are not monotonic).
    return this.db.select().from(commands).where(where).orderBy(desc(commands.createdAt), desc(sql`rowid`)).limit(f.limit ?? 100).all() as DeviceCommand[];
  }
}
