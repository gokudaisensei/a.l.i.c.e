// ADM cards — see cards/adm.md for the reviewed steps and coverage.
import type { CardDef, ScenarioContext } from "../lib/scenario.ts";
import { Actor } from "../lib/actor.ts";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { manifestPayload, signWithRunKey, type Manifest } from "../lib/manifest.ts";
import { startFakeServices } from "../env/fake-services.ts";

function actor(ctx: ScenarioContext, name: "admin" | "member" | "guest"): Actor {
  const a = ctx.world.actors[name];
  if (!a) throw new Error(`world has no ${name}; the card needs world "ha"`);
  return a;
}

function code(body: unknown): unknown {
  return (body as { error?: { code?: unknown } } | null)?.error?.code;
}

function backupFiles(runDir: string, backend: string): string[] {
  const roots = backend === "ts" ? [join(runDir, "ts", "backups")] : [join(runDir, "kt", "data", "backups"), join(runDir, "kt", "backups")];
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(enc|db|sqlite|tar|gz)$/.test(name) || name.includes("backup")) out.push(p);
    }
  };
  for (const r of roots) walk(r);
  return out.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

function writeManifest(runDir: string, m: Manifest): void {
  const dir = join(runDir, "fake");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(m));
}

function signingKey(runDir: string): string {
  const line = readFileSync(join(runDir, "keys.env"), "utf8").split("\n").find((l) => l.startsWith("UPDATE_SIGNING_PRIVATE_KEY="));
  if (!line) throw new Error("UPDATE_SIGNING_PRIVATE_KEY is missing");
  const raw = line.slice("UPDATE_SIGNING_PRIVATE_KEY=".length).trim();
  return raw.includes("BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
}

export const admCards: CardDef[] = [
  {
    id: "E2E-ADM-01",
    area: "ADM",
    title: "A backup is made, verified, corrupted and deleted",
    capability: "/backups",
    oracles: ["TS", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const made = await admin.call("adm.backup.make", "POST", "/api/v1/backups", { body: { what: "app" } });
      ctx.expectStatus("adm.backup.make", made, 200);
      const item = (((made.body as any)?.items ?? []) as any[])[0];
      ctx.add("a backup was made", item !== undefined, "an item", (((made.body as any)?.items ?? []) as any[]).length);
      ctx.add("it is an app backup", item?.kind === "app", "app", item?.kind);
      ctx.add("it is ok", item?.status === "ok", "ok", item?.status);
      ctx.add("it is encrypted", item?.encrypted === true, true, item?.encrypted);

      const list = await admin.call("adm.backup.list", "GET", "/api/v1/backups");
      ctx.expectStatus("adm.backup.list", list, 200);
      ctx.add("the backup is listed", (((list.body as any)?.items ?? []) as any[]).some((b) => b.id === item?.id), true, (((list.body as any)?.items ?? []) as any[]).length);

      const verify = await admin.call("adm.backup.verify", "POST", `/api/v1/backups/${item?.id}/verify`, { body: {} });
      ctx.expectStatus("adm.backup.verify", verify, 200);
      ctx.add("the backup verifies", (verify.body as any)?.verify?.status === "passed", "passed", (verify.body as any)?.verify?.status);

      const files = backupFiles(ctx.side.runDir, ctx.side.backend);
      ctx.add("the file exists on disk", files.length > 0, ">0", files.length);
      if (files[0]) {
        appendFileSync(files[0], Buffer.from("parity-corruption"));
        const bad = await admin.call("adm.backup.verify.corrupt", "POST", `/api/v1/backups/${item?.id}/verify`, { body: {} });
        ctx.expectStatus("adm.backup.verify.corrupt", bad, 200);
        ctx.add("a corrupted backup fails verification", (bad.body as any)?.verify?.status === "failed", "failed", (bad.body as any)?.verify?.status);
        ctx.add("the failure mentions the checksum", /checksum|damaged|corrupt/i.test(String((bad.body as any)?.verify?.note ?? "")), "checksum note", (bad.body as any)?.verify?.note);
      }

      const del = await admin.call("adm.backup.delete", "DELETE", `/api/v1/backups/${item?.id}`);
      ctx.expectStatus("adm.backup.delete", del, 200);
      ctx.add("delete is acknowledged", (del.body as any)?.removed === true, true, (del.body as any)?.removed);
      const empty = await admin.call("adm.backup.empty", "GET", "/api/v1/backups");
      ctx.add("the list is empty", (((empty.body as any)?.items ?? []) as any[]).length === 0, 0, (((empty.body as any)?.items ?? []) as any[]).length);
    },
  },
  {
    id: "E2E-ADM-02",
    area: "ADM",
    title: "Backup settings are admin-only",
    capability: "/backups/settings",
    oracles: ["TS", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const member = actor(ctx, "member");

      const settings = await admin.call("adm.backup.settings.get", "GET", "/api/v1/backups/settings");
      ctx.expectStatus("adm.backup.settings.get", settings, 200);
      const put = await admin.call("adm.backup.settings.put", "PUT", "/api/v1/backups/settings", { body: { keep: 3 } });
      ctx.expectStatus("adm.backup.settings.put", put, 200);
      ctx.add("the retention changes", (put.body as any)?.keep === 3, 3, (put.body as any)?.keep);
      const after = await admin.call("adm.backup.settings.after", "GET", "/api/v1/backups/settings");
      ctx.add("the setting is stored", (after.body as any)?.keep === 3, 3, (after.body as any)?.keep);

      const memberGet = await member.call("adm.backup.member.get", "GET", "/api/v1/backups");
      ctx.expectStatus("adm.backup.member.get", memberGet, 403);
      const memberPut = await member.call("adm.backup.member.put", "PUT", "/api/v1/backups/settings", { body: { keep: 3 } });
      ctx.expectStatus("adm.backup.member.put", memberPut, 403);
    },
  },
  {
    id: "E2E-ADM-03",
    area: "ADM",
    title: "Only a correctly signed manifest is offered (T7.2)",
    capability: "/updates/check",
    oracles: ["TS", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const runDir = ctx.side.runDir;
      const good: Manifest = { version: "0.2.0", notes: "Better things", publishedAt: "2026-11-01T00:00:00Z", artifactSha256: "c".repeat(64) };
      const fake = startFakeServices({ runDir });
      try {
      writeManifest(runDir, signWithRunKey(runDir, good));
      const ready = await admin.call("adm.updates.signed", "POST", "/api/v1/updates/check", { body: {} });
      ctx.expectStatus("adm.updates.signed", ready, 200);
      ctx.add("a signed newer manifest is ready", (ready.body as any)?.state === "ready", "ready", (ready.body as any)?.state);
      ctx.add("the version is offered", (ready.body as any)?.available?.version === "0.2.0", "0.2.0", (ready.body as any)?.available?.version);
      ctx.add("it is marked signed", (ready.body as any)?.available?.signed === true, true, (ready.body as any)?.available?.signed);

      writeManifest(runDir, { ...good, version: "0.3.0" });
      const unsignedRes = await admin.call("adm.updates.unsigned", "POST", "/api/v1/updates/check", { body: {} });
      ctx.expectStatus("adm.updates.unsigned", unsignedRes, 200);
      ctx.add("an unsigned manifest is not offered", (unsignedRes.body as any)?.available?.version !== "0.3.0", "0.3.0 not offered", (unsignedRes.body as any)?.available?.version);
      ctx.add("the unsigned error is reported", /signed/i.test(String((unsignedRes.body as any)?.checkError ?? "")), "not signed", (unsignedRes.body as any)?.checkError);

      const tampered = signWithRunKey(runDir, { ...good, version: "0.4.0" });
      writeManifest(runDir, { ...tampered, version: "0.4.1" });
      const tamperedRes = await admin.call("adm.updates.tampered", "POST", "/api/v1/updates/check", { body: {} });
      ctx.add("a tampered manifest is not offered", (tamperedRes.body as any)?.available?.version !== "0.4.1" && /signed/i.test(String((tamperedRes.body as any)?.checkError ?? "")), "0.4.1 not offered + signed error", { available: (tamperedRes.body as any)?.available?.version, error: (tamperedRes.body as any)?.checkError });

      const { privateKey } = generateKeyPairSync("ed25519");
      const wrongKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const wrong = { ...good, version: "0.5.0", signature: sign(null, Buffer.from(manifestPayload({ ...good, version: "0.5.0" })), privateKey).toString("base64") };
      writeManifest(runDir, wrong);
      void wrongKeyPem;
      const wrongRes = await admin.call("adm.updates.wrong-key", "POST", "/api/v1/updates/check", { body: {} });
      ctx.add("a wrong-key signature is not offered", (wrongRes.body as any)?.available?.version !== "0.5.0" && /signed/i.test(String((wrongRes.body as any)?.checkError ?? "")), "0.5.0 not offered + signed error", { available: (wrongRes.body as any)?.available?.version, error: (wrongRes.body as any)?.checkError });

      writeManifest(runDir, signWithRunKey(runDir, { ...good, version: "0.0.1" }));
      const older = await admin.call("adm.updates.older", "POST", "/api/v1/updates/check", { body: {} });
      ctx.add("an older version is not offered", (older.body as any)?.available?.version === "0.2.0" || (older.body as any)?.state === "up_to_date", "0.2.0 retained or up_to_date", { state: (older.body as any)?.state, available: (older.body as any)?.available?.version });
      void signingKey;
      } finally {
        fake.manifest.stop();
        fake.push.stop();
        fake.llm.stop();
        fake.latency?.stop();
        await Bun.sleep(150);
      }
    },
  },
  {
    id: "E2E-ADM-04",
    area: "ADM",
    title: "Update settings and visibility follow the admin rule",
    capability: "/updates",
    oracles: ["TS", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const member = actor(ctx, "member");

      const status = await admin.call("adm.updates.status", "GET", "/api/v1/updates");
      ctx.expectStatus("adm.updates.status", status, 200);
      ctx.add("a current version is reported", typeof (status.body as any)?.currentVersion === "string", "string", (status.body as any)?.currentVersion);
      ctx.add("a state is reported", typeof (status.body as any)?.state === "string", "string", (status.body as any)?.state);

      const put = await admin.call("adm.updates.settings", "PUT", "/api/v1/updates/settings", { body: { autoUpdate: true, windowStart: "03:00", windowEnd: "05:00" } });
      ctx.expectStatus("adm.updates.settings", put, 200);
      const putBody = ((put.body as any)?.settings ?? put.body) as any;
      ctx.add("the window changes", putBody?.autoUpdate === true && putBody?.windowStart === "03:00", "03:00", putBody);

      const memberGet = await member.call("adm.updates.member", "GET", "/api/v1/updates");
      ctx.expectStatus("adm.updates.member", memberGet, 403);
      const memberCheck = await member.call("adm.updates.member.check", "POST", "/api/v1/updates/check", { body: {} });
      ctx.expectStatus("adm.updates.member.check", memberCheck, 403);

      const anon = await ctx.call("adm.operator.anon", "GET", "/api/v1/operator/homes");
      ctx.expectStatus("adm.operator.anon", anon, 401);
      const bogus = await ctx.call("adm.operator.bogus", "GET", "/api/v1/operator/homes", { headers: { authorization: "Bearer alice_op_nope" } });
      ctx.expectStatus("adm.operator.bogus", bogus, 401);
      ctx.add("the operator surface does not accept a session", code(bogus.body) === "unauthenticated", "unauthenticated", code(bogus.body));
    },
  },
];
