// Differential suite: the normalized TS and Kotlin transcripts must be identical (or same-shape).
import { loadAcceptedDiffs, runCards } from "../lib/scenario.ts";
import { makeRunDir } from "../lib/ids.ts";
import { E2E_DIR } from "../env/constants.ts";
import { selectCards } from "../scenarios/index.ts";
import { prepareWorlds } from "./scenario-support.ts";

export async function runDifferentialSuite(
  runDir: string,
  filter: { area?: string | null; only?: string[] | null } = {},
): Promise<import("../report/model.ts").TestResult[]> {
  const ctx = makeRunDir(runDir);
  const cards = selectCards(filter.area, filter.only);
  return runCards(cards, {
    runDir,
    mode: "differential",
    setupCode: ctx.setupCode,
    acceptedDiffs: loadAcceptedDiffs(E2E_DIR),
    prepare: (kind, _attempt, sides) => prepareWorlds(ctx, kind, sides),
  });
}
