import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { env } from "@/config/env";
import * as schema from "./schema";

if (env.databaseUrl !== ":memory:") mkdirSync(dirname(env.databaseUrl), { recursive: true });

const sqlite = new Database(env.databaseUrl, { create: true });
sqlite.run("PRAGMA journal_mode = WAL;");
sqlite.run("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;
