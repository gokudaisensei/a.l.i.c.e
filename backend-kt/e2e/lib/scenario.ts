// Differential scenario runner (RUNBOOK §5, §8.1–8.4).
//
// A card is one side-agnostic function. It runs twice — once against the TS oracle, once against
// Kotlin — recording every request/response as an ordered exchange. The runner then:
//   1. checks the card's own assertions on both stacks (capability suite), and
//   2. diffs the normalized transcripts (differential suite).
// A `different` transcript is a FAIL unless expected-diffs.yaml has an approved entry.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diff, type DiffResult, type Difference } from "./diff.ts";
import { BACKEND_URL, E2E_DIR } from "../env/constants.ts";
import { makeResult, type Assertion, type Oracle, type Outcome, type TestResult, type Tier } from "../report/model.ts";
import { HttpClient, type HttpResponse, type RequestOptions } from "./http.ts";
import { Recorder } from "./record.ts";
import { normalize } from "./normalize.ts";
import type { Actor } from "./actor.ts";

export interface Exchange {
  label: string;
  method: string;
  path: string;
  status: number;
  setCookies: string[];
  headers: Record<string, string>;
  body: unknown;
}

export type WorldKind = "fresh" | "household" | "ha";

export interface World {
  kind: WorldKind;
  actors: { admin?: Actor; member?: Actor; guest?: Actor };
}

export interface Side {
  backend: "ts" | "kt" | "ts2";
  /** The run directory, so a card can read ha-a.env. */
  runDir: string;
  baseUrl: string;
  origin: string;
  /** The run's setup code, for the fresh-install card. */
  setupCode: string;
  /** Anonymous client (public routes, CSRF/CORS probes). */
  http: HttpClient;
  recorder: Recorder;
  /** Replaced at the start of every card attempt. */
  exchanges: Exchange[];
  world: World;
}

export type ScenarioFn = (ctx: ScenarioContext) => Promise<void>;

export interface CardDef {
  id: string;
  area: string;
  title: string;
  capability: string;
  oracles: Oracle[];
  tier?: Tier;
  /** `fresh` needs an empty database; `household` needs admin + member + guest already registered. */
  world?: WorldKind;
  /** Set when the card cannot run in this milestone; the runner reports BLOCKED with this reason. */
  blocked?: string;
  /** Response headers that must match, besides content-type (e.g. CORS). */
  headers?: string[];
  run: ScenarioFn;
}

export interface ScenarioContext {
  card: CardDef;
  side: Side;
  world: World;
  attempt: number;
  /** Assertion on the current stack. */
  add(name: string, ok: boolean, expected?: unknown, actual?: unknown): void;
  /** Anonymous request, recorded in the card transcript. */
  call<T = unknown>(label: string, method: string, path: string, opts?: RequestOptions): Promise<HttpResponse<T>>;
  /** Status assertion plus the recorded call. */
  expectStatus(label: string, res: HttpResponse, expected: number | number[]): void;
  /** A per-attempt unique suffix so a retry does not collide with the first attempt's rows. */
  unique(base: string): string;
}

interface SideRun {
  exchanges: Exchange[];
  assertions: Assertion[];
  error: string | null;
}

export interface AcceptedDiff {
  id: string;
  route: string;
  field: string;
  kind: string;
  reason: string;
  approvedBy: string;
}

export interface SuiteOptions {
  runDir: string;
  mode: "capability" | "differential";
  /** TS-vs-TS noise run: the "kt" slot is a second TS stack on 3103 with its own database. */
  noise?: boolean;
  /** The run's setup code (from run.json), injected into both sides. */
  setupCode: string;
  /** Reset both backends and build the requested world before every card attempt. */
  prepare: (kind: WorldKind, attempt: number, sides: { ts: Side; kt: Side }) => Promise<{ ts: World; kt: World }>;
  /** Rows from expected-diffs.yaml with approvedBy set. */
  acceptedDiffs?: AcceptedDiff[];
  filter?: (card: CardDef) => boolean;
}

