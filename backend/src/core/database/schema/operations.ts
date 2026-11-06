import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { COMMAND_STATES } from "@/modules/devices/command-lifecycle";
import type { FailureCode } from "@/modules/devices/commands/command-types";
import { households } from "./households";

export const commands = sqliteTable(
  "commands",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    connectionId: text("connection_id"),
    entityId: text("entity_id").notNull(),
    domain: text("domain").notNull(),
    action: text("action").notNull(),
    parameters: text("parameters", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    state: text("state", { enum: COMMAND_STATES }).notNull(),
    requestedState: text("requested_state", { mode: "json" }).$type<Record<string, unknown> | null>(),
    actualState: text("actual_state", { mode: "json" }).$type<Record<string, unknown> | null>(),
    /** A user id, or null for system-initiated commands. Not a foreign key: history outlives users. */
    requestedBy: text("requested_by"),
    source: text("source", { enum: ["user", "automation", "ai", "job"] as const }).notNull(),
    haContextId: text("ha_context_id"),
    failure: text("failure", { mode: "json" }).$type<{ code: FailureCode; message: string } | null>(),
    confirmedBy: text("confirmed_by", { enum: ["state", "already", "unobservable"] }),
    createdAt: integer("created_at").notNull(),
    dispatchedAt: integer("dispatched_at"),
    acceptedAt: integer("accepted_at"),
    finishedAt: integer("finished_at"),
    timeoutAt: integer("timeout_at"),
    /** How the entity was just before the command, so it can be put back. */
    previousState: text("previous_state", { mode: "json" }).$type<Record<string, unknown> | null>(),
    /** Set on a command that undoes another, and on the one that was undone. */
    undoOf: text("undo_of"),
    undoneBy: text("undone_by"),
  },
  (t) => [index("commands_household_idx").on(t.householdId, t.createdAt), index("commands_state_idx").on(t.state)],
);

/** Append-only record of security-relevant actions. */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id"),
    actorType: text("actor_type", { enum: ["user", "system", "support"] }).notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    resource: text("resource"),
    detail: text("detail", { mode: "json" }).$type<Record<string, unknown> | null>(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("audit_household_idx").on(t.householdId, t.createdAt)],
);

/** A backup of Alice's own database or of Home Assistant, and whether a restore test has proved it readable. */
export const backupRecords = sqliteTable(
  "backup_records",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["app", "ha"] }).notNull(),
    destination: text("destination", { enum: ["ha", "local", "nas", "upload"] }).notNull(),
    /** App backups: the file name inside the destination. Home Assistant backups: Home Assistant's backup id. */
    destinationRef: text("destination_ref"),
    name: text("name").notNull(),
    sizeBytes: integer("size_bytes"),
    sha256: text("sha256"),
    encrypted: integer("encrypted", { mode: "boolean" }).notNull().default(false),
    /** How many migrations the database had, so a restore can tell a newer backup from an older one. */
    schemaVersion: integer("schema_version"),
    status: text("status", { enum: ["running", "ok", "failed"] }).notNull(),
    error: text("error"),
    trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
    finishedAt: integer("finished_at"),
    verifyStatus: text("verify_status", { enum: ["none", "running", "passed", "failed"] }).notNull().default("none"),
    verifiedAt: integer("verified_at"),
    verifyNote: text("verify_note"),
  },
  (t) => [index("backup_records_idx").on(t.householdId, t.createdAt)],
);

/** One update of Alice itself: offered, scheduled, installing and how it ended. */
export const updateRecords = sqliteTable(
  "update_records",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    fromVersion: text("from_version").notNull(),
    version: text("version").notNull(),
    status: text("status", { enum: ["scheduled", "preparing", "installing", "done", "failed", "cancelled", "rolled_back"] }).notNull(),
    trigger: text("trigger", { enum: ["manual", "auto", "emergency"] }).notNull(),
    /** Required for an emergency deploy. */
    reason: text("reason"),
    requestedBy: text("requested_by"),
    scheduledFor: integer("scheduled_for"),
    backupId: text("backup_id"),
    /** Home Assistant's safety backup, when one was taken. */
    haBackupId: text("ha_backup_id"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
  },
  (t) => [index("update_records_idx").on(t.householdId, t.createdAt)],
);

/** Time-boxed access a household gives to Zoho Robotics support. Ends by itself. */
export const supportSessions = sqliteTable(
  "support_sessions",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    grantedBy: text("granted_by").notNull(),
    /** What support may look at: { health, devices, cameras, control }. Never includes unlocking. */
    scope: text("scope", { mode: "json" }).$type<Record<string, boolean>>().notNull(),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    endedAt: integer("ended_at"),
    endedBy: text("ended_by", { enum: ["user", "expiry"] }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("support_sessions_idx").on(t.householdId, t.createdAt)],
);

/** Zoho Robotics support staff. Separate from household members: they have no household login, only a token. */
export const operators = sqliteTable("operators", {
  id: text("id").primaryKey(),
  /** Shown in the household's trail, e.g. "ops-114". */
  label: text("label").notNull().unique(),
  tokenHash: text("token_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  revokedAt: integer("revoked_at"),
  lastSeenAt: integer("last_seen_at"),
  /** Tokens do not last forever: after this the operator needs a new one. */
  expiresAt: integer("expires_at"),
});

/** A client's own key for one request, so a double tap or a retry does not run a command twice. */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    /** What the key was first used for, so reusing it for something else is refused. */
    fingerprint: text("fingerprint").notNull(),
    commandId: text("command_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] }), index("idempotency_created_idx").on(t.createdAt)],
);

/** Counters behind the rate limits, kept in the database so a restart does not give everyone a fresh allowance. */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: integer("reset_at").notNull(),
});
