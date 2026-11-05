import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createWorld, homeWithHa, MIN, type World } from "@/testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
const files = () => readdirSync(w.backupDir);
const list = async () => (await h.admin.call("GET", "/backups")).json;
const hhId = () => w.db.query.households.findFirst().sync()!.id;
const userId = () => w.db.query.users.findFirst().sync()!.id;
/** A passkey confirmation counts for 5 minutes, and a fresh registration counts as one. */
const stale = () => { w.clock.now += 6 * MIN; };

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("Alice's own backups", () => {
  test("a manual backup is encrypted, checksummed, verified, and listed", async () => {
    const r = await h.admin.call("POST", "/backups", { what: "app" });
    expect(r.status).toBe(200);
    const b = r.json.items[0];
    expect(b).toMatchObject({ kind: "app", status: "ok", encrypted: true, trigger: "manual", downloadable: true });
    expect(files()).toHaveLength(1);
    expect(files()[0]).toMatch(/\.db\.enc$/);
    const v = await h.admin.call("POST", `/backups/${b.id}/verify`);
    expect(v.json.verify).toMatchObject({ status: "passed", note: expect.stringMatching(/1 user/) });
    expect((await list()).items).toHaveLength(1);
  });

  test("verify catches a file that was changed or removed afterwards", async () => {
    const b = (await h.admin.call("POST", "/backups", { what: "app" })).json.items[0];
    const f = join(w.backupDir, files()[0]!);
    writeFileSync(f, Buffer.concat([Buffer.from(await Bun.file(f).arrayBuffer()), Buffer.from("x")]));
    const v = (await h.admin.call("POST", `/backups/${b.id}/verify`)).json;
    expect(v.verify.status).toBe("failed");
    expect(v.verify.note).toMatch(/checksum/);
    const n = (await h.admin.call("GET", "/notifications")).json;
    expect(JSON.stringify(n.notifications)).toMatch(/restore test/);
    await Bun.$`rm ${f}`;
    expect((await h.admin.call("POST", `/backups/${b.id}/verify`)).json.verify.status).toBe("failed");
  });

  test("restore, delete and download need a recent passkey confirmation; restore also needs the word", async () => {
    const b = (await h.admin.call("POST", "/backups", { what: "app" })).json.items[0];
    stale();
    for (const [m, p, body] of [["GET", `/backups/${b.id}/download`], ["DELETE", `/backups/${b.id}`], ["POST", `/backups/${b.id}/restore`, { confirm: "RESTORE" }], ["PUT", "/backups/settings", { keep: 3 }]] as const) {
      const r = await h.admin.call(m, p, body);
      expect([m, p, r.status, r.json?.error?.code]).toEqual([m, p, 403, "step_up_required"]);
    }
    await h.admin.stepUp();
    expect((await h.admin.call("POST", `/backups/${b.id}/restore`, { confirm: "yes" })).json.error.code).toBe("confirmation_required");
    // in-memory test databases cannot stage a restore
    expect((await h.admin.call("POST", `/backups/${b.id}/restore`, { confirm: "RESTORE" })).json.error.code).toBe("not_available");
    const dl = await h.admin.raw("GET", `/backups/${b.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toMatch(/attachment/);
    const del = await h.admin.call("DELETE", `/backups/${b.id}`);
    expect(del.json).toEqual({ removed: true });
    expect(files()).toHaveLength(0);
    expect((await list()).items).toHaveLength(0);
  });

  test("only admins can see or make backups", async () => {
    const member = await h.join("Mia", { role: "member" });
    expect((await member.call("GET", "/backups")).status).toBe(403);
    expect((await member.call("POST", "/backups", {})).status).toBe(403);
  });

  test("settings are validated; NAS needs a writable absolute folder; upload is not available", async () => {
    stale(); await h.admin.stepUp();
    const put = (b: object) => h.admin.call("PUT", "/backups/settings", b);
    expect((await put({ time: "25:00" })).json.error.code).toBe("validation_error");
    expect((await put({ destination: "nas" })).json.error.code).toBe("validation_error");
    expect((await put({ destination: "nas", nasPath: "relative" })).json.error.code).toBe("validation_error");
    expect((await put({ destination: "upload" })).status).toBe(501);
    const nas = join(w.backupDir, "nas");
    const ok = await put({ destination: "nas", nasPath: nas, keep: 5, time: "03:15" });
    expect(ok.json).toMatchObject({ destination: "nas", nasPath: nas, keep: 5, time: "03:15" });
    const b = (await h.admin.call("POST", "/backups", { what: "app" })).json.items[0];
    expect(b.destination).toBe("nas");
    expect(readdirSync(nas)).toHaveLength(1);
    expect((await h.admin.call("GET", "/admin/audit?action=backup.")).json.items.map((i: any) => i.action)).toContain("backup.settings");
  });

  test("a destination that stops working fails the backup and tells admins", async () => {
    const blocker = join(w.backupDir, "blocker"); writeFileSync(blocker, "x");
    await w.services.backups.updateSettings(hhId(), userId(), { destination: "nas", nasPath: join(w.backupDir, "n2") });
    w.services.backups["save"](hhId(), { ...w.services.backups.settings(hhId()), nasPath: blocker });
    const r = (await h.admin.call("POST", "/backups", { what: "app" })).json.items[0];
    expect(r).toMatchObject({ status: "failed", error: expect.stringMatching(/not a folder/) });
    expect((await h.admin.call("GET", "/notifications")).json.notifications.some((n: any) => n.kind === "backup_failed")).toBe(true);
    expect((await h.admin.call("GET", "/admin/health")).json.checks.find((c: any) => c.name === "backups").status).toBe("warn");
  });
});

describe("schedule", () => {
  test("runs once per local day at the set time, verifies, and keeps only the newest N", async () => {
    await w.services.backups.updateSettings(hhId(), userId(), { keep: 2, time: "02:30", includeHa: false });
    w.services.households.update(hhId(), { timezone: "UTC" });
    const midnight = Math.ceil(w.clock.now / 86_400_000) * 86_400_000;
    w.clock.now = midnight + 60 * MIN; // 01:00, too early
    expect(await w.services.backups.tick()).toBe(0);
    for (let day = 0; day < 4; day++) {
      w.clock.now = midnight + day * 86_400_000 + 150 * MIN + 5 * MIN;
      expect(await w.services.backups.tick()).toBe(1);
      expect(await w.services.backups.tick()).toBe(0); // not twice in a day
      await new Promise((r) => setTimeout(r, 20));
    }
    const items = w.services.backups.list(hhId()).filter((i) => i.kind === "app");
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.trigger === "scheduled" && i.verify.status === "passed")).toBe(true);
    expect(files()).toHaveLength(2);
  });

  test("a missed time is caught up, and disabled means never", async () => {
    w.services.households.update(hhId(), { timezone: "UTC" });
    const midnight = Math.ceil(w.clock.now / 86_400_000) * 86_400_000;
    await w.services.backups.updateSettings(hhId(), userId(), { enabled: false, includeHa: false });
    w.clock.now = midnight + 12 * 60 * MIN;
    expect(await w.services.backups.tick()).toBe(0);
    await w.services.backups.updateSettings(hhId(), userId(), { enabled: true });
    expect(await w.services.backups.tick()).toBe(1);
  });

  test("health: nothing yet warns; recent and tested is ok; old warns", async () => {
    const check = async () => (await h.admin.call("GET", "/admin/health")).json.checks.find((c: any) => c.name === "backups");
    expect(await check()).toMatchObject({ status: "warn", detail: expect.stringMatching(/No backup/) });
    const b = (await h.admin.call("POST", "/backups", { what: "app" })).json.items[0];
    await h.admin.call("POST", `/backups/${b.id}/verify`);
    expect(await check()).toMatchObject({ status: "ok", detail: expect.stringMatching(/restore-tested/) });
    w.clock.now += 40 * 60 * MIN;
    await h.admin.login(); // sessions expire after 24h
    expect(await check()).toMatchObject({ status: "warn", detail: expect.stringMatching(/hours old/) });
  });
});

describe("Home Assistant backups", () => {
  test("needs a connection and the config-worker; makes, checks, restores and deletes through jobs", async () => {
    await h.withAdminToken();
    await w.sync();
    const made = (await h.admin.call("POST", "/backups", { what: "ha" })).json.items[0];
    expect(made).toMatchObject({ kind: "ha", status: "running", destination: "ha", downloadable: false });
    await w.sync(); // generate
    await w.sync(); // info (the check)
    const b = (await h.admin.call("GET", `/backups/${made.id}`)).json;
    expect(b).toMatchObject({ status: "ok", verify: { status: "passed" } });
    expect(b.sizeBytes).toBeGreaterThan(0);

    stale(); await h.admin.stepUp();
    const rs = await h.admin.call("POST", `/backups/${made.id}/restore`, { confirm: "RESTORE" });
    expect(rs.json.queued).toBe(true);
    await w.sync();
    expect(w.configApi.restored).toHaveLength(1);

    expect((await h.admin.call("DELETE", `/backups/${made.id}`)).json).toEqual({ removed: false, pending: true });
    await w.sync();
    expect((await list()).items).toHaveLength(0);
    const actions = (await h.admin.call("GET", "/admin/audit?action=backup.")).json.items.map((i: any) => i.action);
    expect(actions).toEqual(expect.arrayContaining(["backup.created", "backup.ha_restore_requested", "backup.ha_restore_done", "backup.deleted"]));
  });

  test("a failed job marks the backup failed and tells admins; a backup HA lost fails its check", async () => {
    await h.withAdminToken();
    await w.sync();
    const { httpError } = await import("@/testing/fake-config-api");
    w.configApi.failWith = httpError(500);
    const made = (await h.admin.call("POST", "/backups", { what: "ha" })).json.items[0];
    await w.sync(); await w.sync(); await w.sync(); await w.sync();
    expect((await h.admin.call("GET", `/backups/${made.id}`)).json).toMatchObject({ status: "failed" });
    expect((await h.admin.call("GET", "/notifications")).json.notifications.some((n: any) => n.kind === "backup_failed")).toBe(true);

    w.configApi.failWith = null;
    const ok = (await h.admin.call("POST", "/backups", { what: "ha" })).json.items[0];
    await w.sync(); await w.sync();
    w.configApi.backups.clear();
    expect((await h.admin.call("POST", `/backups/${ok.id}/verify`)).json.verify.status).toBe("running");
    await w.sync();
    expect((await h.admin.call("GET", `/backups/${ok.id}`)).json.verify).toMatchObject({ status: "failed", note: expect.stringMatching(/no longer has/) });
  });

  test("without Home Assistant connected, 'both' still backs up Alice and 'ha' alone is refused", async () => {
    const w2 = createWorld();
    const solo = w2.browser();
    await solo.register("Solo");
    const both = await solo.call("POST", "/backups", {});
    expect(both.json.items).toHaveLength(1);
    expect((await solo.call("POST", "/backups", { what: "ha" })).json.error.code).toBe("ha_not_connected");
  });
});
