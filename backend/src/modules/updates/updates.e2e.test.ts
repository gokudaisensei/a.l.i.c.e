import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createWorld, homeWithHa, MIN, type World } from "@/testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
const hh = () => w.db.query.households.findFirst().sync()!.id;
const status = async () => (await h.admin.call("GET", "/updates")).json;
const stale = () => { w.clock.now += 6 * MIN; };
let day0 = 0;
const midnight = () => day0;
const restart = (v: string) => { (w.services.updates as any).o.currentVersion = v; };
const offer = (version = "0.2.0", signed = true) => { w.updateFake.latest = { version, notes: "Better things", publishedAt: 1, artifactSha256: "c".repeat(64), signed }; };

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
  w.services.households.update(hh(), { timezone: "UTC" });
  day0 = Math.ceil(w.clock.now / 86_400_000) * 86_400_000;
});

describe("status", () => {
  test("up to date, then ready once a newer version is found; admins are told once", async () => {
    expect(await status()).toMatchObject({ currentVersion: "0.1.0", state: "up_to_date", available: null, settings: { autoUpdate: false, windowStart: "02:00", windowEnd: "04:00" } });
    offer();
    expect((await h.admin.call("POST", "/updates/check")).json).toMatchObject({ state: "ready", available: { version: "0.2.0", notes: "Better things" } });
    await h.admin.call("POST", "/updates/check");
    const n = (await h.admin.call("GET", "/notifications")).json.notifications.filter((x: any) => x.kind === "update_available");
    expect(n).toHaveLength(1);
    w.updateFake.latest = { version: "0.1.0", notes: "", publishedAt: null, artifactSha256: null, signed: true };
    expect((await h.admin.call("POST", "/updates/check")).json.state).toBe("up_to_date");
  });
  test("a source that fails is reported, not thrown", async () => {
    w.updateFake.sourceError = new Error("manifest down");
    expect((await h.admin.call("POST", "/updates/check")).json).toMatchObject({ state: "up_to_date", checkError: "manifest down" });
  });
  test("only admins", async () => {
    const m = await h.join("Mia", { role: "member" });
    expect((await m.call("GET", "/updates")).status).toBe(403);
  });
});

describe("installing", () => {
  test("outside the window installing is refused; scheduling waits for the window, backs up, requests, and finishes when the new version runs", async () => {
    offer(); await h.admin.call("POST", "/updates/check");
    w.clock.now = midnight() + 60 * MIN; // 01:00
    await h.admin.login(); await h.admin.stepUp();
    expect((await h.admin.call("POST", "/updates/install")).json.error.code).toBe("outside_window");
    const sch = (await h.admin.call("POST", "/updates/schedule")).json;
    expect(sch).toMatchObject({ status: "scheduled", trigger: "manual", version: "0.2.0", scheduledFor: midnight() + 120 * MIN });
    expect((await status()).state).toBe("scheduled");
    expect((await h.admin.call("POST", "/updates/schedule")).json.error.code).toBe("update_in_progress");

    await w.services.updates.tick();
    expect(w.updateFake.requested).toEqual([]); // window not open yet
    w.clock.now = midnight() + 125 * MIN;
    await w.services.updates.tick();
    expect(w.updateFake.requested).toEqual(["0.2.0"]);
    expect((await status()).state).toBe("installing");
    const rec = w.services.updates.history(hh())[0]!;
    expect(rec.status).toBe("installing");
    expect(w.services.backups.list(hh()).some((b) => b.kind === "app" && b.status === "ok")).toBe(true);

    restart("0.2.0"); // the server came back as the new version
    await w.services.updates.tick();
    expect(w.services.updates.history(hh())[0]).toMatchObject({ status: "done" });
    expect((await h.admin.call("GET", "/updates")).json.state).toBe("up_to_date");
  });

  test("installing inside the window starts at once", async () => {
    offer(); await h.admin.call("POST", "/updates/check");
    w.clock.now = midnight() + 150 * MIN;
    await h.admin.login(); await h.admin.stepUp();
    expect((await h.admin.call("POST", "/updates/install")).json).toMatchObject({ status: "installing", trigger: "manual" });
    expect(w.updateFake.requested).toEqual(["0.2.0"]);
  });

  test("needs step-up; nothing to install is refused; a scheduled update can be cancelled", async () => {
    stale();
    expect((await h.admin.call("POST", "/updates/schedule")).json.error.code).toBe("step_up_required");
    await h.admin.stepUp();
    expect((await h.admin.call("POST", "/updates/schedule")).json.error.code).toBe("no_update");
    offer(); await h.admin.call("POST", "/updates/check");
    const s = (await h.admin.call("POST", "/updates/schedule")).json;
    expect((await h.admin.call("POST", `/updates/${s.id}/cancel`)).json.status).toBe("cancelled");
    expect((await h.admin.call("POST", `/updates/${s.id}/cancel`)).json.error.code).toBe("not_cancellable");
    expect((await status()).state).toBe("ready");
  });

  test("a failed safety backup or request fails the update, changes nothing and tells admins", async () => {
    offer(); await h.admin.call("POST", "/updates/check");
    w.clock.now = midnight() + 150 * MIN;
    await h.admin.login(); await h.admin.stepUp();
    w.updateFake.installError = new Error("no supervisor");
    const r = (await h.admin.call("POST", "/updates/install")).json;
    expect(r).toMatchObject({ status: "failed", error: expect.stringMatching(/no supervisor/) });
    expect((await h.admin.call("GET", "/notifications")).json.notifications.some((n: any) => n.kind === "update_failed")).toBe(true);
    expect((await h.admin.call("GET", "/admin/health")).json.checks.find((c: any) => c.name === "updates").status).toBe("warn");
    expect((await status()).state).toBe("ready"); // can try again
  });

  test("an install that never comes back as the new version times out", async () => {
    offer(); await h.admin.call("POST", "/updates/check");
    w.clock.now = midnight() + 150 * MIN;
    await h.admin.login(); await h.admin.stepUp();
    await h.admin.call("POST", "/updates/install");
    w.clock.now += 31 * MIN;
    await w.services.updates.tick();
    expect(w.services.updates.history(hh())[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/in time/) });
  });
});

