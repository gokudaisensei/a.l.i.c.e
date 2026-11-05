import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { users } from "./identity";

export const ROLES = ["admin", "member", "guest"] as const;
export type Role = (typeof ROLES)[number];

export const HOUSEHOLD_MODES = ["home", "away", "night", "vacation"] as const;
export type HouseholdMode = (typeof HOUSEHOLD_MODES)[number];

export const households = sqliteTable("households", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: integer("created_at").notNull(),
});

export const householdMembers = sqliteTable(
  "household_members",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull(),
    /** Time-limited guests. Null means no expiry. */
    expiresAt: integer("expires_at"),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => [unique("household_members_unique").on(t.householdId, t.userId), index("household_members_user_idx").on(t.userId)],
);

export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    role: text("role", { enum: ROLES }).notNull(),
    /** For guest invitations: how long the guest keeps access after joining, in ms. */
    guestAccessMs: integer("guest_access_ms"),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedBy: text("used_by").references(() => users.id),
    usedAt: integer("used_at"),
    revokedAt: integer("revoked_at"),
  },
  (t) => [index("invitations_household_idx").on(t.householdId)],
);

export const householdSettings = sqliteTable("household_settings", {
  householdId: text("household_id").primaryKey().references(() => households.id, { onDelete: "cascade" }),
  mode: text("mode", { enum: HOUSEHOLD_MODES }).notNull().default("home"),
  modeChangedAt: integer("mode_changed_at"),
  modeChangedBy: text("mode_changed_by"),
  settings: text("settings", { mode: "json" }).$type<Record<string, unknown> | null>(),
});
