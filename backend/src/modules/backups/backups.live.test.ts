/**
 * Backups against the real mock Home Assistant (bun run ha:up && bun run ha:bootstrap). Skipped when HA_TOKEN is not set.
 * Proves HA really creates a backup on its own host through the config-worker, that the check sees it, and that deleting works.
 * Restoring is not exercised here: it would restart the shared mock.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { buildApp } from "@/app";
import { createTestDb } from "@/core/database/client";
import type { AppEvent } from "@/core/events/app-events";
import { InMemoryEventBus } from "@/core/events/event-bus";
import { createServices } from "@/services";
import { Browser } from "@/testing/http";
import { BACKUP_KEY, SEAL_KEYS, SECRETS_KEY } from "@/testing/world";
import { ConfigWorker } from "@/worker/config-worker";
import { HaAdminApi } from "@/worker/ha-admin-api";

const url = process.env.HA_URL;
const token = process.env.HA_TOKEN;
const run = url && token ? describe : describe.skip;

run("backups against the mock Home Assistant", () => {
  const db = createTestDb();
  const services = createServices(db, {
    bus: new InMemoryEventBus<AppEvent>(), secretsKey: SECRETS_KEY, adminSealPublicKey: SEAL_KEYS.publicKey,
    backupDir: mkdtempSync(join(tmpdir(), "alice-live-backups-")), backupKey: BACKUP_KEY, dbPath: null,
  });
  const app = buildApp(services);
  const admin = new Browser(app);
  const worker = new ConfigWorker({ db, privateKeyPem: SEAL_KEYS.privateKey, apiFactory: (u, t) => new HaAdminApi(u, t), log: pino({ level: "silent" }), retryDelayMs: 0 });
  const pump = async () => { await worker.drain(); services.configJobs.applyResults(); };
  const until = async (pred: () => Promise<boolean>, what: string, ms = 150_000) => {
    const end = Date.now() + ms;
    while (!(await pred())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await pump(); await Bun.sleep(300); }
  };
  const get = async (id: string) => (await admin.call("GET", `/backups/${id}`)).json;

  beforeAll(async () => {
    await admin.register("Gokul");
    expect((await admin.call("PUT", "/ha/connection", { baseUrl: url, token })).status).toBe(200);
    expect((await admin.call("PUT", "/ha/connection/admin-token", { token })).status).toBe(200);
  }, 30_000);
  afterAll(async () => { await services.manager.stopAll(); });

  test("Home Assistant makes a backup on its own host, the check passes, and delete removes it there", async () => {
    const made = (await admin.call("POST", "/backups", { what: "ha" })).json.items[0];
    await until(async () => (await get(made.id)).status !== "running", "the backup to finish");
    await until(async () => (await get(made.id)).verify.status !== "running", "the check");
    const b = await get(made.id);
    expect(b).toMatchObject({ kind: "ha", status: "ok", verify: { status: "passed" } });
    expect(b.sizeBytes).toBeGreaterThan(1000);

    expect((await admin.call("DELETE", `/backups/${made.id}`)).json).toEqual({ removed: false, pending: true });
    await until(async () => (await admin.call("GET", `/backups/${made.id}`)).status === 404, "the backup to be removed", 60_000);
  }, 200_000);

  test("Alice's own backup is encrypted, verified, and listed next to it", async () => {
    const b = (await admin.call("POST", "/backups", { what: "app" })).json.items[0];
    expect(b).toMatchObject({ kind: "app", status: "ok", encrypted: true });
    expect((await admin.call("POST", `/backups/${b.id}/verify`)).json.verify.status).toBe("passed");
  });
});