describe("automatic updates", () => {
  test("off by default; when on, installs a new version inside the window only", async () => {
    offer();
    w.clock.now = midnight() + 150 * MIN;
    await w.services.updates.tick();
    expect(w.updateFake.requested).toEqual([]); // off
    w.services.updates.updateSettings(hh(), "x", { autoUpdate: true });
    w.clock.now = midnight() + 12 * 60 * MIN;
    await w.services.updates.tick();
    expect(w.updateFake.requested).toEqual([]); // noon
    w.clock.now = midnight() + 24 * 60 * MIN + 130 * MIN;
    await w.services.updates.tick();
    expect(w.updateFake.requested).toEqual(["0.2.0"]);
    expect(w.services.updates.history(hh())[0]).toMatchObject({ trigger: "auto", status: "installing" });
  });

  test("settings are validated, need step-up and are audited; the window follows the household's time zone", async () => {
    stale();
    expect((await h.admin.call("PUT", "/updates/settings", { autoUpdate: true })).json.error.code).toBe("step_up_required");
    await h.admin.stepUp();
    expect((await h.admin.call("PUT", "/updates/settings", { windowStart: "9:00" })).json.error.code).toBe("validation_error");
    expect((await h.admin.call("PUT", "/updates/settings", { windowStart: "03:00", windowEnd: "03:00" })).json.error.code).toBe("validation_error");
    expect((await h.admin.call("PUT", "/updates/settings", { autoUpdate: true, windowStart: "23:00", windowEnd: "01:00" })).json).toMatchObject({ autoUpdate: true, windowStart: "23:00", windowEnd: "01:00" });
    expect((await h.admin.call("GET", "/admin/audit?action=update.")).json.items.map((i: any) => i.action)).toContain("update.settings");
    w.services.households.update(hh(), { timezone: "Asia/Kolkata" });
    w.services.updates.updateSettings(hh(), "x", { windowStart: "02:00", windowEnd: "04:00" });
    w.clock.now = Date.UTC(2026, 0, 15, 21, 0); // 02:30 in Kolkata
    await h.admin.login();
    expect((await status()).inWindow).toBe(true);
  });
});