/** Read the approved rows from expected-diffs.yaml. Unapproved rows are ignored (RUNBOOK §8.4). */
export function loadAcceptedDiffs(e2eDir: string): AcceptedDiff[] {
  const file = join(e2eDir, "expected-diffs.yaml");
  if (!existsSync(file)) return [];
  let parsed: unknown;
  try {
    parsed = (Bun as any).YAML.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return (parsed as any[])
    .filter((r) => r && typeof r === "object" && typeof r.approvedBy === "string" && r.approvedBy.trim().length > 0)
    .map((r) => ({
      id: String(r.id),
      route: String(r.route ?? ""),
      field: String(r.field ?? ""),
      kind: String(r.kind ?? ""),
      reason: String(r.reason ?? ""),
      approvedBy: String(r.approvedBy),
    }));
}

// ---- transcript comparison -------------------------------------------------

const COOKIE_ATTR_ORDER = ["path", "httponly", "secure", "samesite", "max-age", "expires", "domain"];

/** Set-Cookie compared as a set of attributes with the value replaced (RUNBOOK §8.2). */
function cookieAttributes(setCookies: string[]): string[] {
  return setCookies
    .map((sc) => {
      const parts = sc.split(";").map((p) => p.trim()).filter(Boolean);
      const first = parts.shift() ?? "";
      const name = first.slice(0, Math.max(0, first.indexOf("="))) || first;
      const attrs = parts
        .map((p) => {
          const eq = p.indexOf("=");
          const k = (eq === -1 ? p : p.slice(0, eq)).toLowerCase();
          const v = eq === -1 ? "" : p.slice(eq + 1);
          // Max-Age and Expires express the same expiry; compare one normalised age in minutes.
          if (k === "max-age") return `expiry=${Math.round(Number(v) / 60)}`;
          if (k === "expires") {
            const ms = Date.parse(v);
            return Number.isFinite(ms) ? `expiry=${Math.round((ms - Date.now()) / 60_000)}` : "expiry=<age>";
          }
          // Ktor's serialisation marker, not a cookie attribute a browser acts on.
          if (k.startsWith("$")) return "";
          if (k === "domain") return `${k}=${v.toLowerCase()}`;
          return v ? `${k}=${v.toLowerCase()}` : k;
        })
        .filter(Boolean)
        .sort((a, b) => {
          const ai = COOKIE_ATTR_ORDER.indexOf(a.split("=")[0]!);
          const bi = COOKIE_ATTR_ORDER.indexOf(b.split("=")[0]!);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });
      return `${name};${attrs.join(";")}`;
    })
    .sort();
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === lower) return v;
  return null;
}

function normalizeContentType(value: string | null): string | null {
  return value === null ? null : value.split(";")[0]!.trim().toLowerCase();
}

export interface TranscriptComparison {
  kind: "identical" | "shape-identical" | "different";
  differences: Difference[];
  diff: DiffResult;
  normalized: { ts: unknown; kt: unknown };
}

export function compareTranscripts(
  ts: Exchange[],
  kt: Exchange[],
  opts: { window: { start: number; end: number }; headers: string[] },
): TranscriptComparison {
  const strip = (list: Exchange[]) =>
    list.map((e) => ({
      label: e.label,
      method: e.method,
      path: e.path,
      status: e.status,
      cookies: cookieAttributes(e.setCookies),
      headers: Object.fromEntries(
        ["content-type", ...opts.headers].map((h) => [
          h,
          h === "content-type" ? normalizeContentType(headerValue(e.headers, h)) : headerValue(e.headers, h),
        ]),
      ),
      body: e.body,
    }));
  const left = normalize(strip(ts), { window: opts.window });
  const right = normalize(strip(kt), { window: opts.window });
  // Each side is asked with its own origin (localhost:3101 vs :3102); that difference is the
  // harness's design, not a contract difference, so both sides read as `<origin>`.
  const sameOrigin = (v: unknown): unknown =>
    typeof v === "string"
      ? v.replace(/http:\/\/localhost:(3101|3102)/g, "http://localhost:<origin>")
      : Array.isArray(v)
        ? v.map(sameOrigin)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, sameOrigin(x)]))
          : v;
  const l = sameOrigin(left);
  const r = sameOrigin(right);
  const d = diff(l, r, { normalized: false });
  // A status code or an error code is the contract itself, not a value that may drift: a same-typed
  // 422-vs-400 must never be reported as "shape-identical" (which the runbook lets PASS).
  const contractField = d.differences.some(
    (x) => /\.status$/.test(x.path) || /\.body\.error\.code$/.test(x.path) || /^body\.error\.code$/.test(x.path),
  );
  return {
    kind: contractField ? "different" : d.kind,
    differences: d.differences,
    diff: d,
    normalized: { ts: l, kt: r },
  };
}

