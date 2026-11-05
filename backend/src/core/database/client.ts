import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

export const MIGRATIONS_FOLDER = new URL("../../../drizzle", import.meta.url).pathname;

/** Opens a SQLite database (WAL, foreign keys on). Use ":memory:" for tests. */
export function createDb(url: string) {
  if (url !== ":memory:") mkdirSync(dirname(url), { recursive: true });
  const sqlite = new Database(url, { create: true });
  sqlite.run("PRAGMA journal_mode = WAL;");
  sqlite.run("PRAGMA foreign_keys = ON;");
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;

export function runMigrations(db: Db) {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Fresh, fully migrated in-memory database. */
export function createTestDb(): Db {
  const db = createDb(":memory:");
  runMigrations(db);
  return db;
}