describe("emergency deploy", () => {
  test("skips the window but needs a reason, the word, a passkey; it is audited and announced", async () => {
    offer(); await h.admin.call("POST", "/updates/check");
    w.clock.now = midnight() + 12 * 60 * MIN; // noon
    await h.admin.login();
    stale();
    const body = { reason: "Security fix for the lock bug", confirmation: "DEPLOY" };
    expect((await h.admin.call("POST", "/updates/emergency", body)).json.error.code).toBe("step_up_required");
    await h.admin.stepUp();
    expect((await h.admin.call("POST", "/updates/emergency", { ...body, reason: "short" })).json.error.code).toBe("reason_required");
    expect((await h.admin.call("POST", "/updates/emergency", { ...body, confirmation: "deploy" })).json.error.code).toBe("confirmation_required");
    expect(w.updateFake.requested).toEqual([]);
    const r = (await h.admin.call("POST", "/updates/emergency", body)).json;
    expect(r).toMatchObject({ status: "installing", trigger: "emergency", reason: "Security fix for the lock bug" });
    expect(w.updateFake.requested).toEqual(["0.2.0"]);
    const a = (await h.admin.call("GET", "/admin/audit?action=update.")).json.items.find((i: any) => i.action === "update.emergency");
    expect(a.detail).toMatchObject({ reason: "Security fix for the lock bug", to: "0.2.0" });
    expect((await h.admin.call("GET", "/notifications")).json.notifications.some((n: any) => n.kind === "update_emergency")).toBe(true);
  });
});

describe("unsigned updates", () => {
  test("are shown but not installable, scheduled or automatic, unless the operator allows it", async () => {
    offer("0.2.0", false); await h.admin.call("POST", "/updates/check");
    expect(await status()).toMatchObject({ state: "ready", installable: false, available: { signed: false } });
    w.clock.now = midnight() + 150 * MIN;
    await h.admin.login(); await h.admin.stepUp();
    expect((await h.admin.call("POST", "/updates/schedule")).json.error.code).toBe("unsigned_update");
    expect((await h.admin.call("POST", "/updates/install")).json.error.code).toBe("unsigned_update");
    expect((await h.admin.call("POST", "/updates/emergency", { reason: "Security fix for the lock", confirmation: "DEPLOY" })).json.error.code).toBe("unsigned_update");
    w.services.updates.updateSettings(hh(), "x", { autoUpdate: true });
    await w.services.updates.tick();
    expect(w.updateFake.requested).toEqual([]);
    (w.services.updates as any).o.allowUnsigned = true;
    expect((await h.admin.call("POST", "/updates/install")).json.status).toBe("installing");
  });
  test("the artifact checksum is handed to whatever installs it", async () => {
    offer(); await h.admin.call("POST", "/updates/check");
    w.clock.now = midnight() + 150 * MIN;
    const seen: unknown[] = [];
    (w.services.updates as any).o.installer = { request: async (...a: unknown[]) => { seen.push(a); } };
    await h.admin.login(); await h.admin.stepUp();
    await h.admin.call("POST", "/updates/install");
    expect(seen).toEqual([["0.2.0", "install", "c".repeat(64)]]);
  });
});

