// TS-vs-TS noise run (runbook T1.7/M1). The "Kotlin" slot is a second TS stack on port 3103 with its
// own disposable database, so any normalized transcript difference is harness noise, not a backend
// difference. The report header carries the count; the sample is fixed so reruns are comparable.
import { loadAcceptedDiffs, runCards } from "../lib/scenario.ts";
import { makeRunDir } from "../lib/ids.ts";
import { E2E_DIR } from "../env/constants.ts";
import { selectCards } from "../scenarios/index.ts";
import { prepareNoiseWorlds } from "./scenario-support.ts";

/** One card per interesting shape: registration, login/cookies, CSRF, lists, invitations, validation. */
export const NOISE_SAMPLE = [
  "E2E-AUTH-02",
  "E2E-AUTH-04",
  "E2E-AUTH-09",
  "E2E-HH-03",
  "E2E-HH-06",
  "E2E-X-04",
];

export async function runNoiseSuite(
  runDir: string,
  filter: { area?: string | null; only?: string[] | null } = {},
): Promise<import("../report/model.ts").TestResult[]> {
  const ctx = makeRunDir(runDir);
  const only = filter.only?.length ? filter.only : NOISE_SAMPLE;
  const cards = selectCards(filter.area, only);
  return runCards(cards, {
    runDir,
    mode: "differential",
    noise: true,
    setupCode: ctx.setupCode,
    acceptedDiffs: loadAcceptedDiffs(E2E_DIR),
    prepare: (kind, _attempt, sides) => prepareNoiseWorlds(ctx, kind, sides),
  });
}
