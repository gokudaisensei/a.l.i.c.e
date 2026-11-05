import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "@/core/database/client";

export interface Inspection {
  ok: boolean;
  /** Plain-language reasons it is not usable. */
  problems: string[];
  tables: string[];
  users: number;
  households: number;
  schemaVersion: number | null;
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "alice-backup-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const raw = (db: Db) => (db as unknown as { $client: Database }).$client;

/** How many migrations this database has applied. */
export function schemaVersion(db: Database): number | null {
  try { return (db.query("select count(*) as n from __drizzle_migrations").get() as { n: number }).n; } catch { return null; }
}

export const currentSchemaVersion = (db: Db) => schemaVersion(raw(db));

/** A consistent copy of the live database (safe while it is being written to), as bytes. */
export function snapshotDatabase(db: Db): Uint8Array {
  return withTempDir((dir) => {
    const file = join(dir, "snapshot.db");
    raw(db).run(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    return new Uint8Array(readFileSync(file));
  });
}

/** Opens a backup read-only and checks it is a sound, recognisable Alice database. */
export function inspectDatabase(bytes: Uint8Array, expectedTables: string[]): Inspection {
  return withTempDir((dir) => {
    const file = join(dir, "check.db");
    writeFileSync(file, bytes);
    const problems: string[] = [];
    let db: Database | null = null;
    try {
      db = new Database(file, { readonly: true });
      const integrity = (db.query("pragma integrity_check").all() as { integrity_check: string }[]).map((r) => r.integrity_check);
      if (integrity.length !== 1 || integrity[0] !== "ok") problems.push(`The database is damaged (${integrity.slice(0, 2).join("; ")})`);
      const tables = (db.query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
      const missing = expectedTables.filter((t) => !tables.includes(t));
      if (missing.length) problems.push(`Missing tables: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`);
      const count = (t: string) => { try { return (db!.query(`select count(*) as n from ${t}`).get() as { n: number }).n; } catch { return 0; } };
      const users = count("users");
      const hh = count("households");
      if (!users || !hh) problems.push("The backup has no users or no household in it");
      return { ok: problems.length === 0, problems, tables, users, households: hh, schemaVersion: schemaVersion(db) };
    } catch (e) {
      return { ok: false, problems: [`It could not be opened as a database (${e instanceof Error ? e.message : String(e)})`], tables: [], users: 0, households: 0, schemaVersion: null };
    } finally {
      db?.close();
    }
  });
}

export function userTableNames(db: Db): string[] {
  return (raw(db).query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != '__drizzle_migrations'").all() as { name: string }[]).map((r) => r.name);
}
