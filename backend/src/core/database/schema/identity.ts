import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  avatarColor: integer("avatar_color").notNull().default(1),
  locale: text("locale").notNull().default("en"),
  createdAt: integer("created_at").notNull(),
});

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  quietHours: text("quiet_hours", { mode: "json" }).$type<{ enabled: boolean; from?: string; to?: string } | null>(),
  pushEnabled: integer("push_enabled", { mode: "boolean" }).notNull().default(true),
  extra: text("extra", { mode: "json" }).$type<Record<string, unknown> | null>(),
});

export const passkeys = sqliteTable(
  "passkeys",
  {
    id: text("id").primaryKey(), // WebAuthn credential id (base64url)
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(), // base64url COSE key
    counter: integer("counter").notNull().default(0),
    transports: text("transports", { mode: "json" }).$type<string[] | null>(),
    deviceLabel: text("device_label"),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [index("passkeys_user_idx").on(t.userId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    revokedAt: integer("revoked_at"),
    userAgent: text("user_agent"),
    /** Time of the last fresh passkey assertion on this session; backs step-up checks. */
    lastStepUpAt: integer("last_step_up_at"),
    /** Recovery-code sessions may only add a passkey until one is registered. */
    restricted: integer("restricted", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const recoveryCodes = sqliteTable(
  "recovery_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("recovery_codes_user_idx").on(t.userId)],
);

export const webauthnChallenges = sqliteTable("webauthn_challenges", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  challenge: text("challenge").notNull(),
  purpose: text("purpose", { enum: ["register", "login", "step_up", "add_passkey"] }).notNull(),
  /** Context carried to the verify step (display name, invite id, intended user id). */
  data: text("data", { mode: "json" }).$type<Record<string, unknown> | null>(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
});
