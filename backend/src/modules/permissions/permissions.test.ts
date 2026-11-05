import { describe, expect, test } from "bun:test";
import { resolveSensitivity } from "../devices/commands/sensitivity";
import { evaluateDeviceAccess, type DevicePolicyRow } from "./device-access";
import { can } from "./permissions";

describe("role permissions", () => {
  test("admin can do everything; member cannot manage; guest is minimal", () => {
    expect(can("admin", "members.manage")).toBe(true);
    expect(can("member", "automation.write")).toBe(true);
    expect(can("member", "members.manage")).toBe(false);
    expect(can("member", "ha.manage")).toBe(false);
    expect(can("guest", "device.control")).toBe(true);
    expect(can("guest", "automation.write")).toBe(false);
    expect(can("guest", "energy.view")).toBe(false);
  });
});

describe("device access", () => {
  const p = (over: Partial<DevicePolicyRow>): DevicePolicyRow => ({ connectionId: "c", entityId: "light.a", subjectType: "role", subjectId: "guest", effect: "allow", operations: null, ...over });
  const ask = (role: "admin" | "member" | "guest", policies: DevicePolicyRow[], operation?: string, entityId = "light.a") =>
    evaluateDeviceAccess({ role, userId: "u1", connectionId: "c", entityId, operation, policies });

  test("members and admins are allowed by default; a deny blocks them", () => {
    expect(ask("member", []).allowed).toBe(true);
    expect(ask("admin", [p({ subjectId: "member", effect: "deny" })]).allowed).toBe(true); // a deny for members does not apply to admins
    expect(ask("member", [p({ subjectId: "member", effect: "deny" })]).allowed).toBe(false);
  });
  test("guests need an explicit allow", () => {
    expect(ask("guest", []).allowed).toBe(false);
    expect(ask("guest", [p({})]).allowed).toBe(true);
    expect(ask("guest", [p({})], undefined, "light.other").allowed).toBe(false);
  });
  test("deny beats allow, and a member-specific policy applies to that user only", () => {
    expect(ask("guest", [p({}), p({ subjectType: "member", subjectId: "u1", effect: "deny" })]).allowed).toBe(false);
    expect(ask("guest", [p({}), p({ subjectType: "member", subjectId: "someone-else", effect: "deny" })]).allowed).toBe(true);
  });
  test("operation-limited policies", () => {
    const only = [p({ operations: ["turn_on", "turn_off"] })];
    expect(ask("guest", only, "turn_on").allowed).toBe(true);
    expect(ask("guest", only, "set_brightness").allowed).toBe(false);
    expect(ask("guest", only).allowed).toBe(true); // viewing is not limited by an operation list
  });
});

describe("sensitivity rules", () => {
  test("defaults: unlock and open on locks", () => {
    expect(resolveSensitivity([], "lock", "unlock", null)).toBe(true);
    expect(resolveSensitivity([], "lock", "open", null)).toBe(true);
    expect(resolveSensitivity([], "lock", "lock", null)).toBe(false);
    expect(resolveSensitivity([], "light", "turn_on", null)).toBe(false);
  });
  test("an admin can add rules, narrowed by device class", () => {
    const rules = [{ domain: "cover", action: "open", deviceClass: "garage", sensitive: true }];
    expect(resolveSensitivity(rules, "cover", "open", "garage")).toBe(true);
    expect(resolveSensitivity(rules, "cover", "open", "blind")).toBe(false);
    expect(resolveSensitivity(rules, "cover", "open", null)).toBe(false);
  });
  test("an admin can switch a default off, and a specific rule beats a general one", () => {
    expect(resolveSensitivity([{ domain: "lock", action: "unlock", deviceClass: "", sensitive: false }], "lock", "unlock", null)).toBe(false);
    const rules = [
      { domain: "lock", action: "unlock", deviceClass: "", sensitive: false },
      { domain: "lock", action: "unlock", deviceClass: "door", sensitive: true },
    ];
    expect(resolveSensitivity(rules, "lock", "unlock", "door")).toBe(true);
    expect(resolveSensitivity(rules, "lock", "unlock", "gate")).toBe(false);
  });
});
