import { beforeEach, describe, expect, test } from "bun:test";
import pino from "pino";
import { createTestDb } from "../../core/database/client";
import { auditLog, sensitiveOperationRules, users } from "../../core/database/schema";
import type { AppEvent } from "../../core/events/app-events";
import { InMemoryEventBus } from "../../core/events/event-bus";
import { CommandExecutor } from "../devices/commands/command-executor";
import { DrizzleCommandStore } from "../devices/commands/drizzle-command-store";
import { ConnectionManager } from "../home-assistant";
import { FakeGateway, state } from "../home-assistant/testing";
import { HouseholdService } from "../households/household.service";
import { PermissionService } from "./permission.service";

let now = 1_700_000_000_000;
let db: ReturnType<typeof createTestDb>;
let households: HouseholdService;
let perms: PermissionService;
let hh: string;
const ids: Record<string, string> = {};

const addUser = (id: string) => db.insert(users).values({ id, displayName: id, createdAt: now }).run();
function join(userId: string, role: "member" | "guest", guestHours?: number) {
  addUser(userId);
  const { code } = households.createInvitation(hh, "admin", { role, guestAccessHours: guestHours });
  db.transaction((tx) => households.consumeInvitation(tx, code, userId));
}

beforeEach(() => {
  now = 1_700_000_000_000;
  db = createTestDb();
  households = new HouseholdService(db, () => now);
  perms = new PermissionService(db, households, () => now);
  addUser("admin");
  hh = households.createHousehold(db, "Home", "admin");
  join("meera", "member");
  join("lakshmi", "guest", 2);
});

const ask = (userId: string | null, source: "user" | "automation" | "job" | "ai" = "user", entityId = "light.a", householdId = hh) =>
  perms.authorizer().authorize({ actor: { userId, source }, householdId, connectionId: "c1", entityId, domain: "light", action: "turn_on" });

describe("authorizer", () => {
  test("admins and members may control devices; the household must match", async () => {
    expect((await ask("admin")).allowed).toBe(true);
    expect((await ask("meera")).allowed).toBe(true);
    expect(await ask("meera", "user", "light.a", "another-household")).toMatchObject({ allowed: false, reason: "You are not part of this home" });
    expect((await ask("stranger")).allowed).toBe(false);
  });

  test("guests need an allow policy, and lose access when it is removed or their access expires", async () => {
    expect((await ask("lakshmi")).allowed).toBe(false);
    const p = perms.createPolicy(hh, "admin", { connectionId: "c1", entityId: "light.a", subjectType: "role", subjectId: "guest", effect: "allow" });
    expect((await ask("lakshmi")).allowed).toBe(true);
    expect((await ask("lakshmi", "user", "light.b")).allowed).toBe(false);
    perms.deletePolicy(hh, "admin", p.id);
    expect((await ask("lakshmi")).allowed).toBe(false);
    perms.createPolicy(hh, "admin", { connectionId: "c1", entityId: "light.a", subjectType: "role", subjectId: "guest", effect: "allow" });
    now += 3 * 3_600_000;
    expect(await ask("lakshmi")).toMatchObject({ allowed: false, reason: "You are not part of this home" });
  });

  test("a deny policy blocks a member but not an admin", async () => {
    perms.createPolicy(hh, "admin", { connectionId: "c1", entityId: "light.a", subjectType: "member", subjectId: "meera", effect: "deny" });
    expect((await ask("meera")).allowed).toBe(false);
    expect((await ask("admin")).allowed).toBe(true);
  });

  test("system work (automations, jobs) is allowed without a user; an anonymous user request is not", async () => {
    expect((await ask(null, "automation")).allowed).toBe(true);
    expect((await ask(null, "job")).allowed).toBe(true);
    expect((await ask(null, "user")).allowed).toBe(false);
    expect((await ask(null, "ai")).allowed).toBe(false);
  });

  test("policies are household-scoped and validated", () => {
    expect(() => perms.createPolicy(hh, "admin", { connectionId: "c", entityId: "x.y", subjectType: "role", subjectId: "root", effect: "allow" })).toThrow(/Unknown role/);
    expect(() => perms.deletePolicy("other", "admin", "pol_nope")).toThrow(/not found/);
  });
});

