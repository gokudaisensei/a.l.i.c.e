import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { COMMAND_STATES } from "@/modules/devices/command-lifecycle";

export const deviceCommands = sqliteTable(
  "device_commands",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    userId: text("user_id").notNull(),
    entityId: text("entity_id").notNull(),
    service: text("service").notNull(), // e.g. light.turn_on
    payload: text("payload", { mode: "json" }),
    state: text("state", { enum: COMMAND_STATES }).notNull().default("pending"),
    failureReason: text("failure_reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("device_commands_household_idx").on(t.householdId), index("device_commands_state_idx").on(t.state)],
);
