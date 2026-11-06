import { eq } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { households, operators } from "@/core/database/schema";
import { AppError, notFound } from "@/core/errors/errors";
import { newId } from "@/core/ids";
import { writeAudit } from "@/core/security/audit";
import { randomToken, sha256 } from "@/core/security/tokens";
import type { Caller, DevicesService } from "../devices/devices.service";
import type { AdminService } from "./admin.service";
import type { SupportService } from "./support.service";

export interface OperatorIdentity { id: string; label: string }

/**
 * Support staff reaching a home. They sign in with a token (not a household login) and can only see what a household
 * admin granted, while the grant lasts. They can read; they can never act on a device, and every look is recorded in
 * the household's own log under their name.
 */
export class OperatorService {
  constructor(private readonly db: Db, private readonly support: SupportService, private readonly admin: AdminService, private readonly devices: DevicesService, private readonly now: () => number = Date.now) {}

  /** Makes an operator and returns the token, which is shown once and never stored. */
  create(label: string, days = 90): { operator: OperatorIdentity; token: string; expiresAt: number } {
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new AppError(400, "validation_error", "A token lasts between 1 and 365 days");
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(label)) throw new AppError(400, "validation_error", "Use lower-case letters, digits and dashes, e.g. ops-114");
    if (this.db.select().from(operators).where(eq(operators.label, label)).get()) throw new AppError(409, "conflict", "That operator already exists");
    const token = `alice_op_${randomToken(32)}`;
    const id = newId("opr");
    const expiresAt = this.now() + days * 86_400_000;
    this.db.insert(operators).values({ id, label, tokenHash: sha256(token), createdAt: this.now(), expiresAt }).run();
    return { operator: { id, label }, token, expiresAt };
  }

  revoke(label: string) {
    const r = this.db.update(operators).set({ revokedAt: this.now() }).where(eq(operators.label, label)).returning({ id: operators.id }).all();
    if (!r.length) throw notFound("Operator");
  }

  authenticate(token: string | null): OperatorIdentity {
    const row = token ? this.db.select().from(operators).where(eq(operators.tokenHash, sha256(token))).get() : undefined;
    if (!row || row.revokedAt || (row.expiresAt !== null && row.expiresAt <= this.now())) throw new AppError(401, "unauthenticated", "Support sign-in failed");
    this.db.update(operators).set({ lastSeenAt: this.now() }).where(eq(operators.id, row.id)).run();
    return { id: row.id, label: row.label };
  }

  /** Homes that currently have an open grant, and what each allows. */
  homes() {
    return this.db.select().from(households).all().flatMap((h) => {
      const g = this.support.active(h.id);
      return g ? [{ householdId: h.id, name: h.name, grant: { id: g.id, scope: g.scope, endsAt: g.endsAt } }] : [];
    });
  }

  private grant(op: OperatorIdentity, householdId: string, scope: "health" | "devices") {
    const g = this.support.active(householdId);
    if (!g) throw new AppError(403, "no_grant", "This household has not given support access, or it has ended");
    if (!g.scope[scope]) throw new AppError(403, "out_of_scope", `The household did not allow support to see ${scope === "health" ? "system health" : "the device list"}`);
    writeAudit(this.db, { householdId, actorType: "support", actorId: op.label, action: "support.operator_action", resource: scope === "health" ? "/admin/health" : "/devices", detail: { scope } }, this.now());
    return g;
  }

  health(op: OperatorIdentity, householdId: string) {
    this.grant(op, householdId, "health");
    return this.admin.health(householdId);
  }

  /** The device list without cameras (unless allowed) and without anything that could act on a device. */
  devicesOf(op: OperatorIdentity, householdId: string) {
    const g = this.grant(op, householdId, "devices");
    const c: Caller = { householdId, userId: `operator:${op.label}`, role: "admin", steppedUp: false };
    return {
      devices: this.devices.list(c).filter((d) => d.primary && (g.scope.cameras || d.primary.domain !== "camera"))
        .map((d) => ({ id: d.id, name: d.name, areaId: d.areaId, domain: d.primary!.domain, available: d.available, hidden: d.hidden, values: d.primary!.domain === "camera" ? {} : d.primary!.values })),
    };
  }
}
