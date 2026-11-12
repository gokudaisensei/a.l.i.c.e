/**
 * Environment checks ENV-01…ENV-08 (RUNBOOK §7, plan §5 "ENV-*").
 *
 * These prove the *harness and the environment* before any product behaviour is judged:
 *  - ENV-01 both Home Assistant instances are the same version and seed-equal, entity by entity
 *  - ENV-02 both backends answer /health with the same shape
 *  - ENV-03 an HA volume snapshot/restore really returns the seeded state
 *  - ENV-04 the TS key generator's output is accepted by the Kotlin server and worker
 *  - ENV-05 nothing of the user's (containers, ports, backend/.env.test) was touched
 *  - ENV-06 the harness's software passkey can register, log in and step up on the TS backend
 *  - ENV-07 host, HA and both backends agree on the clock within a second
 *  - ENV-08 a deliberately wrong expectation is reported FAIL (a reporter that cannot fail is useless)
 *
 * Every check writes its evidence under `<run>/evidence/<id>/` and never marks an unrun check PASS.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { Database } from "bun:sqlite";
import {
  makeResult,
  makeStack,
  type Assertion,
  type Oracle,
  type TestResult,
} from "../report/model.ts";
import { Recorder } from "../lib/record.ts";
import { HaClient, type HaState } from "../lib/ha-truth.ts";
import { HttpClient } from "../lib/http.ts";
import { SoftwareAuthenticator, type PasskeyState } from "../lib/passkey.ts";
import { diff } from "../lib/diff.ts";
import { captureBaseline, compareBaselines, type Baseline } from "../env/preflight.ts";
import { saveSnapshot, restoreSnapshot } from "../env/snapshot.ts";
import { loadKeys } from "../env/stack.ts";
import { pemEnvToPem } from "../env/common.ts";
import {
  BACKEND_URL,
  HA_URL,
  PORTS,
} from "../env/constants.ts";
import { runSelfTest } from "./self-test.ts";

const AREA = "ENV";
const ENV_IDS = [
  "E2E-ENV-01",
  "E2E-ENV-02",
  "E2E-ENV-03",
  "E2E-ENV-04",
  "E2E-ENV-05",
  "E2E-ENV-06",
  "E2E-ENV-07",
  "E2E-ENV-08",
] as const;

interface RunMeta {
  dir: string;
  seed: number;
  setupCode: string;
  startedAt: string;
}

interface HaCreds {
  url: string;
  token: string;
}

function loadRunMeta(runDir: string): RunMeta {
  const file = join(runDir, "run.json");
  if (!existsSync(file)) throw new Error(`run.json missing in ${runDir}; run env/preflight.ts or env/up.ts first`);
  return JSON.parse(readFileSync(file, "utf8")) as RunMeta;
}

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return out;
}

/** HA credentials written by env/up.ts, or null when the pair is not up. */
function loadHa(runDir: string): { a: HaCreds; b: HaCreds } | null {
  const aFile = join(runDir, "ha-a.env");
  const bFile = join(runDir, "ha-b.env");
  if (!existsSync(aFile) || !existsSync(bFile)) return null;
  const a = loadEnvFile(aFile);
  const b = loadEnvFile(bFile);
  if (!a.HA_TOKEN || !b.HA_TOKEN) return null;
  return {
    a: { url: a.HA_URL ?? HA_URL.a, token: a.HA_TOKEN },
    b: { url: b.HA_URL ?? HA_URL.b, token: b.HA_TOKEN },
  };
}

function evidenceRel(id: string): string {
  return `evidence/${id}`;
}

function recorderFor(runDir: string, id: string): Recorder {
  return new Recorder(join(runDir, "evidence", id));
}

function finalize(rec: Recorder, result: TestResult): TestResult {
  rec.writeJson("result.json", result);
  return result;
}

class Checker {
  readonly assertions: Assertion[] = [];

  add(name: string, ok: boolean, expected?: unknown, actual?: unknown): this {
    this.assertions.push({ name, ok, ...(expected !== undefined ? { expected } : {}), ...(actual !== undefined ? { actual } : {}) });
    return this;
  }

  get ok(): boolean {
    return this.assertions.length > 0 && this.assertions.every((a) => a.ok);
  }
}

function finished(
  id: string,
  title: string,
  capability: string,
  oracles: Oracle[],
  startedAt: number,
  checker: Checker,
  rec: Recorder,
  reason: string,
): TestResult {
  const ms = Date.now() - startedAt;
  const stack = makeStack(checker.assertions);
  const result = makeResult({
    id,
    area: AREA,
    title,
    capability,
    oracles,
    tier: "normal",
    stacks: { ts: stack },
    outcome: checker.ok ? "PASS" : "FAIL",
    ...(checker.ok ? {} : { cause: "environment" as const }),
    reason: checker.ok ? reason : firstFailure(checker.assertions),
    attempts: [{ n: 1, outcome: checker.ok ? "PASS" : "FAIL", ms }],
    evidence: evidenceRel(id),
    startedAt: new Date(startedAt).toISOString(),
    ms,
  });
  return finalize(rec, result);
}

