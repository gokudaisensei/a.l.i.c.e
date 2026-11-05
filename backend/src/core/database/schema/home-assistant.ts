import { index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { households } from "./households";
import { users } from "./identity";

export const haConnections = sqliteTable(
  "ha_connections",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    /** AES-256-GCM, see core/security/secrets.ts. */
    operationalTokenEnc: text("operational_token_enc").notNull(),
    /** Stored for the config-worker; nothing in the main process decrypts it. */
    adminTokenEnc: text("admin_token_enc"),
    status: text("status", { enum: ["disconnected", "connecting", "connected", "reconnecting", "auth_failed"] }).notNull().default("disconnected"),
    lastConnectedAt: integer("last_connected_at"),
    lastError: text("last_error"),
    haVersion: text("ha_version"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("ha_connections_household_idx").on(t.householdId)],
);

/** User changes to a Thing, keyed by `device:<haDeviceId>` or `entity:<entityId>` (HA ids, so they survive a resync). */
export const thingOverrides = sqliteTable(
  "thing_overrides",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    ref: text("ref").notNull(),
    displayName: text("display_name"),
    hidden: integer("hidden", { mode: "boolean" }),
    areaId: text("area_id"),
    updatedBy: text("updated_by").references(() => users.id),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [unique("thing_overrides_unique").on(t.connectionId, t.ref)],
);

export const entityOverrides = sqliteTable(
  "entity_overrides",
  {
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    entityId: text("entity_id").notNull(),
    role: text("role", { enum: ["primary", "control", "facet", "sensor", "diagnostic", "config"] }),
    displayName: text("display_name"),
    attachTo: text("attach_to"),
    hidden: integer("hidden", { mode: "boolean" }),
    /** For facets: what "on" means (e.g. "closed"). */
    onMeans: text("on_means"),
    updatedBy: text("updated_by").references(() => users.id),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.entityId] })],
);

/** Manual merges of Things and splits of entities out of their device's Thing. */
export const thingLinks = sqliteTable(
  "thing_links",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    kind: text("kind", { enum: ["merge", "split"] }).notNull(),
    /** merge: the Thing refs to join (first keeps its id). */
    refs: text("refs", { mode: "json" }).$type<string[] | null>(),
    /** split: the entity to move out. */
    entityId: text("entity_id"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("thing_links_connection_idx").on(t.connectionId)],
);
