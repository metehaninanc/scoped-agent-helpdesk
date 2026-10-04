/**
 * Whether a routeRequest() result is a standing condition on the account rather than an outcome
 * to record. routeRequest() catches every triage error itself and returns it as a
 * `triage_failed` result — so unlike an agent's failure, which propagates out of the call and is
 * checked by bin/simulate.ts's own catch block, a billing refusal or a 401 on the classification
 * call never reaches that block. The guard written for section 6 therefore watched one door of two:
 * pointed at a run with an empty credit balance it would have recorded every remaining ticket as
 * `triage_failed`, the same silent-noise result the first Sonnet comparison run produced. This is
 * the second door. Kept out of the bin file so it can be tested without importing a runner.
 */
import { runStoppingReason } from "@helpdesk/agent";

export function triageStopReason(routed: { status: string; cause?: string }): string | null {
  if (routed.status !== "triage_failed" || routed.cause === undefined) return null;
  return runStoppingReason(routed.cause);
}
