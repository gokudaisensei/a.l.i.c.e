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
