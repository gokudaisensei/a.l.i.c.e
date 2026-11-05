import { and, eq } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { devicePolicies, sensitiveOperationRules } from "@/core/database/schema";
import { AppError, notFound } from "@/core/errors/errors";
import { newId } from "@/core/ids";
import { writeAudit } from "@/core/security/audit";
import type { Authorizer } from "../devices/commands/authorizer";
import { DEFAULT_SENSITIVITY_RULES, resolveSensitivity, type SensitivityPolicy, type SensitivityRule } from "../devices/commands/sensitivity";
import type { HouseholdService } from "../households/household.service";
import { evaluateDeviceAccess, type DevicePolicyRow } from "./device-access";
import { can } from "./permissions";

export interface NewDevicePolicy {
  connectionId: string;
  entityId: string;
  subjectType: "role" | "member";
  subjectId: string;
  effect: "allow" | "deny";
  operations?: string[] | null;
}

export class PermissionService {
  constructor(private readonly db: Db, private readonly households: HouseholdService, private readonly now: () => number = Date.now) {}

  // ---- device policies ----

  listPolicies(householdId: string): (DevicePolicyRow & { id: string })[] {
    return this.db.select().from(devicePolicies).where(eq(devicePolicies.householdId, householdId)).all();
  }

  createPolicy(householdId: string, actorId: string, p: NewDevicePolicy) {
    if (p.subjectType === "role" && !["admin", "member", "guest"].includes(p.subjectId)) throw new AppError(400, "validation_error", "Unknown role");
    const row = { id: newId("pol"), householdId, ...p, operations: p.operations ?? null, createdBy: actorId, createdAt: this.now() };
    this.db.insert(devicePolicies).values(row).run();
    writeAudit(this.db, { householdId, actorId, action: "permissions.policy_created", resource: row.id, detail: { entityId: p.entityId, subject: `${p.subjectType}:${p.subjectId}`, effect: p.effect } }, this.now());
    return row;
  }

  deletePolicy(householdId: string, actorId: string, id: string) {
    const hit = this.db.delete(devicePolicies).where(and(eq(devicePolicies.id, id), eq(devicePolicies.householdId, householdId))).returning({ id: devicePolicies.id }).all();
    if (!hit.length) throw notFound("Policy");
    writeAudit(this.db, { householdId, actorId, action: "permissions.policy_deleted", resource: id }, this.now());
  }

  // ---- sensitive operations (admin-configurable step-up) ----

  private customRules(householdId: string): SensitivityRule[] {
    return this.db.select().from(sensitiveOperationRules).where(eq(sensitiveOperationRules.householdId, householdId)).all();
  }

  /** Defaults not overridden by the household, plus the household's own rules. */
  effectiveSensitivity(householdId: string) {
    const custom = this.customRules(householdId);
    const key = (r: SensitivityRule) => `${r.domain}|${r.action}|${r.deviceClass}`;
    const overridden = new Set(custom.map(key));
    return [
      ...DEFAULT_SENSITIVITY_RULES.filter((d) => !overridden.has(key(d))).map((r) => ({ ...r, source: "default" as const })),
      ...custom.map((r) => ({ domain: r.domain, action: r.action, deviceClass: r.deviceClass, sensitive: r.sensitive, source: "custom" as const })),
    ];
  }

  /** Replaces the household's rules. Returns the effective list and which defaults ended up switched off. */
  replaceSensitivityRules(householdId: string, actorId: string, rules: { domain: string; action: string; deviceClass?: string; sensitive: boolean }[]) {
    const clean = rules.map((r) => ({ domain: r.domain.trim().toLowerCase(), action: r.action.trim().toLowerCase(), deviceClass: (r.deviceClass ?? "").trim().toLowerCase(), sensitive: r.sensitive }));
    if (clean.some((r) => !r.domain || !r.action)) throw new AppError(400, "validation_error", "Each rule needs a domain and an action");
    const seen = new Set<string>();
    for (const r of clean) {
      const k = `${r.domain}|${r.action}|${r.deviceClass}`;
      if (seen.has(k)) throw new AppError(400, "validation_error", `Duplicate rule for ${r.domain}.${r.action}`);
      seen.add(k);
    }
    this.db.transaction((tx) => {
      tx.delete(sensitiveOperationRules).where(eq(sensitiveOperationRules.householdId, householdId)).run();
      for (const r of clean) tx.insert(sensitiveOperationRules).values({ id: newId("sen"), householdId, ...r, updatedBy: actorId, updatedAt: this.now() }).run();
      writeAudit(tx, { householdId, actorId, action: "security.sensitive_operations_changed", detail: { rules: clean } }, this.now());
    });
    const defaultsSwitchedOff = DEFAULT_SENSITIVITY_RULES.filter((d) => !resolveSensitivity(clean, d.domain, d.action, null)).map((d) => `${d.domain}.${d.action}`);
    return { rules: this.effectiveSensitivity(householdId), defaultsSwitchedOff };
  }

  deleteSensitivityRule(householdId: string, actorId: string, id: string) {
    const hit = this.db.delete(sensitiveOperationRules).where(and(eq(sensitiveOperationRules.id, id), eq(sensitiveOperationRules.householdId, householdId))).returning({ id: sensitiveOperationRules.id }).all();
    if (!hit.length) throw notFound("Rule");
    writeAudit(this.db, { householdId, actorId, action: "security.sensitive_rule_removed", resource: id }, this.now());
  }

  sensitivityPolicy(): SensitivityPolicy {
    return { isSensitive: (q) => resolveSensitivity(this.customRules(q.householdId), q.domain, q.action, q.deviceClass) };
  }

  // ---- authorizer for the command pipeline ----

  authorizer(): Authorizer {
    return {
      authorize: async (req) => {
        // System-initiated work (automations, jobs) has no user to check.
        if (!req.actor.userId) return req.actor.source === "automation" || req.actor.source === "job" ? { allowed: true } : { allowed: false, reason: "Not signed in" };
        const m = this.households.getMembership(req.actor.userId);
        if (!m || m.householdId !== req.householdId) return { allowed: false, reason: "You are not part of this home" };
        if (!can(m.role, "device.control")) return { allowed: false, reason: "Your role cannot control devices" };
        const policies = this.listPolicies(req.householdId).filter((p) => p.entityId === req.entityId);
        const r = evaluateDeviceAccess({ role: m.role, userId: m.userId, connectionId: req.connectionId, entityId: req.entityId, operation: req.action, policies });
        return r.allowed ? { allowed: true } : { allowed: false, reason: r.reason };
      },
    };
  }
}