// ---- card execution --------------------------------------------------------

function exchangeOf(label: string, method: string, path: string, res: HttpResponse): Exchange {
  return {
    label,
    method,
    path,
    status: res.status,
    setCookies: res.setCookies,
    headers: res.headers,
    body: res.body,
  };
}

function contextFor(card: CardDef, side: Side, attempt: number, assertions: Assertion[]): ScenarioContext {
  return {
    card,
    side,
    world: side.world,
    attempt,
    add(name, ok, expected, actual) {
      assertions.push({ name, ok, ...(expected !== undefined ? { expected } : {}), ...(actual !== undefined ? { actual } : {}) });
    },
    async call<T = unknown>(label: string, method: string, path: string, opts: RequestOptions = {}) {
      const res = await side.http.request<T>(method, path, opts);
      side.exchanges.push(exchangeOf(label, method, path, res));
      return res;
    },
    expectStatus(label, res, expected) {
      const want = Array.isArray(expected) ? expected : [expected];
      assertions.push({ name: `${label} status`, ok: want.includes(res.status), expected: expected, actual: res.status });
    },
    unique(base: string) {
      return `${base} ${attempt}-${Math.random().toString(36).slice(2, 8)}`;
    },
  };
}

async function runOnSide(card: CardDef, side: Side, attempt: number): Promise<SideRun> {
  const assertions: Assertion[] = [];
  side.exchanges = [];
  try {
    await card.run(contextFor(card, side, attempt, assertions));
    return { exchanges: side.exchanges, assertions, error: null };
  } catch (e) {
    return {
      exchanges: side.exchanges,
      assertions,
      error: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e),
    };
  }
}

/** Kotlin answers 404/501 where TS has the route: a gap, not a wrong answer. */
function looksLikeGap(text: string): boolean {
  return /\b(404|501)\b/.test(text) && /not found|not_found|unimplemented|not implemented/i.test(text);
}

function firstDifference(d: Difference[]): string {
  const x = d[0];
  if (!x) return "";
  const show = (v: unknown) => JSON.stringify(v)?.slice(0, 120) ?? String(v);
  return `${x.path}: ts=${show(x.left)} kt=${show(x.right)}`;
}

function matchingAccepted(differences: Difference[], accepted: AcceptedDiff[], card: CardDef): AcceptedDiff | null {
  if (!accepted.length || !differences.length) return null;
  const all = differences.every((d) =>
    accepted.some((a) => {
      const routeOk = !a.route || a.route === "*" || a.route.includes(card.id) || a.route.toLowerCase().includes(card.capability.toLowerCase());
      return routeOk && (a.field === "*" || d.path.endsWith(a.field.replace(/^\$\.?/, "")));
    }),
  );
  return all ? accepted.find((a) => differences.some((d) => a.field === "*" || d.path.endsWith(a.field.replace(/^\$\.?/, "")))) ?? accepted[0]! : null;
}

interface Judgement {
  outcome: Outcome;
  cause?: TestResult["cause"];
  reason: string;
  detail?: string;
  acceptedDiff?: string;
}

