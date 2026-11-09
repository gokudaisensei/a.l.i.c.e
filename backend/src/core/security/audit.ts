import { auditLog } from "../database/schema";
import type { DbLike } from "../database/types";
import { newId } from "../ids";

export interface AuditEntry {
  householdId?: string | null;
  actorType?: "user" | "system" | "support";
  actorId?: string | null;
  action: string;
  resource?: string | null;
  detail?: Record<string, unknown> | null;
}

/** Appends a security-relevant event. Never put secrets (tokens, codes) in `detail`. */
export function writeAudit(db: DbLike, e: AuditEntry, now = Date.now()) {
  db.insert(auditLog).values({
    id: newId("aud"), householdId: e.householdId ?? null, actorType: e.actorType ?? "user", actorId: e.actorId ?? null,
    action: e.action, resource: e.resource ?? null, detail: e.detail ?? null, createdAt: now,
  }).run();
}
