// Classification procedure (runbook §8.3), applied in order, stopping at the first match.
import type { Cause, TestResult } from "./model.ts";

export interface ClassifyContext {
  /** Did every ENV-* check pass for this run? */
  envAllPassed: boolean;
  /** Card ids that also failed on the TS-vs-TS noise run (harness_defect). */
  noiseFailed?: Set<string>;
  /** Features documented as open/not built: id -> L-number/phase reference. */
  kotlinOpenFeatures?: Map<string, string>;
  /** Card ids that need real push/model/hardware/host/arm64/devices. */
  unprovable?: Set<string>;
  /** True when Kotlin matched SPEC+HA and TS did not (ts_quirk). */
  kotlinMatchesSpecTsDoesNot?: boolean;
  /** True when HA itself answered unexpectedly before Alice acted (ha_behaviour). */
  haBehavedUnexpectedly?: boolean;
}

/**
 * Decide the cause of a FAIL/BLOCKED. The caller supplies the observations; this function only
 * applies the runbook's precedence so the same procedure is used everywhere.
 */
export function classify(result: TestResult, ctx: ClassifyContext): Cause {
  if (!ctx.envAllPassed) return "environment";
  if (ctx.noiseFailed?.has(result.id)) return "harness_defect";
  const open = ctx.kotlinOpenFeatures?.get(result.id);
  if (open) return "kotlin_gap";
  if (ctx.kotlinMatchesSpecTsDoesNot) return "ts_quirk";
  if (ctx.haBehavedUnexpectedly) return "ha_behaviour";
  if (ctx.unprovable?.has(result.id)) return "unprovable_here";
  return "kotlin_defect";
}