function judge(
  card: CardDef,
  mode: SuiteOptions["mode"],
  ts: SideRun,
  kt: SideRun,
  cmp: TranscriptComparison,
  accepted: AcceptedDiff[],
): Judgement {
  if (ts.error) {
    return {
      outcome: "BLOCKED",
      cause: "harness_defect",
      reason: "the scenario could not run against the TS oracle",
      detail: ts.error,
    };
  }
  if (kt.error) {
    return {
      outcome: "FAIL",
      cause: looksLikeGap(kt.error) ? "kotlin_gap" : "kotlin_defect",
      reason: "the scenario could not run against Kotlin; the response shape or route differs",
      detail: kt.error,
    };
  }
  const tsBad = ts.assertions.filter((a) => !a.ok);
  if (tsBad.length) {
    return {
      outcome: "FAIL",
      cause: "harness_defect",
      reason: `the TS oracle did not meet the card's expectation: ${tsBad[0]!.name}`,
      detail: JSON.stringify(tsBad, null, 2),
    };
  }
  const ktBad = kt.assertions.filter((a) => !a.ok);
  if (mode === "capability") {
    if (ktBad.length) {
      const text = JSON.stringify(ktBad);
      return {
        outcome: "FAIL",
        cause: /404|not_found/i.test(text) ? "kotlin_gap" : "kotlin_defect",
        reason: `Kotlin did not meet the card: ${ktBad[0]!.name}`,
        detail: JSON.stringify(ktBad, null, 2),
      };
    }
    return { outcome: "PASS", reason: "both stacks met every card assertion" };
  }
  // differential: the transcript decides; the card's expectations just prove the scenario itself.
  if (cmp.kind === "identical" || cmp.kind === "shape-identical") {
    return {
      outcome: "PASS",
      reason: cmp.kind === "identical" ? "normalized transcripts are identical" : "normalized transcripts have the same shape and types",
      detail: ktBad.length ? `Kotlin assertion differences were only in values the diff accepts: ${JSON.stringify(ktBad)}` : undefined,
    };
  }
  const acceptedHit = matchingAccepted(cmp.differences, accepted, card);
  if (acceptedHit) {
    return {
      outcome: "DIFF_ACCEPTED",
      cause: "kotlin_gap",
      reason: `accepted difference ${acceptedHit.id}: ${acceptedHit.reason}`,
      detail: `${cmp.differences.length} normalized difference(s); first: ${firstDifference(cmp.differences)}`,
      acceptedDiff: acceptedHit.id,
    };
  }
  return {
    outcome: "FAIL",
    cause: "kotlin_defect",
    reason: `normalized transcripts differ (${cmp.differences.length} field(s)); ${firstDifference(cmp.differences)}`,
    detail: JSON.stringify(cmp.differences.slice(0, 25), null, 2),
  };
}

function cardText(e2eDir: string, card: CardDef): string {
  const file = join(e2eDir, "cards", `${card.area.toLowerCase()}.md`);
  if (!existsSync(file)) return `### ${card.id} ${card.title}\n(card file missing: ${file})`;
  const text = readFileSync(file, "utf8");
  const start = text.indexOf(`### ${card.id}`);
  if (start === -1) return `### ${card.id} ${card.title}\n(card not found in ${file})`;
  const next = text.indexOf("\n### ", start + 4);
  return text.slice(start, next === -1 ? undefined : next).trim() + "\n";
}

export interface CardRunResult {
  result: TestResult;
  ts: SideRun;
  kt: SideRun;
  comparison: TranscriptComparison;
}