describe("Home Assistant safety backup", () => {
  const ready = async () => { w.clock.now = midnight() + 150 * MIN; await h.admin.login(); await h.admin.stepUp(); await h.withAdminToken(); await w.sync(); offer(); await h.admin.call("POST", "/updates/check"); };
  test("when Home Assistant can be asked, the install waits for its backup, then goes ahead", async () => {
    await ready();
    const r = (await h.admin.call("POST", "/updates/install")).json;
    const haId = r.haBackupId as string; // read before asserting (toMatchObject with matchers overwrites fields)
    expect(r).toMatchObject({ status: "preparing", backupId: expect.any(String), haBackupId: expect.any(String) });
    expect(w.updateFake.requested).toEqual([]);
    await w.services.updates.tick();
    expect(w.updateFake.requested).toEqual([]); // Home Assistant has not finished
    await w.sync(); await w.sync();
    await w.services.updates.tick();
    expect(w.updateFake.requested).toEqual(["0.2.0"]);
    expect(w.services.updates.history(hh())[0]).toMatchObject({ status: "installing" });
    expect(w.services.backups.get(hh(), haId)).toMatchObject({ kind: "ha", status: "ok" });
  });
  test("if Home Assistant's backup fails, nothing is changed", async () => {
    await ready();
    const { httpError } = await import("@/testing/fake-config-api");
    w.configApi.failWith = httpError(500);
    await h.admin.call("POST", "/updates/install");
    await w.sync(); await w.sync(); await w.sync(); await w.sync();
    await w.services.updates.tick();
    expect(w.services.updates.history(hh())[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/Home Assistant's safety backup failed/) });
    expect(w.updateFake.requested).toEqual([]);
  });
  test("one that never finishes times out; an emergency does not wait for it", async () => {
    await ready();
    await h.admin.call("POST", "/updates/install");
    w.clock.now += 11 * MIN;
    await w.services.updates.tick();
    expect(w.services.updates.history(hh())[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/did not finish in time/) });
    await w.sync(); // the worker checks in again
    await h.admin.login(); await h.admin.stepUp();
    const e = (await h.admin.call("POST", "/updates/emergency", { reason: "Security fix for the lock", confirmation: "DEPLOY" })).json;
    expect(e).toMatchObject({ status: "installing", haBackupId: expect.any(String) });
  });
});

describe("rollback", () => {
  const failedInstall = async () => {
    offer(); await h.admin.call("POST", "/updates/check");
    w.clock.now = midnight() + 150 * MIN;
    await h.admin.login(); await h.admin.stepUp();
    return (await h.admin.call("POST", "/updates/install")).json;
  };
  test("a timed-out install asks for the old version back by itself, and is not retried automatically", async () => {
    w.services.updates.updateSettings(hh(), "x", { autoUpdate: true });
    offer(); w.clock.now = midnight() + 150 * MIN;
    await w.services.updates.tick();
    expect(w.updateFake.requested).toEqual(["0.2.0"]);
    w.clock.now += 31 * MIN;
    const calls: unknown[] = [];
    (w.services.updates as any).o.installer = { request: async (...a: unknown[]) => { calls.push(a); } };
    await w.services.updates.tick();
    await Bun.sleep(10);
    expect(calls).toEqual([["0.1.0", "rollback"]]);
    expect(w.services.updates.history(hh())[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/return to 0\.1\.0 was requested/) });
    // still inside the next night's window: it is not tried again by itself
    w.clock.now = midnight() + 24 * 60 * MIN + 130 * MIN;
    await w.services.updates.tick();
    expect(w.services.updates.history(hh())).toHaveLength(1);
  });
  test("manual rollback needs step-up, requests the old version, and can also stage the data restore", async () => {
    const u = await failedInstall();
    const calls: unknown[] = [];
    (w.services.updates as any).o.installer = { request: async (...a: unknown[]) => { calls.push(a); } };
    stale();
    expect((await h.admin.call("POST", `/updates/${u.id}/rollback`, {})).json.error.code).toBe("step_up_required");
    await h.admin.stepUp();
    const r = (await h.admin.call("POST", `/updates/${u.id}/rollback`, {})).json;
    expect(r).toMatchObject({ rolledBack: true, toVersion: "0.1.0", dataRestoreStaged: false, update: { status: "rolled_back" } });
    expect(calls).toEqual([["0.1.0", "rollback"]]);
    expect((await h.admin.call("POST", `/updates/${u.id}/rollback`, {})).json.error.code).toBe("not_rollbackable");
  });
  test("with restoreData the safety backup is staged to replace the database at the next start", async () => {
    const u = await failedInstall();
    const dbFile = join(w.backupDir, "alice.db");
    (w.services.backups as any).o.dbPath = dbFile;
    const r = (await h.admin.call("POST", `/updates/${u.id}/rollback`, { restoreData: true })).json;
    expect(r).toMatchObject({ rolledBack: true, dataRestoreStaged: true });
    expect(existsSync(`${dbFile}.restore-pending`)).toBe(true);
    expect((await h.admin.call("GET", "/admin/audit?action=update.")).json.items.filter((i: any) => i.action === "update.rolled_back")).toHaveLength(1);
  });
  test("an update that never started has nothing to roll back", async () => {
    offer(); await h.admin.call("POST", "/updates/check");
    const s = (await h.admin.call("POST", "/updates/schedule")).json;
    expect((await h.admin.call("POST", `/updates/${s.id}/rollback`, {})).json.error.code).toBe("not_rollbackable");
  });
});
