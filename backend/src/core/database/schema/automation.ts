import { index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { SYNC_STATUSES } from "./features";
import { households } from "./households";
import { users } from "./identity";

/** A routine run, kept so progress survives restarts and a run waiting in a delay can continue. */
export const routineRuns = sqliteTable(
  "routine_runs",
  {
    id: text("id").primaryKey(),
    /** Not a foreign key: the history outlives a deleted routine. */
    routineId: text("routine_id").notNull(),
    routineName: text("routine_name").notNull(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    state: text("state", { enum: ["running", "completed", "failed", "stopped", "cancelled"] }).notNull(),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    /** Each step's definition (a snapshot, so later edits do not change a run in flight) and its progress. */
    steps: text("steps", { mode: "json" }).$type<unknown[]>().notNull(),
    onFailure: text("on_failure", { enum: ["continue", "stop"] }).notNull().default("continue"),
    /** Index of the step being run or waited on. */
    nextStep: integer("next_step").notNull().default(0),
    /** When a delay step ends; lets a restart carry on waiting. */
    resumeAt: integer("resume_at"),
    /** Until when the starter's passkey confirmation covers steps. */
    stepUpUntil: integer("step_up_until").notNull().default(0),
    cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("routine_runs_household_idx").on(t.householdId, t.startedAt), index("routine_runs_state_idx").on(t.state)],
);

export const CONFIG_JOB_STATUSES = ["pending", "running", "done", "failed"] as const;

/**
 * Work for the config-worker, the only process that holds the Home Assistant admin token.
 * The main process validates and enqueues; the worker executes a fixed set of operations and records the result.
 */
export const configJobs = sqliteTable(
  "config_jobs",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    operation: text("operation").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    /** A newer job with the same key replaces older pending ones (only the latest version of a script matters). */
    dedupeKey: text("dedupe_key"),
    status: text("status", { enum: CONFIG_JOB_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: integer("run_after").notNull(),
    result: text("result", { mode: "json" }).$type<Record<string, unknown> | null>(),
    error: text("error"),
    requestedBy: text("requested_by"),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    /** Set once the main process has applied the result to the scene/routine/automation it belongs to. */
    appliedAt: integer("applied_at"),
  },
  (t) => [index("config_jobs_status_idx").on(t.status, t.runAfter), index("config_jobs_dedupe_idx").on(t.dedupeKey)],
);

export const configWorkerHeartbeat = sqliteTable("config_worker_heartbeat", {
  name: text("name").primaryKey(),
  lastSeenAt: integer("last_seen_at").notNull(),
  info: text("info", { mode: "json" }).$type<Record<string, unknown> | null>(),
});

export const automations = sqliteTable(
  "automations",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Alice's own versioned format. Compiled into a Home Assistant automation. */
    definition: text("definition", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    syncStatus: text("sync_status", { enum: SYNC_STATUSES }).notNull().default("not_synced"),
    syncError: text("sync_error"),
    syncedAt: integer("synced_at"),
    haEntityId: text("ha_entity_id"),
    /** Hash of the Home Assistant config last queued for this automation. When what we would compile now differs (a new person, a new power limit), it is sent again. */
    compiledHash: text("compiled_hash"),
    lastTriggeredAt: integer("last_triggered_at"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("automations_household_idx").on(t.householdId)],
);

export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    triggeredAt: integer("triggered_at").notNull(),
    /** What fired it, as Home Assistant reported it (trigger kind), when known. */
    source: text("source"),
  },
  (t) => [index("automation_runs_idx").on(t.automationId, t.triggeredAt)],
);

export const alerts = sqliteTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["power_limit"] }).notNull(),
    connectionId: text("connection_id").notNull(),
    entityId: text("entity_id").notNull(),
    thingRef: text("thing_ref").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    /** Numbers behind the alert, e.g. { watts, limitW, percent }. */
    data: text("data", { mode: "json" }).$type<Record<string, unknown> | null>(),
    createdAt: integer("created_at").notNull(),
    clearedAt: integer("cleared_at"),
    ackedBy: text("acked_by"),
    ackedAt: integer("acked_at"),
  },
  (t) => [index("alerts_household_idx").on(t.householdId, t.clearedAt)],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, unknown> | null>(),
    /** Urgent notifications are pushed even during quiet hours. */
    urgent: integer("urgent", { mode: "boolean" }).notNull().default(false),
    /** What happened when we tried to push it to the person's phones. */
    pushStatus: text("push_status", { enum: ["none", "sent", "suppressed", "failed"] }).notNull().default("none"),
    createdAt: integer("created_at").notNull(),
    readAt: integer("read_at"),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

/** "Not now" for a suggestion, until a time. */
export const insightDismissals = sqliteTable(
  "insight_dismissals",
  {
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    until: integer("until").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.key] })],
);

/** A phone, browser or app that can receive push notifications for a person. */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["webpush", "fcm"] }).notNull(),
    /** Web Push: the subscription endpoint URL. FCM: the device registration token. */
    token: text("token").notNull(),
    /** Web Push only: { p256dh, auth }. */
    keys: text("keys", { mode: "json" }).$type<{ p256dh: string; auth: string } | null>(),
    label: text("label"),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId), unique("push_subscriptions_unique").on(t.userId, t.platform, t.token)],
);

/** Which Home Assistant person is which household member, so "who is home" is about Alice's people. */
export const personLinks = sqliteTable(
  "person_links",
  {
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    personEntityId: text("person_entity_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] }), unique("person_links_person_unique").on(t.householdId, t.connectionId, t.personEntityId)],
);
