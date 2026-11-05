import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { households } from "./households";
import { users } from "./identity";

/** Device-level allow/deny on top of role permissions. Entities are referenced by HA id strings, not row ids. */
export const devicePolicies = sqliteTable(
  "device_policies",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    entityId: text("entity_id").notNull(),
    subjectType: text("subject_type", { enum: ["role", "member"] }).notNull(),
    /** A role name, or a user id for `member`. */
    subjectId: text("subject_id").notNull(),
    effect: text("effect", { enum: ["allow", "deny"] }).notNull(),
    /** Limit the policy to these operations; null means all. */
    operations: text("operations", { mode: "json" }).$type<string[] | null>(),
    createdBy: text("created_by").references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("device_policies_household_idx").on(t.householdId, t.entityId)],
);

/** Admin changes to which device operations need step-up; code defaults apply when no row matches. */
export const sensitiveOperationRules = sqliteTable(
  "sensitive_operation_rules",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    action: text("action").notNull(),
    /** Empty string matches any device class. */
    deviceClass: text("device_class").notNull().default(""),
    sensitive: integer("sensitive", { mode: "boolean" }).notNull(),
    updatedBy: text("updated_by").references(() => users.id),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [unique("sensitive_rules_unique").on(t.householdId, t.domain, t.action, t.deviceClass)],
);