function firstFailure(assertions: Assertion[]): string {
  const failed = assertions.filter((a) => !a.ok);
  if (failed.length === 0) return "no assertions ran";
  return `${failed.length} assertion(s) failed: ` + failed.map((a) => a.name).join("; ");
}

function blocked(
  id: string,
  title: string,
  capability: string,
  reason: string,
  rec: Recorder,
  cause: TestResult["cause"] = "environment",
): TestResult {
  const startedAt = new Date().toISOString();
  rec.writeText("blocked.txt", reason + "\n");
  return finalize(
    rec,
    makeResult({
      id,
      area: AREA,
      title,
      capability,
      oracles: ["SPEC"],
      outcome: "BLOCKED",
      cause,
      reason,
      attempts: [{ n: 1, outcome: "BLOCKED", ms: 0 }],
      evidence: evidenceRel(id),
      startedAt,
      ms: 0,
    }),
  );
}

async function reachable(url: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.status === 200;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// ENV-01: the two HA instances are the same version and seed-equal entity by entity
// ---------------------------------------------------------------------------------------------

const ISO_RE = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;

/**
 * Attributes the demo integration randomises on every boot (camera tokens, GPS jitter, forecast
 * windows, sun geometry). They are not part of the seeded home, so comparing them would make
 * ENV-01 fail for a reason that has nothing to do with the harness or either backend.
 */
const VOLATILE_ATTRIBUTES = new Set([
  "access_token",
  "entity_picture",
  "latitude",
  "longitude",
  "gps_accuracy",
  "battery",
  "battery_level",
  "start_time",
  "end_time",
  "user_id",
  "azimuth",
  "elevation",
]);

/** Random events the demo integration invents per boot; their very names differ. */
const VOLATILE_DOMAINS = ["geo_location."];

function scrub(value: unknown): unknown {
  if (typeof value === "string") return value.replace(ISO_RE, "<ts>");
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE_ATTRIBUTES.has(k)) continue;
      out[k] = scrub((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function comparableStates(states: HaState[]): { entity_id: string; state: unknown; attributes: unknown }[] {
  return states
    .filter((s) => !VOLATILE_DOMAINS.some((d) => s.entity_id.startsWith(d)))
    .map((s) => ({ entity_id: s.entity_id, state: scrub(s.state), attributes: scrub(s.attributes) }))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
}

async function env01(runDir: string, ha: { a: HaCreds; b: HaCreds }): Promise<TestResult> {
  const id = "E2E-ENV-01";
  const started = Date.now();
  const rec = recorderFor(runDir, id);
  const cap = "both HA instances are the same version and seed-equal";

  const a = new HaClient(ha.a.url, ha.a.token, rec);
  const b = new HaClient(ha.b.url, ha.b.token, rec);
  const c = new Checker();

  let configA: Record<string, unknown>;
  let configB: Record<string, unknown>;
  try {
    configA = await a.getConfig();
    configB = await b.getConfig();
  } catch (e) {
    return blocked(id, "Both HA instances are seed-equal", cap, `could not read HA config: ${errText(e)}`, rec);
  }
  const versionA = String(configA.version ?? "");
  const versionB = String(configB.version ?? "");
  c.add("HA-A version is set", versionA.length > 0, "non-empty", versionA || "<empty>");
  c.add("HA-B version is set", versionB.length > 0, "non-empty", versionB || "<empty>");
  c.add("both HA instances run the same version", versionA === versionB, versionA, versionB);
  rec.writeJson("config-a.json", configA);
  rec.writeJson("config-b.json", configB);

  let statesA: HaState[];
  let statesB: HaState[];
  try {
    statesA = await a.states();
    statesB = await b.states();
  } catch (e) {
    return blocked(id, "Both HA instances are seed-equal", cap, `could not read HA states: ${errText(e)}`, rec);
  }
  const normA = comparableStates(statesA);
  const normB = comparableStates(statesB);
  rec.writeJson("states-a.json", normA);
  rec.writeJson("states-b.json", normB);

  const d = diff(normA, normB, { normalized: false, unordered: ["attributes"] });
  const entityIdsA = new Set(normA.map((s) => s.entity_id));
  const entityIdsB = new Set(normB.map((s) => s.entity_id));
  const onlyA = [...entityIdsA].filter((e) => !entityIdsB.has(e));
  const onlyB = [...entityIdsB].filter((e) => !entityIdsA.has(e));
  const meaningful = d.differences.filter((x) => !x.path.endsWith(".length")).slice(0, 200);
  rec.writeJson("state-diff.json", {
    kind: d.kind,
    entityCountA: normA.length,
    entityCountB: normB.length,
    skippedVolatileDomains: VOLATILE_DOMAINS,
    skippedVolatileAttributes: [...VOLATILE_ATTRIBUTES],
    onlyInA: onlyA.slice(0, 100),
    onlyInB: onlyB.slice(0, 100),
    differences: meaningful,
  });

  c.add("both instances expose the same entities", onlyA.length === 0 && onlyB.length === 0, {
    onlyInA: [],
    onlyInB: [],
  }, { onlyInA: onlyA.slice(0, 20), onlyInB: onlyB.slice(0, 20) });
  c.add(
    "every entity's state and attributes are equal (volatile fields removed)",
    d.kind === "identical",
    "identical",
    { kind: d.kind, differingPaths: meaningful.length, sample: meaningful.slice(0, 5) },
  );
  c.add("the seeded home is not empty", normA.length >= 50, ">= 50 entities", normA.length);

  return finished(id, "Both HA instances are the same version and seed-equal", cap, ["HA"], started, c, rec, `${normA.length} entities compared; versions ${versionA}`);
}

// ---------------------------------------------------------------------------------------------
// ENV-02: both backends answer GET /health with the same shape
// ---------------------------------------------------------------------------------------------

async function env02(runDir: string): Promise<TestResult> {
  const id = "E2E-ENV-02";
  const started = Date.now();
  const rec = recorderFor(runDir, id);
  const cap = "both backends answer GET /health with the same shape";

  if (!(await reachable(BACKEND_URL.ts)) && !(await reachable(BACKEND_URL.kt))) {
    return blocked(id, "Both backends answer /health with the same shape", cap, "neither backend is reachable; run `bun env/stack.ts up`", rec);
  }

  const ts = new HttpClient(BACKEND_URL.ts, "ts", rec);
  const kt = new HttpClient(BACKEND_URL.kt, "kt", rec);
  const c = new Checker();

  const rTs = await ts.get<Record<string, unknown>>("/health");
  const rKt = await kt.get<Record<string, unknown>>("/health");
  c.add("TS /health answers 200", rTs.status === 200, 200, rTs.status);
  c.add("Kotlin /health answers 200", rKt.status === 200, 200, rKt.status);

  const shape = (body: unknown): string[] =>
    body && typeof body === "object" ? Object.keys(body as Record<string, unknown>).sort() : [];
  const bodyTs = rTs.body ?? {};
  const bodyKt = rKt.body ?? {};
  c.add("TS body is JSON with status and uptime", JSON.stringify(shape(bodyTs)) === JSON.stringify(["status", "uptime"]), { keys: ["status", "uptime"] }, shape(bodyTs));
  c.add("Kotlin body is JSON with status and uptime", JSON.stringify(shape(bodyKt)) === JSON.stringify(["status", "uptime"]), { keys: ["status", "uptime"] }, shape(bodyKt));
  c.add("status is the string \"ok\" on both", bodyTs.status === "ok" && bodyKt.status === "ok", "ok", { ts: bodyTs.status, kt: bodyKt.status });
  c.add("uptime is a number on both", typeof bodyTs.uptime === "number" && typeof bodyKt.uptime === "number", "number", { ts: typeof bodyTs.uptime, kt: typeof bodyKt.uptime });
  c.add("the response shapes are identical", JSON.stringify(shape(bodyTs)) === JSON.stringify(shape(bodyKt)), shape(bodyTs), shape(bodyKt));

  return finished(id, "Both backends answer /health with the same shape", cap, ["TS", "SPEC"], started, c, rec, "identical status/uptime shape on both stacks");
}

// ---------------------------------------------------------------------------------------------
// ENV-03: snapshot/restore of an HA volume returns the seeded state
// ---------------------------------------------------------------------------------------------

async function waitHaRestored(url: string, token: string, timeoutMs = 240_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${url}/api/states`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(4000),
      });
      if (r.status === 200) return;
    } catch {}
    await Bun.sleep(2000);
  }
  throw new Error(`HA at ${url} did not come back within ${timeoutMs}ms`);
}

async function env03(runDir: string, ha: { a: HaCreds; b: HaCreds }): Promise<TestResult> {
  const id = "E2E-ENV-03";
  const started = Date.now();
  const rec = recorderFor(runDir, id);
  const cap = "an HA snapshot/restore returns the seeded state";

  const a = new HaClient(ha.a.url, ha.a.token, rec);
  const c = new Checker();
  const target = "input_boolean.test_switch";
  const snapshotName = "env03";

  let before: HaState;
  try {
    before = await a.state(target);
  } catch (e) {
    return blocked(id, "An HA snapshot/restore returns the seeded state", cap, `HA-A has no ${target}: ${errText(e)}`, rec);
  }
  rec.writeJson("ha-before.json", before);

  const saveStart = Date.now();
  try {
    saveSnapshot(runDir, snapshotName);
  } catch (e) {
    return blocked(id, "An HA snapshot/restore returns the seeded state", cap, `snapshot save failed: ${errText(e)}`, rec);
  }
  const saveMs = Date.now() - saveStart;

  try {
    await a.callService("input_boolean", "turn_on", { entity_id: target });
    await a.waitForState(target, (s) => s.state === "on", 15_000);
  } catch (e) {
    return blocked(id, "An HA snapshot/restore returns the seeded state", cap, `could not change ${target} before the restore: ${errText(e)}`, rec);
  }
  c.add("the change was visible in HA before restoring", true, "on", "on");

  const restoreStart = Date.now();
  try {
    restoreSnapshot(runDir, snapshotName);
    await waitHaRestored(ha.a.url, ha.a.token);
    await waitHaRestored(ha.b.url, ha.b.token);
  } catch (e) {
    return blocked(id, "An HA snapshot/restore returns the seeded state", cap, `snapshot restore failed: ${errText(e)}`, rec);
  }
  const restoreMs = Date.now() - restoreStart;

  let after: HaState | null = null;
  try {
    after = await a.state(target);
  } catch (e) {
    c.add(`${target} is readable after the restore`, false, "readable", errText(e));
  }
  if (after) {
    rec.writeJson("ha-after.json", after);
    c.add(
      "the restored state matches the state at snapshot time",
      after.state === before.state,
      before.state,
      after.state,
    );
  }
  const timings = { saveMs, restoreMs, snapshot: join(runDir, "snap", `${snapshotName}-a.tgz`) };
  rec.writeJson("timings.json", timings);
  c.add("restore completed and was timed", restoreMs > 0, "> 0 ms", restoreMs);

  const result = finished(
    id,
    "An HA snapshot/restore returns the seeded state",
    cap,
    ["HA"],
    started,
    c,
    rec,
    `${target} restored to "${before.state}" in ${restoreMs} ms (snapshot saved in ${saveMs} ms)`,
  );
  return result;
}

// ---------------------------------------------------------------------------------------------
// ENV-04: generated keys are accepted by both backends
// ---------------------------------------------------------------------------------------------

function readLog(runDir: string, name: string): string {
  const file = join(runDir, "logs", `${name}.log`);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function tail(text: string, lines = 40): string {
  return text.split("\n").slice(-lines).join("\n");
}

async function env04(runDir: string, meta: RunMeta): Promise<TestResult> {
  const id = "E2E-ENV-04";
  const started = Date.now();
  const rec = recorderFor(runDir, id);
  const cap = "generated keys are accepted by both backends";

  const c = new Checker();
  const keys = loadKeys(runDir);
  const evidence: Record<string, unknown> = {};

  // 1. The TS generator's envelope, and the form the Kotlin launcher derives from it.
  const tsPubEnv = keys.ADMIN_SEAL_PUBLIC_KEY ?? "";
  const tsPrivEnv = keys.ADMIN_SEAL_PRIVATE_KEY ?? "";
  const pubPem = pemEnvToPem(tsPubEnv);
  const privPem = pemEnvToPem(tsPrivEnv);
  c.add("ADMIN_SEAL_PUBLIC_KEY is base64 of a PEM block", tsPubEnv.length > 0 && pubPem.includes("BEGIN PUBLIC KEY"), "base64(PEM)", pubPem.slice(0, 27) || "<empty>");
  c.add("ADMIN_SEAL_PRIVATE_KEY is base64 of a PEM block", tsPrivEnv.length > 0 && privPem.includes("BEGIN PRIVATE KEY"), "base64(PEM)", privPem.slice(0, 27) || "<empty>");

  let derPubOk = false;
  let derPrivOk = false;
  let derPubError = "";
  let derPrivError = "";
  try {
    const der = Buffer.from(pubPem.split(/\r?\n/).filter((l) => !l.startsWith("-----")).join(""), "base64");
    const k = createPublicKey({ key: der, format: "der", type: "spki" });
    derPubOk = k.asymmetricKeyType === "rsa";
    evidence.publicKey = { type: k.asymmetricKeyType, derBytes: der.length };
  } catch (e) {
    derPubError = errText(e);
  }
  try {
    const der = Buffer.from(privPem.split(/\r?\n/).filter((l) => !l.startsWith("-----")).join(""), "base64");
    const k = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    derPrivOk = k.asymmetricKeyType === "rsa";
    evidence.privateKey = { type: k.asymmetricKeyType, derBytes: der.length };
  } catch (e) {
    derPrivError = errText(e);
  }
  c.add("the seal public key decodes to an RSA DER key (Kotlin's X509EncodedKeySpec input)", derPubOk, "RSA SPKI DER", derPubError || "ok");
  c.add("the seal private key decodes to an RSA DER key (Kotlin's PKCS8EncodedKeySpec input)", derPrivOk, "RSA PKCS8 DER", derPrivError || "ok");

  // F-003 evidence: the *raw* generator value is not DER, which is why the launcher translates it.
  let rawIsDer = true;
  let rawError = "";
  try {
    createPublicKey({ key: Buffer.from(tsPubEnv, "base64"), format: "der", type: "spki" });
  } catch (e) {
    rawIsDer = false;
    rawError = errText(e);
  }
  c.add("the raw TS value is not itself DER (source of F-003; the launcher decodes it)", rawIsDer === false, "not DER", rawError || "parsed as DER");
  evidence.f003 = { rawTsParsesAsDer: rawIsDer, error: rawError };

  const updatePem = pemEnvToPem(keys.UPDATE_SIGNING_PUBLIC_KEY ?? "");
  c.add("UPDATE_SIGNING_PUBLIC_KEY is raw PEM as the Kotlin verifier expects", updatePem.includes("BEGIN PUBLIC KEY"), "raw PEM", updatePem.slice(0, 27) || "<empty>");

  // 2. Both stacks boot with those keys and their workers report a configured key.
  const tsUp = await reachable(BACKEND_URL.ts);
  const ktUp = await reachable(BACKEND_URL.kt);
  c.add("TS backend is up with the generated keys", tsUp, true, tsUp);
  c.add("Kotlin backend is up with the same key material", ktUp, true, ktUp);

  const tsWorkerLog = readLog(runDir, "ts-worker");
  const ktWorkerLog = readLog(runDir, "kt-worker");
  c.add("the TS worker started with the private key", /config-worker running/.test(tsWorkerLog), "config-worker running", tail(tsWorkerLog, 3) || "<no log>");
  c.add("the Kotlin worker reports keyConfigured=true", /keyConfigured=true/.test(ktWorkerLog), "keyConfigured=true", tail(ktWorkerLog, 3) || "<no log>");
  c.add("the Kotlin worker did not exit on its key", !/Unrecognised sealed format|is not configured|invalid/i.test(ktWorkerLog), "no key error", tail(ktWorkerLog, 3) || "<no log>");

  // 3. The authenticated route is mounted: unauthenticated is 401/403, never 404/500.
  const tsHttp = new HttpClient(BACKEND_URL.ts, "ts", rec);
  const ktHttp = new HttpClient(BACKEND_URL.kt, "kt", rec);
  const secTs = await tsHttp.get("/api/v1/admin/security/sensitive-operations");
  const secKt = await ktHttp.get("/api/v1/admin/security/sensitive-operations");
  c.add("TS /api/v1/admin/security/sensitive-operations is mounted and guarded", secTs.status !== 404 && secTs.status < 500, "401/403", secTs.status);
  c.add("Kotlin /api/v1/admin/security/sensitive-operations is mounted and guarded", secKt.status !== 404 && secKt.status < 500, "401/403", secKt.status);

  evidence.statuses = { ts: secTs.status, kt: secKt.status };
  evidence.workerLogTail = { ts: tail(tsWorkerLog, 10), kt: tail(ktWorkerLog, 10) };
  evidence.mapping = {
    note: "TS prints base64(PEM); the launcher hands Kotlin raw PEM (also accepted: base64 DER).",
    tsEnvelope: "base64(PEM)",
    kotlinForm: "raw PEM",
  };
  rec.writeJson("formats.json", evidence);

  const result = finished(
    id,
    "Generated keys are accepted by both backends",
    cap,
    ["TS", "SPEC"],
    started,
    c,
    rec,
    "keys decode to RSA SPKI/PKCS8; both workers report a configured key",
  );
  if (!c.ok) {
    result.cause = c.assertions.some((a) => /Kotlin/.test(a.name) && !a.ok) ? "kotlin_defect" : "environment";
  }
  rec.writeJson("result.json", result);
  return result;
}

// ---------------------------------------------------------------------------------------------
// ENV-05: nothing of the user's was touched
// ---------------------------------------------------------------------------------------------

async function env05(runDir: string): Promise<TestResult> {
  const id = "E2E-ENV-05";
  const started = Date.now();
  const rec = recorderFor(runDir, id);
  const cap = "nothing of the user's containers/ports/data was touched";

  const beforeFile = join(runDir, "baseline.json");
  if (!existsSync(beforeFile)) {
    return blocked(id, "Nothing of the user's was touched", cap, `baseline missing: ${beforeFile}`, rec);
  }
  const before = JSON.parse(readFileSync(beforeFile, "utf8")) as Baseline;
  const now = captureBaseline();
  rec.writeJson("baseline-before.json", before);
  rec.writeJson("baseline-now.json", now);

  const cmp = compareBaselines(before, now);
  const c = new Checker();
  c.add("the user's container set is unchanged", cmp.addedContainers.length === 0 && cmp.removedContainers.length === 0, { added: [], removed: [] }, { added: cmp.addedContainers, removed: cmp.removedContainers });
  c.add("the user's ports are unchanged", Object.keys(cmp.portDiffs).length === 0, {}, cmp.portDiffs);
  c.add(
    "backend/.env.test is unchanged (hash and existence)",
    cmp.envTestSame,
    { exists: before.envTest.exists, sha256: before.envTest.sha256 },
    { exists: now.envTest.exists, sha256: now.envTest.sha256 },
  );
  c.add(
    "backend/data and backend-kt/data are unchanged",
    Object.keys(cmp.dataDirDiffs).length === 0,
    { changed: {} },
    cmp.dataDirDiffs,
  );

  rec.writeJson("diff.json", cmp);

  return finished(id, "Nothing of the user's was touched", cap, ["SPEC"], started, c, rec, `${now.containers.length} user containers and ${Object.keys(now.userPorts).length} user ports unchanged`);
}

// ---------------------------------------------------------------------------------------------
// ENV-06: the software passkey works against the TS backend
// ---------------------------------------------------------------------------------------------

const TS_WEB_ORIGIN = `http://localhost:${PORTS.tsServer}`;

interface AuthOptions {
  challenge: string;
  rp?: { id?: string; name?: string };
  user?: { id?: string; name?: string; displayName?: string };
  allowCredentials?: { id: string; type?: string }[];
  [key: string]: unknown;
}

interface ChallengeResponse {
  challengeId: string;
  options: AuthOptions;
}

async function env06(runDir: string, meta: RunMeta): Promise<TestResult> {
  const id = "E2E-ENV-06";
  const started = Date.now();
  const rec = recorderFor(runDir, id);
  const cap = "the harness's software passkey registers, logs in and steps up on TS";

  if (!(await reachable(BACKEND_URL.ts))) {
    return blocked(id, "The software passkey works against the TS backend", cap, "the TS backend is not reachable; run `bun env/stack.ts up`", rec);
  }

  const http = new HttpClient(BACKEND_URL.ts, "ts", rec);
  const c = new Checker();
  const stateFile = join(runDir, "passkey.json");

  let auth: SoftwareAuthenticator;
  let mode: "register" | "login";
  if (existsSync(stateFile)) {
    auth = SoftwareAuthenticator.fromJSON(JSON.parse(readFileSync(stateFile, "utf8")) as PasskeyState);
    auth.origin = TS_WEB_ORIGIN;
    auth.rpId = "localhost";
    mode = "login";
  } else {
    auth = new SoftwareAuthenticator();
    auth.origin = TS_WEB_ORIGIN;
    auth.rpId = "localhost";
    mode = "register";
  }

  if (mode === "register") {
    const opts = await http.post<ChallengeResponse>("/api/v1/auth/register/options", {
      displayName: "Parity Passkey",
      setupCode: meta.setupCode,
    });
    c.add("register/options accepts the setup code", opts.status === 200, 200, opts.status);
    if (opts.status !== 200) {
      rec.writeJson("register-options-failure.json", opts.body);
      return finished(id, "The software passkey works against the TS backend", cap, ["TS"], started, c, rec, "registration could not start");
    }
    const response = auth.register(opts.body.options, { origin: TS_WEB_ORIGIN, rpId: "localhost" });
    const verify = await http.post<{ recoveryCodes?: string[] }>("/api/v1/auth/register/verify", {
      challengeId: opts.body.challengeId,
      response,
    });
    c.add("register/verify accepts the software attestation", verify.status === 200 || verify.status === 201, "200/201", verify.status);
    c.add("registration returns recovery codes once", Array.isArray(verify.body?.recoveryCodes) && verify.body!.recoveryCodes!.length > 0, "non-empty array", verify.body?.recoveryCodes?.length ?? 0);
    if (verify.status !== 200 && verify.status !== 201) {
      rec.writeJson("register-verify-failure.json", verify.body);
      return finished(id, "The software passkey works against the TS backend", cap, ["TS"], started, c, rec, "registration was rejected");
    }
    writeFileSync(stateFile, JSON.stringify(auth.toJSON(), null, 2) + "\n");

    // Registration signs the new passkey in; that session is only proven in register mode.
    const regSession = await http.get<{ user?: { displayName?: string } }>("/api/v1/auth/session");
    c.add("registration signs the passkey in", regSession.status === 200, 200, regSession.status);
    const regLogout = await http.post("/api/v1/auth/logout", {});
    c.add("logout succeeds after registration", regLogout.status === 200, 200, regLogout.status);
    c.add("the cookie jar was cleared on logout", http.jar.header() === undefined || !http.jar.has("alice_session"), "no session cookie", http.jar.header() === undefined ? "none" : "still set");
  } else {
    c.add("a passkey from an earlier run was found", true, "present", stateFile);
  }

  const loginOpts = await http.post<ChallengeResponse>("/api/v1/auth/login/options", {});
  c.add("login/options answers", loginOpts.status === 200, 200, loginOpts.status);
  if (loginOpts.status !== 200) {
    rec.writeJson("login-options-failure.json", loginOpts.body);
    return finished(id, "The software passkey works against the TS backend", cap, ["TS"], started, c, rec, "login could not start");
  }
  const loginResponse = auth.assert(loginOpts.body.options, { origin: TS_WEB_ORIGIN, rpId: "localhost" });
  const loginVerify = await http.post("/api/v1/auth/login/verify", {
    challengeId: loginOpts.body.challengeId,
    response: loginResponse,
  });
  c.add("login/verify accepts the assertion", loginVerify.status === 200, 200, loginVerify.status);
  if (loginVerify.status !== 200) {
    rec.writeJson("login-verify-failure.json", loginVerify.body);
    return finished(id, "The software passkey works against the TS backend", cap, ["TS"], started, c, rec, "login was rejected");
  }
  writeFileSync(stateFile, JSON.stringify(auth.toJSON(), null, 2) + "\n");

  const session = await http.get<{ user?: { displayName?: string } }>("/api/v1/auth/session");
  c.add("login creates an authenticated session", session.status === 200, 200, session.status);

  const stepOpts = await http.post<ChallengeResponse>("/api/v1/auth/step-up/options", {});
  c.add("step-up/options answers", stepOpts.status === 200, 200, stepOpts.status);
  if (stepOpts.status !== 200) {
    rec.writeJson("step-up-options-failure.json", stepOpts.body);
    return finished(id, "The software passkey works against the TS backend", cap, ["TS"], started, c, rec, "step-up could not start");
  }
  const stepResponse = auth.assert(stepOpts.body.options, { origin: TS_WEB_ORIGIN, rpId: "localhost", uv: true });
  const stepVerify = await http.post("/api/v1/auth/step-up/verify", {
    challengeId: stepOpts.body.challengeId,
    response: stepResponse,
  });
  c.add("step-up/verify accepts a fresh user-verified assertion", stepVerify.status === 200, 200, stepVerify.status);
  if (stepVerify.status !== 200) rec.writeJson("step-up-verify-failure.json", stepVerify.body);
  // Persist after *every* successful assertion: the counter the server stored must be the counter
  // this state file resumes from, or the next login looks like a replay.
  writeFileSync(stateFile, JSON.stringify(auth.toJSON(), null, 2) + "\n");

  const logout = await http.post("/api/v1/auth/logout", {});
  c.add("logout succeeds", logout.status === 200, 200, logout.status);
  c.add("the cookie jar was cleared at the end", http.jar.header() === undefined || !http.jar.has("alice_session"), "no session cookie", http.jar.header() === undefined ? "none" : "still set");

  const result = finished(id, "The software passkey works against the TS backend", cap, ["TS"], started, c, rec, "registration, login and step-up all verified");
  if (!c.ok) result.cause = "harness_defect";
  rec.writeJson("result.json", result);
  return result;
}

// ---------------------------------------------------------------------------------------------
// ENV-07: host, HA and both backends agree on the clock within a second
// ---------------------------------------------------------------------------------------------

/** Read the config-worker's last heartbeat, written by that backend's own clock. */
function readHeartbeat(dbPath: string): number | null {
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.query("SELECT last_seen_at FROM config_worker_heartbeat LIMIT 1").get() as
        | { last_seen_at?: number }
        | null;
      return typeof row?.last_seen_at === "number" ? row.last_seen_at : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Wait for the heartbeat row to be rewritten, then compare the timestamp that backend's own clock
 * produced with the host clock at the moment we observed it. The write→read gap is under ~150 ms,
 * so a one-second agreement is provable.
 */
async function measureHeartbeatClock(
  dbPath: string,
  timeoutMs = 12_000,
): Promise<{ heartbeatAt: number; hostAt: number; skewMs: number } | { error: string }> {
  const start = Date.now();
  let prev = readHeartbeat(dbPath);
  while (prev === null && Date.now() - start < timeoutMs) {
    await Bun.sleep(200);
    prev = readHeartbeat(dbPath);
  }
  if (prev === null) return { error: `no heartbeat row in ${dbPath}` };
  while (Date.now() - start < timeoutMs) {
    await Bun.sleep(100);
    const cur = readHeartbeat(dbPath);
    if (cur !== null && cur !== prev) {
      const hostAt = Date.now();
      return { heartbeatAt: cur, hostAt, skewMs: hostAt - cur };
    }
    prev = cur ?? prev;
  }
  return { error: `the heartbeat in ${dbPath} did not advance within ${timeoutMs} ms` };
}

async function env07(runDir: string, ha: { a: HaCreds; b: HaCreds }): Promise<TestResult> {
  const id = "E2E-ENV-07";
  const started = Date.now();
  const rec = recorderFor(runDir, id);
  const cap = "host, HA and both backends agree on the clock within a second";

  const c = new Checker();
  const clock: Record<string, unknown> = {};

  const hostAt = Date.now();
  clock.hostAt = new Date(hostAt).toISOString();

  // HA reports sub-second time through a template, so its skew can be measured exactly.
  let haMs: number | null = null;
  try {
    const r = await fetch(`${ha.a.url}/api/template`, {
      method: "POST",
      headers: { authorization: `Bearer ${ha.a.token}`, "content-type": "application/json" },
      body: JSON.stringify({ template: "{{ utcnow().timestamp() }}" }),
    });
    const text = (await r.text()).trim();
    const seconds = Number(JSON.parse(text));
    if (Number.isFinite(seconds)) haMs = seconds * 1000;
    clock.haA = { raw: text, at: haMs === null ? null : new Date(haMs).toISOString() };
  } catch (e) {
    clock.haA = { error: errText(e) };
  }
  c.add("HA-A reports its clock", haMs !== null, "timestamp", haMs === null ? "unreadable" : new Date(haMs).toISOString());
  if (haMs !== null) c.add("HA-A agrees with the host within 1 s", Math.abs(haMs - hostAt) <= 1000, "<= 1000 ms", `${Math.round(haMs - hostAt)} ms`);

  // TS answers with a Date header (whole seconds), which the HTTP spec requires of a server with a clock.
  try {
    const r = await fetch(`${BACKEND_URL.ts}/health`, { signal: AbortSignal.timeout(3000) });
    const date = r.headers.get("date");
    const ms = date ? Date.parse(date) : NaN;
    clock.ts = { date, at: Number.isNaN(ms) ? null : new Date(ms).toISOString() };
    c.add("TS reports an HTTP Date header", !Number.isNaN(ms), "Date header", date ?? "<none>");
    if (!Number.isNaN(ms)) {
      c.add("TS agrees with the host within 2 s (Date has 1 s resolution)", Math.abs(ms - hostAt) <= 2000, "<= 2000 ms", `${Math.round(ms - hostAt)} ms`);
    }
  } catch (e) {
    clock.ts = { error: errText(e) };
    c.add("TS reports an HTTP Date header", false, "Date header", errText(e));
  }

  // Kotlin sends no Date header (recorded as finding F-005), so read the clock its worker writes.
  try {
    const r = await fetch(`${BACKEND_URL.kt}/health`, { signal: AbortSignal.timeout(3000) });
    clock.ktDateHeader = r.headers.get("date");
  } catch {
    clock.ktDateHeader = null;
  }
  const kt = await measureHeartbeatClock(join(runDir, "kt", "alice.db"));
  if ("error" in kt) {
    clock.kt = kt;
    c.add("the Kotlin worker writes a heartbeat with its own clock", false, "a heartbeat", kt.error);
  } else {
    clock.kt = { ...kt, at: new Date(kt.heartbeatAt).toISOString() };
    c.add("the Kotlin worker writes a heartbeat with its own clock", true, "a heartbeat", new Date(kt.heartbeatAt).toISOString());
    c.add("Kotlin agrees with the host within 1 s", Math.abs(kt.skewMs) <= 1000, "<= 1000 ms", `${kt.skewMs} ms`);
  }
  clock.note = "Kotlin's /health has no Date header; the worker heartbeat is the server-side clock probe.";

  rec.writeJson("clocks.json", clock);
  return finished(id, "Host, HA and both backends agree on the clock", cap, ["HA", "SPEC"], started, c, rec, "all clocks within tolerance");
}

// ---------------------------------------------------------------------------------------------
// ENV-08: a deliberately wrong expectation is reported FAIL
// ---------------------------------------------------------------------------------------------

async function env08(runDir: string): Promise<{ result: TestResult; selfTests: TestResult[] }> {
  const id = "E2E-ENV-08";
  const started = Date.now();
  const rec = recorderFor(runDir, id);
  const cap = "the reporter can report PASS, FAIL, BLOCKED, FLAKY, NA and DIFF_ACCEPTED";

  const selfTests = runSelfTest();
  const outcomes = new Set(selfTests.map((r) => r.outcome));
  const c = new Checker();
  for (const o of ["PASS", "FAIL", "BLOCKED", "FLAKY", "NA", "DIFF_ACCEPTED"] as const) {
    c.add(`the reporter can produce ${o}`, outcomes.has(o), o, outcomes.has(o) ? o : "<missing>");
  }
  c.add("the forced FAIL records a cause", selfTests.find((r) => r.outcome === "FAIL")?.cause !== undefined, "a cause", selfTests.find((r) => r.outcome === "FAIL")?.cause ?? "<none>");
  c.add("the forced BLOCKED records a reason", (selfTests.find((r) => r.outcome === "BLOCKED")?.reason ?? "").length > 0, "a reason", selfTests.find((r) => r.outcome === "BLOCKED")?.reason ?? "<none>");

  rec.writeJson("self-test-results.json", selfTests);
  const result = finished(id, "A deliberately wrong expectation is reported FAIL", cap, ["SPEC"], started, c, rec, "all six outcomes render, including a forced FAIL and BLOCKED");
  if (!c.ok) result.cause = "harness_defect";
  rec.writeJson("result.json", result);
  return { result, selfTests };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Run ENV-01…ENV-08 in order. Returns the ENV results plus the six harness self-test results,
 * so the report renders a real FAIL and a real BLOCKED alongside the environment checks
 * (the runner ignores SELFTEST items when deciding the process exit code).
 */
export async function runEnvSuite(runDir: string): Promise<TestResult[]> {
  const meta = loadRunMeta(runDir);
  const ha = loadHa(runDir);
  const results: TestResult[] = [];

  const skip = (id: string, title: string, cap: string, reason: string, cause?: TestResult["cause"]) =>
    blocked(id, title, cap, reason, recorderFor(runDir, id), cause);

  // ENV-01
  results.push(
    ha
      ? await env01(runDir, ha)
      : skip("E2E-ENV-01", "Both HA instances are the same version and seed-equal", "both HA instances are seed-equal", "HA pair is not up (run `bun env/up.ts`); ha-a.env/ha-b.env missing"),
  );

  // ENV-02
  results.push(await env02(runDir));

  // ENV-03
  results.push(
    ha
      ? await env03(runDir, ha)
      : skip("E2E-ENV-03", "An HA snapshot/restore returns the seeded state", "an HA snapshot/restore returns the seeded state", "HA pair is not up (run `bun env/up.ts`)"),
  );

  // ENV-04
  results.push(await env04(runDir, meta));

  // ENV-05
  results.push(await env05(runDir));

  // ENV-06
  results.push(await env06(runDir, meta));

  // ENV-07
  results.push(
    ha
      ? await env07(runDir, ha)
      : skip("E2E-ENV-07", "Host, HA and both backends agree on the clock", "clocks agree within a second", "HA pair is not up (run `bun env/up.ts`)"),
  );

  // ENV-08 (+ the six self-test fixtures the report must render)
  const { result, selfTests } = await env08(runDir);
  results.push(result, ...selfTests);

  // Never let an ENV id silently disappear.
  const present = new Set(results.map((r) => r.id));
  for (const id of ENV_IDS) {
    if (!present.has(id)) {
      results.push(skip(id, `${id} did not run`, "environment checks", "internal error: the check produced no result", "harness_defect"));
    }
  }
  return results;
}
