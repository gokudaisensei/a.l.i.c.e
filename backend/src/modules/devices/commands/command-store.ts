import type { DeviceCommand } from "./command-types";

/** Persistence for commands. In-memory today; a Drizzle-backed store replaces it in the schema pass. */
export interface CommandStore {
  create(cmd: DeviceCommand): void;
  update(id: string, patch: Partial<DeviceCommand>): DeviceCommand;
  get(id: string): DeviceCommand | undefined;
  list(filter?: { householdId?: string; state?: DeviceCommand["state"]; entityId?: string; limit?: number }): DeviceCommand[];
}

export class InMemoryCommandStore implements CommandStore {
  private rows = new Map<string, DeviceCommand>();

  create(cmd: DeviceCommand) {
    this.rows.set(cmd.id, structuredClone(cmd));
  }

  update(id: string, patch: Partial<DeviceCommand>) {
    const cur = this.rows.get(id);
    if (!cur) throw new Error(`Unknown command ${id}`);
    const next = { ...cur, ...patch };
    this.rows.set(id, next);
    return structuredClone(next);
  }

  get(id: string) {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : undefined;
  }

  list(f: { householdId?: string; state?: DeviceCommand["state"]; entityId?: string; limit?: number } = {}) {
    // Newest first. Insertion order breaks ties between commands created in the same millisecond (ids are not monotonic).
    return [...this.rows.values()]
      .reverse()
      .filter((c) => (!f.householdId || c.householdId === f.householdId) && (!f.state || c.state === f.state) && (!f.entityId || c.entityId === f.entityId))
      .sort((a, b) => b.createdAt - a.createdAt) // stable, so the reversed insertion order is kept for ties
      .slice(0, f.limit ?? 100)
      .map((c) => structuredClone(c));
  }
}
