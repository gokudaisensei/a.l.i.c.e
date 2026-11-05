import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
