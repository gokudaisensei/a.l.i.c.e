import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createTestDb } from "@/core/database/client";
import { households, users } from "@/core/database/schema";
import { BackupFormatError, packBackup, parseBackupKey, unpackBackup } from "./crypto";
import { DirectoryDestination, UploadDestination, validateNasPath } from "./destinations";
import { applyPendingRestore, pendingRestorePath } from "./restore-apply";
import { inspectDatabase, snapshotDatabase, userTableNames } from "./sqlite-backup";
import { localTime } from "./backup.service";

const tmp = () => mkdtempSync(join(tmpdir(), "alice-bk-unit-"));
const key = () => randomBytes(32);

describe("crypto", () => {
  test("round-trips with and without a key", () => {
    const data = new TextEncoder().encode("hello ".repeat(1000));
    for (const k of [null, key()]) {
      const { bytes, encrypted } = packBackup(data, k);
      expect(encrypted).toBe(!!k);
      expect(Buffer.from(unpackBackup(bytes, k)).equals(Buffer.from(data))).toBe(true);
    }
  });
  test("a wrong key, a missing key, and a tampered file are all refused", () => {
    const k = key();
    const { bytes } = packBackup(new Uint8Array([1, 2, 3, 4]), k);
    expect(() => unpackBackup(bytes, key())).toThrow(BackupFormatError);
    expect(() => unpackBackup(bytes, null)).toThrow(/encrypted/);
    const bad = Buffer.from(bytes); bad[bad.length - 1]! ^= 1;
    expect(() => unpackBackup(bad, k)).toThrow(BackupFormatError);
    expect(() => unpackBackup(new Uint8Array([9, 9, 9]), null)).toThrow(BackupFormatError);
  });
  test("key must be 32 bytes", () => {
    expect(parseBackupKey(null)).toBeNull();
    expect(() => parseBackupKey(Buffer.from("short").toString("base64"))).toThrow();
  });
});

describe("destinations", () => {
  test("write, read, remove; names cannot escape the folder", async () => {
    const d = new DirectoryDestination("local", tmp());
    expect((await d.check()).ok).toBe(true);
    await d.put("a.db.gz", new Uint8Array([1, 2]));
    expect([...(await d.get("a.db.gz"))]).toEqual([1, 2]);
    await d.remove("a.db.gz");
    await expect(d.get("a.db.gz")).rejects.toThrow(/not there/);
    for (const bad of ["../x", "/etc/passwd", "a/b", "..", ""]) await expect(d.put(bad, new Uint8Array([1]))).rejects.toThrow();
  });
  test("an unwritable place is reported, upload is reserved", async () => {
    const f = join(tmp(), "file"); writeFileSync(f, "x");
    expect((await new DirectoryDestination("nas", f).check()).ok).toBe(false);
    expect((await new UploadDestination().check()).ok).toBe(false);
    await expect(new UploadDestination().put()).rejects.toThrow(/not available/);
  });
  test("NAS paths must be absolute and sensible", () => {
    expect(validateNasPath("/mnt/nas/alice")).toBe("/mnt/nas/alice");
    for (const bad of ["relative/dir", "/", "/etc/x", "/mnt/../etc", "/proc"]) expect(() => validateNasPath(bad)).toThrow();
  });
});

function seeded() {
  const db = createTestDb();
  db.insert(users).values({ id: "u1", displayName: "A", createdAt: 1 } as never).run();
  db.insert(households).values({ id: "h1", name: "Home", createdAt: 1 } as never).run();
  return db;
}

describe("snapshot and inspection", () => {
  test("a snapshot of a live database opens and passes", () => {
    const db = seeded();
    const res = inspectDatabase(snapshotDatabase(db), userTableNames(db));
    expect(res).toMatchObject({ ok: true, users: 1, households: 1 });
    expect(res.schemaVersion).toBeGreaterThan(4);
  });
  test("empty, missing tables, garbage and corruption are all caught", () => {
    const db = seeded();
    const names = userTableNames(db);
    expect(inspectDatabase(snapshotDatabase(createTestDb()), names).problems.join()).toMatch(/no users/);
    const s = new Database(":memory:"); s.run("create table t(x)"); const bytes = s.serialize();
    expect(inspectDatabase(bytes, names).problems.join()).toMatch(/Missing tables/);
    expect(inspectDatabase(new Uint8Array(200).fill(7), names).ok).toBe(false);
    const snap = Buffer.from(snapshotDatabase(db));
    for (let i = 4096 * 2; i < Math.min(snap.length, 4096 * 6); i += 97) snap[i] = 0xff;
    expect(inspectDatabase(snap, names).ok).toBe(false);
  });
});

describe("staged restore at start", () => {
  const mk = (path: string, v: string) => { const d = new Database(path, { create: true }); d.run("create table t(v)"); d.run("insert into t values (?)", [v]); d.close(); };
  test("swaps the database in and keeps the old one", () => {
    const dir = tmp(); const p = join(dir, "alice.db");
    mk(p, "old"); mk(pendingRestorePath(p), "restored");
    const r = applyPendingRestore(p, 123);
    expect(r.applied).toBe(true);
    expect(new Database(p).query("select v from t").get()).toEqual({ v: "restored" });
    expect(new Database(`${p}.before-restore-123`).query("select v from t").get()).toEqual({ v: "old" });
    expect(existsSync(pendingRestorePath(p))).toBe(false);
  });
  test("nothing staged does nothing; a corrupt staged file is set aside and the database is untouched", () => {
    const dir = tmp(); const p = join(dir, "alice.db"); mk(p, "old");
    expect(applyPendingRestore(p).applied).toBe(false);
    writeFileSync(pendingRestorePath(p), "not a database at all");
    const r = applyPendingRestore(p, 5);
    expect(r.applied).toBe(false);
    expect(existsSync(`${pendingRestorePath(p)}.rejected-5`)).toBe(true);
    expect(new Database(p).query("select v from t").get()).toEqual({ v: "old" });
  });
});

describe("local time", () => {
  test("uses the household's zone", () => {
    const t = Date.UTC(2026, 0, 15, 21, 0); // 02:30 next day in Asia/Kolkata
    expect(localTime(t, "UTC")).toEqual({ day: "2026-01-15", minutes: 21 * 60 });
    expect(localTime(t, "Asia/Kolkata")).toEqual({ day: "2026-01-16", minutes: 2 * 60 + 30 });
    expect(localTime(t, "Not/AZone").day).toBe("2026-01-15");
  });
});
