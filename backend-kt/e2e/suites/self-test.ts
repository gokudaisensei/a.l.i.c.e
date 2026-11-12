// Harness self-test (runbook T1.5 / ENV-08). Proves the reporter can produce every outcome, including
// a real FAIL and a real BLOCKED, so a green report cannot be an artefact of a reporter that cannot fail.
import { makeResult, makeStack, type TestResult } from "../report/model.ts";

export function runSelfTest(): TestResult[] {
  const now = new Date().toISOString();

  const pass = makeResult({
    id: "E2E-SELFTEST-01",
    area: "SELFTEST",
    title: "A correct expectation is reported PASS",
    capability: "harness self-test",
    oracles: ["SPEC"],
    startedAt: now,
    ms: 1,
    stacks: { ts: makeStack([{ name: "1 + 1 = 2", ok: 1 + 1 === 2, expected: 2, actual: 2 }]) },
    outcome: "PASS",
    reason: "assertion held",
    attempts: [{ n: 1, outcome: "PASS", ms: 1 }],
  });

  const fail = makeResult({
    id: "E2E-SELFTEST-02",
    area: "SELFTEST",
    title: "A deliberately wrong expectation is reported FAIL",
    capability: "harness self-test",
    oracles: ["SPEC"],
    startedAt: now,
    ms: 1,
    stacks: { ts: makeStack([{ name: "1 + 1 = 3", ok: 1 + 1 === 3, expected: 3, actual: 2 }]) },
    outcome: "FAIL",
    cause: "harness_defect",
    reason: "expected 3, observed 2 (the reporter correctly fails)",
    attempts: [{ n: 1, outcome: "FAIL", ms: 1 }],
  });

  const blocked = makeResult({
    id: "E2E-SELFTEST-03",
    area: "SELFTEST",
    title: "A missing prerequisite is reported BLOCKED",
    capability: "harness self-test",
    oracles: ["SPEC"],
    startedAt: now,
    ms: 0,
    outcome: "BLOCKED",
    cause: "environment",
    reason: "prerequisite `deliberately-missing-tool` is not available",
    attempts: [{ n: 1, outcome: "BLOCKED", ms: 0 }],
  });

  const flaky = makeResult({
    id: "E2E-SELFTEST-04",
    area: "SELFTEST",
    title: "A test that passes only on retry is reported FLAKY, never PASS",
    capability: "harness self-test",
    oracles: ["SPEC"],
    startedAt: now,
    ms: 2,
    stacks: { ts: makeStack([{ name: "second attempt", ok: true }]) },
    outcome: "FLAKY",
    cause: "environment",
    reason: "first attempt failed, second passed",
    attempts: [
      { n: 1, outcome: "FAIL", ms: 1 },
      { n: 2, outcome: "PASS", ms: 1 },
    ],
  });

  const na = makeResult({
    id: "E2E-SELFTEST-05",
    area: "SELFTEST",
    title: "A non-applicable check is reported NA with a reason",
    capability: "harness self-test",
    oracles: ["SPEC"],
    startedAt: now,
    ms: 0,
    outcome: "NA",
    reason: "does not apply to this harness by design",
    attempts: [{ n: 1, outcome: "NA", ms: 0 }],
  });

  const accepted = makeResult({
    id: "E2E-SELFTEST-06",
    area: "SELFTEST",
    title: "An approved known difference is reported DIFF_ACCEPTED",
    capability: "harness self-test",
    oracles: ["TS", "SPEC"],
    startedAt: now,
    ms: 1,
    outcome: "DIFF_ACCEPTED",
    reason: "matches expected-diffs.yaml entry D-000 (self-test fixture)",
    acceptedDiff: "D-000",
    attempts: [{ n: 1, outcome: "DIFF_ACCEPTED", ms: 1 }],
  });

  return [pass, fail, blocked, flaky, na, accepted];
}
