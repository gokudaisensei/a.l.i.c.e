import type { Role } from "../../core/database/schema";

export interface DevicePolicyRow {
  connectionId: string;
  entityId: string;
  subjectType: "role" | "member";
  subjectId: string;
  effect: "allow" | "deny";
  operations: string[] | null;
}

export interface AccessRequest {
  role: Role;
  userId: string;
  connectionId: string;
  entityId: string;
  /** Omit to ask about viewing; give an operation to ask about controlling. */
  operation?: string;
  policies: DevicePolicyRow[];
}

export interface AccessResult {
  allowed: boolean;
  reason: string;
}

/**
 * Device-level access on top of role permissions.
 * Admins and members may use any device unless a matching deny exists.
 * Guests may use only devices with a matching allow. A deny always beats an allow.
 */
export function evaluateDeviceAccess(r: AccessRequest): AccessResult {
  const matching = r.policies.filter(
    (p) =>
      p.connectionId === r.connectionId &&
      p.entityId === r.entityId &&
      ((p.subjectType === "role" && p.subjectId === r.role) || (p.subjectType === "member" && p.subjectId === r.userId)) &&
      (!r.operation || !p.operations || p.operations.includes(r.operation)),
  );
  if (matching.some((p) => p.effect === "deny")) return { allowed: false, reason: "This device is blocked for you" };
  if (r.role === "guest") {
    return matching.some((p) => p.effect === "allow") ? { allowed: true, reason: "Allowed for guests" } : { allowed: false, reason: "Guests can only use devices they have been given" };
  }
  return { allowed: true, reason: "Allowed by role" };
}
