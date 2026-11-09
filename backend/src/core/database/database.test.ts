import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { DrizzleCommandStore } from "../../modules/devices/commands/drizzle-command-store";
import type { DeviceCommand } from "../../modules/devices/commands/command-types";
import { createTestDb } from "./client";
import { households, householdMembers, users } from "./schema";

const cmd = (id: string, createdAt: number, over: Partial<DeviceCommand> = {}): DeviceCommand => ({
  id, householdId: "h1", connectionId: "c1", entityId: "light.a", domain: "light", action: "turn_on", parameters: { x: 1 },
  state: "pending", requestedState: { power: true }, actualState: null, requestedBy: "u1", source: "user", haContextId: null,
  failure: null, confirmedBy: null, createdAt, dispatchedAt: null, acceptedAt: null, finishedAt: null, timeoutAt: null, previousState: null, undoOf: null, undoneBy: null, ...over,
});

describe("migrations", () => {
  test("a fresh database has foreign keys enforced", () => {
    const db = createTestDb();
    expect(() => db.insert(householdMembers).values({ id: "m", householdId: "nope", userId: "nope", role: "admin", joinedAt: 1 }).run()).toThrow();
  });

  test("deleting a household cascades to its members", () => {
    const db = createTestDb();
    db.insert(households).values({ id: "h", name: "Home", createdAt: 1 }).run();
    db.insert(users).values({ id: "u", displayName: "A", createdAt: 1 }).run();
    db.insert(householdMembers).values({ id: "m", householdId: "h", userId: "u", role: "admin", joinedAt: 1 }).run();
    db.delete(households).where(eq(households.id, "h")).run();
    expect(db.select().from(householdMembers).all()).toHaveLength(0);
  });
});

describe("DrizzleCommandStore", () => {
  const setup = () => {
    const db = createTestDb();
    db.insert(households).values({ id: "h1", name: "Home", createdAt: 1 }).run();
    return new DrizzleCommandStore(db);
  };

  test("round-trips json fields and updates", () => {
    const s = setup();
    s.create(cmd("c1", 10));
    expect(s.get("c1")).toMatchObject({ parameters: { x: 1 }, requestedState: { power: true }, failure: null });
    const u = s.update("c1", { state: "failed", failure: { code: "ha_rejected", message: "no" }, finishedAt: 20 });
    expect(u).toMatchObject({ state: "failed", failure: { code: "ha_rejected", message: "no" }, finishedAt: 20 });
  });

  test("lists newest first, with insertion order breaking same-millisecond ties (L36)", () => {
    const s = setup();
    s.create(cmd("a", 100)); s.create(cmd("b", 100)); s.create(cmd("c", 50));
    expect(s.list().map((c) => c.id)).toEqual(["b", "a", "c"]);
    expect(s.list({ limit: 1 })).toHaveLength(1);
    s.update("c", { state: "failed" });
    expect(s.list({ state: "failed" }).map((c) => c.id)).toEqual(["c"]);
  });

  test("unknown ids", () => {
    const s = setup();
    expect(s.get("nope")).toBeUndefined();
    expect(() => s.update("nope", { state: "failed" })).toThrow();
  });
});
