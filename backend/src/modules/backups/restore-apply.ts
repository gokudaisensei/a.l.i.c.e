import { Database } from "bun:sqlite";
import { existsSync, renameSync, rmSync } from "node:fs";

export const pendingRestorePath = (dbPath: string) => `${dbPath}.restore-pending`;

/**
 * Called at startup, before the database is opened. If a restore was staged (`POST /backups/:id/restore`), checks it is
 * sound, keeps the current database next to it as `.before-restore-<time>`, and swaps the restored one in.
 * A staged file that fails its check is moved aside and ignored, so a bad restore can never stop the server from starting.
 */
export function applyPendingRestore(dbPath: string, now = Date.now()): { applied: boolean; detail: string } {
  const pending = pendingRestorePath(dbPath);
  if (!existsSync(pending)) return { applied: false, detail: "nothing staged" };
  let ok = false;
  try {
    const db = new Database(pending, { readonly: true });
    ok = (db.query("pragma integrity_check").get() as { integrity_check: string }).integrity_check === "ok";
    db.close();
  } catch { ok = false; }
  if (!ok) {
    renameSync(pending, `${pending}.rejected-${now}`);
    return { applied: false, detail: "the staged restore failed its check and was set aside" };
  }
  const keep = `${dbPath}.before-restore-${now}`;
  if (existsSync(dbPath)) renameSync(dbPath, keep);
  for (const ext of ["-wal", "-shm"]) rmSync(`${dbPath}${ext}`, { force: true });
  renameSync(pending, dbPath);
  return { applied: true, detail: `restored; the previous database is kept at ${keep}` };
}