describe("sensitive operations setting", () => {
  test("shows the defaults, then the household's own rules on top", () => {
    expect(perms.effectiveSensitivity(hh).map((r) => `${r.domain}.${r.action}:${r.source}`)).toEqual(["lock.unlock:default", "lock.open:default"]);
    const r = perms.replaceSensitivityRules(hh, "admin", [{ domain: "cover", action: "open", deviceClass: "garage", sensitive: true }]);
    expect(r.defaultsSwitchedOff).toEqual([]);
    expect(r.rules.map((x) => `${x.domain}.${x.action}${x.deviceClass ? "/" + x.deviceClass : ""}:${x.source}`)).toEqual(["lock.unlock:default", "lock.open:default", "cover.open/garage:custom"]);
  });

  test("switching a default off is reported and audited; removing the rule restores it", () => {
    const r = perms.replaceSensitivityRules(hh, "admin", [{ domain: "lock", action: "unlock", sensitive: false }]);
    expect(r.defaultsSwitchedOff).toEqual(["lock.unlock"]);
    expect(perms.sensitivityPolicy().isSensitive({ householdId: hh, domain: "lock", action: "unlock", deviceClass: null })).toBe(false);
    expect(db.select().from(auditLog).all().map((a) => a.action)).toContain("security.sensitive_operations_changed");
    const custom = perms.effectiveSensitivity(hh).find((x) => x.source === "custom")!;
    expect(custom.sensitive).toBe(false);
    const rowId = db.select({ id: sensitiveOperationRules.id }).from(sensitiveOperationRules).get()!.id;
    perms.deleteSensitivityRule(hh, "admin", rowId);
    expect(perms.sensitivityPolicy().isSensitive({ householdId: hh, domain: "lock", action: "unlock", deviceClass: null })).toBe(true);
  });

  test("rules are per household, normalised, and validated", () => {
    expect(() => perms.replaceSensitivityRules(hh, "admin", [{ domain: "", action: "x", sensitive: true }])).toThrow(/domain/);
    expect(() => perms.replaceSensitivityRules(hh, "admin", [{ domain: "a", action: "b", sensitive: true }, { domain: "A", action: "B", sensitive: false }])).toThrow(/Duplicate/);
    perms.replaceSensitivityRules(hh, "admin", [{ domain: " Cover ", action: "OPEN", deviceClass: "Garage", sensitive: true }]);
    expect(perms.sensitivityPolicy().isSensitive({ householdId: hh, domain: "cover", action: "open", deviceClass: "garage" })).toBe(true);
    expect(perms.sensitivityPolicy().isSensitive({ householdId: "other", domain: "cover", action: "open", deviceClass: "garage" })).toBe(false);
  });
});

describe("command pipeline with real authorization, sensitivity and a database store", () => {
  async function pipeline() {
    const gw = new FakeGateway();
    gw.states = [state("light.a", "off", { supported_color_modes: ["onoff"] }), state("lock.front", "locked", { device_class: "door" })];
    const bus = new InMemoryEventBus<AppEvent>();
    const log = pino({ level: "silent" });
    const manager = new ConnectionManager(() => gw, bus, log);
    await manager.add({ id: "c1", householdId: hh, baseUrl: "http://x", token: "t" });
    gw.onCallService = (call) => {
      if (call.domain === "light") gw.emitState(state("light.a", call.service === "turn_on" ? "on" : "off", { supported_color_modes: ["onoff"] }), state("light.a", "off"));
      if (call.domain === "lock") gw.emitState(state("lock.front", call.service === "unlock" ? "unlocked" : "locked", { device_class: "door" }), state("lock.front", "locked"));
    };
    const store = new DrizzleCommandStore(db);
    const exec = new CommandExecutor({ manager, bus, log, store, authorizer: perms.authorizer(), sensitivity: perms.sensitivityPolicy() });
    const run = (userId: string, entityId: string, action: string, steppedUp = false) =>
      exec.done(exec.submit({ householdId: hh, entityId, action, actor: { userId, source: "user", steppedUp }, confirmTimeoutMs: 200 }).id);
    return { run, store };
  }

  test("a member turns on a light, and the command is stored in the database", async () => {
    const { run, store } = await pipeline();
    const c = await run("meera", "light.a", "turn_on");
    expect(c.state).toBe("confirmed");
    expect(store.list({ householdId: hh })[0]).toMatchObject({ id: c.id, state: "confirmed", requestedBy: "meera" });
  });

  test("a guest without access is refused, and the refusal is recorded", async () => {
    const { run, store } = await pipeline();
    const c = await run("lakshmi", "light.a", "turn_on");
    expect(c).toMatchObject({ state: "failed", failure: { code: "forbidden" } });
    expect(store.get(c.id)!.failure?.code).toBe("forbidden");
  });

  test("unlock needs step-up by default; an admin can turn that off, or require it for lights", async () => {
    const { run } = await pipeline();
    expect((await run("meera", "lock.front", "unlock")).failure?.code).toBe("step_up_required");
    expect((await run("meera", "lock.front", "unlock", true)).state).toBe("confirmed");

    perms.replaceSensitivityRules(hh, "admin", [{ domain: "lock", action: "unlock", sensitive: false }, { domain: "light", action: "turn_on", sensitive: true }]);
    expect((await run("meera", "lock.front", "unlock")).state).toBe("confirmed"); // no step-up needed any more
    expect((await run("meera", "light.a", "turn_on")).failure?.code).toBe("step_up_required");
    expect((await run("meera", "light.a", "turn_on", true)).state).toBe("confirmed");
  });
});
