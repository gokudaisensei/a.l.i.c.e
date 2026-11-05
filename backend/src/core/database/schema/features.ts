import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { households } from "./households";
import { users } from "./identity";

/** A Thing is referenced by its HA ref (`device:<id>` or `entity:<id>`), so favorites and groups survive resyncs and merges. */
export const favorites = sqliteTable(
  "favorites",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    ref: text("ref").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.connectionId, t.ref] })],
);

export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("groups_household_idx").on(t.householdId)],
);

export const groupMembers = sqliteTable(
  "group_members",
  {
    groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    ref: text("ref").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.connectionId, t.ref] })],
);

/** Application-level settings for an entity, kept across resyncs. */
export const entitySettings = sqliteTable(
  "entity_settings",
  {
    connectionId: text("connection_id").notNull(),
    entityId: text("entity_id").notNull(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    powerLimitW: integer("power_limit_w"),
    voiceExposed: integer("voice_exposed", { mode: "boolean" }).notNull().default(false),
    /** Has voice exposure been pushed to Home Assistant's Assist? `none` means never asked. */
    voiceSyncStatus: text("voice_sync_status", { enum: ["none", "pending", "synced", "failed"] }).notNull().default("none"),
    voiceSyncError: text("voice_sync_error"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.entityId] })],
);

export const SYNC_STATUSES = ["not_synced", "pending", "synced", "failed", "drifted"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export interface ActionSpec {
  entityId: string;
  /** Application-level operation, e.g. "turn_on", "set_brightness", "lock". */
  action: string;
  parameters?: Record<string, unknown>;
}

export type RoutineStep =
  | ({ type: "device" } & ActionSpec)
  | { type: "scene"; sceneId: string }
  | { type: "mode"; mode: "home" | "away" | "night" | "vacation" }
  | { type: "delay"; seconds: number };

export const scenes = sqliteTable(
  "scenes",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon"),
    description: text("description"),
    /** Desired changes, all started together when the scene is activated. */
    actions: text("actions", { mode: "json" }).$type<ActionSpec[]>().notNull(),
    createdBy: text("created_by").references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastRunAt: integer("last_run_at"),
    /** The Home Assistant script that mirrors this scene, so it also runs from HA while Alice is down. */
    syncStatus: text("sync_status", { enum: SYNC_STATUSES }).notNull().default("not_synced"),
    syncError: text("sync_error"),
    syncedAt: integer("synced_at"),
    haEntityId: text("ha_entity_id"),
  },
  (t) => [index("scenes_household_idx").on(t.householdId)],
);

export const routines = sqliteTable(
  "routines",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon"),
    /** Ordered steps, run one after another. */
    steps: text("steps", { mode: "json" }).$type<RoutineStep[]>().notNull(),
    onFailure: text("on_failure", { enum: ["continue", "stop"] }).notNull().default("continue"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastRunAt: integer("last_run_at"),
    syncStatus: text("sync_status", { enum: SYNC_STATUSES }).notNull().default("not_synced"),
    syncError: text("sync_error"),
    syncedAt: integer("synced_at"),
    haEntityId: text("ha_entity_id"),
  },
  (t) => [index("routines_household_idx").on(t.householdId)],
);
