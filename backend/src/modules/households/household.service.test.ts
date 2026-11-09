import { beforeEach, describe, expect, test } from "bun:test";
import { createTestDb } from "../../core/database/client";
import { users } from "../../core/database/schema";
import { AppError } from "../../core/errors/errors";
import { HouseholdService } from "./household.service";

let now = 1_000_000;
let db: ReturnType<typeof createTestDb>;
let svc: HouseholdService;
let hh: string;

const addUser = (id: string, name = id) => db.insert(users).values({ id, displayName: name, createdAt: now }).run();

beforeEach(() => {
  now = 1_000_000;
  db = createTestDb();
  svc = new HouseholdService(db, () => now);
  addUser("admin1", "Gokul");
  hh = svc.createHousehold(db, "Home", "admin1");
});

describe("household and membership", () => {
  test("the creator is the first admin; settings row exists", () => {
    expect(svc.getMembership("admin1")).toMatchObject({ householdId: hh, role: "admin", expiresAt: null });
    expect(svc.get(hh)).toMatchObject({ name: "Home", timezone: "UTC" });
    expect(svc.update(hh, { name: "Our home", timezone: "Asia/Kolkata" })).toMatchObject({ name: "Our home", timezone: "Asia/Kolkata" });
  });

  test("the last admin cannot be demoted or removed", () => {
    const m = svc.listMembers(hh)[0]!;
    expect(() => svc.updateMember(hh, m.id, { role: "member" })).toThrow(/at least one admin/);
    expect(() => svc.removeMember(hh, m.id)).toThrow(/at least one admin/);
  });
});

describe("invitations", () => {
  test("a code is shown once and only its hash is stored", () => {
    const { code, invitation } = svc.createInvitation(hh, "admin1", { role: "member" });
    expect(code).toMatch(/^[A-Z]+-\d{6}-[A-Z]+-[A-Z2-9]{4}$/);
    expect(JSON.stringify(svc.listInvitations(hh))).not.toContain(code);
    expect(svc.listInvitations(hh).map((i) => i.id)).toEqual([invitation.id]);
  });

  test("consuming creates a membership with the invited role; codes are single-use", () => {
    const { code } = svc.createInvitation(hh, "admin1", { role: "member" });
    addUser("u2");
    db.transaction((tx) => svc.consumeInvitation(tx, code, "u2"));
    expect(svc.getMembership("u2")).toMatchObject({ householdId: hh, role: "member" });
    addUser("u3");
    expect(() => db.transaction((tx) => svc.consumeInvitation(tx, code, "u3"))).toThrow(AppError);
    expect(svc.listInvitations(hh)).toHaveLength(0);
  });

  test("typed codes tolerate case and spaces", () => {
    const { code } = svc.createInvitation(hh, "admin1", { role: "member" });
    expect(svc.findValidInvitation(` ${code.toLowerCase().replace(/-/g, "- ")} `).householdId).toBe(hh);
  });

  test("expired and revoked codes are rejected with the same message as unknown ones", () => {
    const a = svc.createInvitation(hh, "admin1", { role: "member", expiresInHours: 1 });
    const b = svc.createInvitation(hh, "admin1", { role: "member" });
    now += 2 * 3_600_000;
    svc.revokeInvitation(hh, b.invitation.id);
    const msg = (c: string) => { try { svc.findValidInvitation(c); } catch (e) { return (e as AppError).message; } };
    expect(msg(a.code)).toBe(msg(b.code));
    expect(msg("NOPE-000000-NOPE-ABCD")).toBe(msg(a.code));
  });

  test("guest invitations give time-limited access that lapses", () => {
    const { code } = svc.createInvitation(hh, "admin1", { role: "guest", guestAccessHours: 48 });
    addUser("g1");
    db.transaction((tx) => svc.consumeInvitation(tx, code, "g1"));
    expect(svc.getMembership("g1")).toMatchObject({ role: "guest", expiresAt: now + 48 * 3_600_000 });
    now += 49 * 3_600_000;
    expect(svc.getMembership("g1")).toBeNull();
    expect(svc.listMembers(hh).find((m) => m.userId === "g1")?.expired).toBe(true);
  });
});

describe("managing members", () => {
  test("promote, set an expiry, remove; scoped to the household", () => {
    const { code } = svc.createInvitation(hh, "admin1", { role: "member" });
    addUser("u2");
    const joined = db.transaction((tx) => svc.consumeInvitation(tx, code, "u2"));
    expect(svc.updateMember(hh, joined.memberId, { role: "admin" }).role).toBe("admin");
    expect(svc.updateMember(hh, joined.memberId, { role: "guest", expiresAt: now + 1000 })).toMatchObject({ role: "guest", expiresAt: now + 1000 });
    const other = svc.createHousehold(db, "Other", "admin1" as string); // admin1 is in two households only in this test
    expect(() => svc.removeMember(other, joined.memberId)).toThrow(/not found/);
    svc.removeMember(hh, joined.memberId);
    expect(svc.getMembership("u2")).toBeNull();
  });
});
