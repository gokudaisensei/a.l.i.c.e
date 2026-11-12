// Result model (runbook §8.1).
export type Outcome = "PASS" | "FAIL" | "BLOCKED" | "DIFF_ACCEPTED" | "NA" | "FLAKY";

export type Cause =
  | "kotlin_defect"
  | "kotlin_gap"
  | "ts_quirk"
  | "ha_behaviour"
  | "harness_defect"
  | "environment"
  | "unprovable_here";

export type Oracle = "TS" | "HA" | "SPEC" | "SEC";
export type Tier = "normal" | "slow" | "chaos" | "soak";

export interface Assertion {
  name: string;
  ok: boolean;
  expected?: unknown;
  actual?: unknown;
}

export interface StackResult {
  status: "ok" | "failed" | "not_run";
  assertions: Assertion[];
}

export interface Attempt {
  n: number;
  outcome: Outcome;
  ms: number;
}

export interface TestResult {
  id: string;
  area: string;
  title: string;
  capability: string;
  oracles: Oracle[];
  tier: Tier;
  /** Which suite produced the result: a contract assertion or a normalized transcript diff. */
  kind?: "capability" | "differential";
  stacks: { ts?: StackResult; kt?: StackResult };
  outcome: Outcome;
  cause?: Cause;
  reason: string;
  detail?: string;
  attempts: Attempt[];
  acceptedDiff?: string;
  finding?: string;
  evidence: string;
  startedAt: string;
  ms: number;
}

export interface GateResult {
  gate: string;
  name: string;
  status: "MET" | "NOT MET" | "UNPROVEN";
  note: string;
}

export interface RunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  seed: number;
  results: TestResult[];
  gates: GateResult[];
  noiseDiffCount: number;
  environment: Record<string, unknown>;
  inventoryDiff?: unknown;
  acceptedDiffs: unknown[];
}

export function stackOk(result?: StackResult): boolean {
  return result?.status === "ok" && result.assertions.every((a) => a.ok);
}

export function makeStack(assertions: Assertion[]): StackResult {
  return { status: assertions.every((a) => a.ok) ? "ok" : "failed", assertions };
}

export function makeResult(partial: Partial<TestResult> & Pick<TestResult, "id" | "area" | "title">): TestResult {
  const startedAt = partial.startedAt ?? new Date().toISOString();
  return {
    capability: partial.capability ?? partial.title,
    oracles: partial.oracles ?? ["TS", "SPEC"],
    tier: partial.tier ?? "normal",
    stacks: partial.stacks ?? {},
    outcome: partial.outcome ?? "BLOCKED",
    reason: partial.reason ?? "not implemented yet",
    attempts: partial.attempts ?? [],
    evidence: partial.evidence ?? "",
    startedAt,
    ms: partial.ms ?? 0,
    ...partial,
  };
}

export interface Counts {
  PASS: number;
  FAIL: number;
  BLOCKED: number;
  FLAKY: number;
  DIFF_ACCEPTED: number;
  NA: number;
}

export function countOutcomes(results: TestResult[]): Counts {
  const c: Counts = { PASS: 0, FAIL: 0, BLOCKED: 0, FLAKY: 0, DIFF_ACCEPTED: 0, NA: 0 };
  for (const r of results) c[r.outcome]++;
  return c;
}