async function runAttempt(
  card: CardDef,
  opts: SuiteOptions,
  attempt: number,
): Promise<CardRunResult> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const evidenceDir = join(opts.runDir, "evidence", card.id);
  const recorder = new Recorder(evidenceDir);
  const sides: { ts: Side; kt: Side } = {
    ts: {
      backend: "ts",
      runDir: opts.runDir,
      baseUrl: BACKEND_URL.ts,
      origin: "http://localhost:3101",
      setupCode: opts.setupCode,
      http: new HttpClient(BACKEND_URL.ts, "ts", recorder),
      recorder,
      exchanges: [],
      world: { kind: "fresh", actors: {} },
    },
    kt: opts.noise
      ? {
          backend: "ts2",
          runDir: opts.runDir,
          baseUrl: BACKEND_URL.ts2,
          origin: "http://localhost:3103",
          setupCode: opts.setupCode,
          http: new HttpClient(BACKEND_URL.ts2, "ts2", recorder),
          recorder,
          exchanges: [],
          world: { kind: "fresh", actors: {} },
        }
      : {
          backend: "kt",
          runDir: opts.runDir,
          baseUrl: BACKEND_URL.kt,
          origin: "http://localhost:3102",
          setupCode: opts.setupCode,
          http: new HttpClient(BACKEND_URL.kt, "kt", recorder),
          recorder,
          exchanges: [],
          world: { kind: "fresh", actors: {} },
        },
  };

  const start = Date.now();
  let worlds: { ts: World; kt: World };
  try {
    worlds = await opts.prepare(card.world ?? "household", attempt, sides);
  } catch (e) {
    const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    const result = makeResult({
      id: card.id,
      area: card.area,
      title: card.title,
      capability: card.capability,
      oracles: card.oracles,
      tier: card.tier ?? "normal",
      kind: opts.mode,
      outcome: "BLOCKED",
      cause: "environment",
      reason: "the card world could not be built (reset, stack start or base registration failed)",
      detail,
      attempts: [{ n: attempt, outcome: "BLOCKED", ms: Date.now() - started }],
      evidence: `evidence/${card.id}`,
      startedAt,
      ms: Date.now() - started,
    });
    recorder.writeJson("result.json", result);
    writeFileSync(join(evidenceDir, "card.md"), cardText(E2E_DIR, card));
    return {
      result,
      ts: { exchanges: [], assertions: [], error: null },
      kt: { exchanges: [], assertions: [], error: null },
      comparison: {
        kind: "identical",
        differences: [],
        diff: { kind: "identical", differences: [] },
        normalized: { ts: [], kt: [] },
      },
    };
  }
  sides.ts.world = worlds.ts;
  sides.kt.world = worlds.kt;

  const ts = await runOnSide(card, sides.ts, attempt);
  const kt = await runOnSide(card, sides.kt, attempt);
  const end = Date.now();

  const comparison = compareTranscripts(ts.exchanges, kt.exchanges, {
    window: { start, end },
    headers: card.headers ?? [],
  });

  const judgement = judge(card, opts.mode, ts, kt, comparison, opts.acceptedDiffs ?? []);
  const result = makeResult({
    id: card.id,
    area: card.area,
    title: card.title,
    capability: card.capability,
    oracles: card.oracles,
    tier: card.tier ?? "normal",
    kind: opts.mode,
    stacks: {
      ts: { status: ts.error ? "failed" : "ok", assertions: ts.assertions },
      kt: { status: kt.error ? "failed" : "ok", assertions: kt.assertions },
    },
    outcome: judgement.outcome,
    cause: judgement.cause,
    reason: judgement.reason,
    detail: judgement.detail,
    acceptedDiff: judgement.acceptedDiff,
    attempts: [{ n: attempt, outcome: judgement.outcome, ms: Date.now() - started }],
    evidence: `evidence/${card.id}`,
    startedAt,
    ms: Date.now() - started,
  });

  recorder.writeJson("diff.json", {
    mode: opts.mode,
    kind: comparison.kind,
    differences: comparison.differences,
    normalized: comparison.normalized,
    tsAssertions: ts.assertions,
    ktAssertions: kt.assertions,
    tsError: ts.error,
    ktError: kt.error,
  });
  recorder.writeJson("result.json", result);
  // The Recorder constructor truncates requests.jsonl, so the transcript for this attempt is the
  // only one in the folder; result.json carries the attempt list.
  writeFileSync(join(evidenceDir, "card.md"), cardText(E2E_DIR, card));

  return { result, ts, kt, comparison };
}

/** Run every card, retrying a FAIL once (a second-attempt pass is FLAKY, never PASS). */
export async function runCards(cards: CardDef[], opts: SuiteOptions): Promise<TestResult[]> {
  const selected = cards.filter((c) => (opts.filter ? opts.filter(c) : true));
  const results: TestResult[] = [];
  for (const card of selected) {
    process.stdout.write(`${card.id} ${card.title} … `);
    if (card.blocked) {
      const result = makeResult({
        id: card.id,
        area: card.area,
        title: card.title,
        capability: card.capability,
        oracles: card.oracles,
        tier: card.tier ?? "normal",
        kind: opts.mode,
        outcome: "BLOCKED",
        cause: "unprovable_here",
        reason: card.blocked,
        evidence: `evidence/${card.id}`,
        startedAt: new Date().toISOString(),
      });
      const dir = join(opts.runDir, "evidence", card.id);
      const recorder = new Recorder(dir);
      recorder.writeJson("result.json", result);
      writeFileSync(join(dir, "card.md"), cardText(E2E_DIR, card));
      console.log("BLOCKED (unprovable_here)");
      results.push(result);
      continue;
    }
    const first = await runAttempt(card, opts, 1);
    let final = first.result;
    if (first.result.outcome === "FAIL") {
      const second = await runAttempt(card, opts, 2);
      final = second.result;
      final.attempts = [
        { n: 1, outcome: first.result.outcome, ms: first.result.ms },
        { n: 2, outcome: second.result.outcome, ms: second.result.ms },
      ];
      if (second.result.outcome === "PASS") {
        final.outcome = "FLAKY";
        final.cause = "harness_defect";
        final.reason = `passed on the second attempt (first: ${first.result.reason})`;
      }
      // Keep the second attempt's evidence folder; a FLAKY still shows both outcomes in attempts.
      writeFileSync(join(opts.runDir, "evidence", card.id, "result.json"), JSON.stringify(final, null, 2) + "\n");
    }
    console.log(`${final.outcome}${final.cause ? ` (${final.cause})` : ""}`);
    results.push(final);
  }
  return results;
}
