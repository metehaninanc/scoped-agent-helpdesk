/**
 * Distinguishes a usage/policy-limit or authentication failure — a real constraint on this
 * credential or account, not a system outcome and not an ordinary transient runner failure —
 * from any other error a batch caller (packages/web/src/bin/simulate.ts) might catch. Lives here,
 * not in packages/web, because only this package already depends on
 * @anthropic-ai/claude-agent-sdk; a caller elsewhere gets a plain function with no need to add
 * that dependency itself.
 *
 * SPRINT4.md, section 6's own live run: 67 of 150 tickets failed with "You've hit your session
 * limit" — a real, SDK-recognized usage cap (USAGE_LIMIT_ERROR_PREFIXES), not a defect in the
 * system under test, surfacing under real load (an accidental concurrent double-run, since fixed,
 * pushed this account well past its ordinary rate). Every one of those 67 was recorded as an
 * ordinary "error" result, indistinguishable from a genuine transient runner failure, because
 * nothing before this checked for the difference — so the run burned through the remaining
 * tickets recording nearly half a pass as noise instead of stopping the moment the real
 * constraint first appeared. This is the check that stops that from happening again.
 */
import { ORG_POLICY_LIMIT_PREFIXES, USAGE_LIMIT_ERROR_PREFIXES } from "@anthropic-ai/claude-agent-sdk";

import { AGENT_AUTH_PATH_MISMATCH } from "./env.js";

/** A heuristic over free text, the same shape as this project's other regex-based estimates
 * (PASSWORD_RESET_REQUEST_PATTERN, packages/web/src/dashboard-metrics.ts) — the SDK exports no
 * dedicated authentication-error type or prefix list, only usage/policy-limit ones, so a
 * credential failure (expired, revoked, malformed) is matched by wording, not a type. */
export const AUTHENTICATION_ERROR_PATTERN = /authentication[_ ]?error|unauthorized|invalid.{0,20}api.?key|\b401\b/i;

/**
 * The Messages API's own billing refusal, which is a different thing from the Claude Code session
 * limits the SDK's prefix lists cover: an API key whose account has run out of credit gets a 400
 * invalid_request_error reading "Your credit balance is too low to access the Anthropic API", not
 * a usage-limit sentence. Found by the triage model comparison (README, "Triage accuracy"): the
 * balance ran out partway through a Sonnet run, every remaining call failed, and the harness
 * scored 150 of them as `triage_failed` and wrote an evidence file reading 0/150 — the same
 * silent-noise failure this file was first written to prevent, through the one door it did not
 * watch. Matched by wording for the same reason as the authentication pattern above.
 */
export const CREDIT_BALANCE_ERROR_PATTERN = /credit balance is too low/i;

/**
 * Null for an ordinary error (a network blip, a real system refusal, ...) — a batch caller
 * should keep recording and moving on, exactly as before. A short, human-readable reason when the
 * error is instead a real constraint on the credential or account itself — a batch caller should
 * stop rather than record it as if it were a system outcome.
 */
export function runStoppingReason(message: string): string | null {
  const prefix = [...USAGE_LIMIT_ERROR_PREFIXES, ...ORG_POLICY_LIMIT_PREFIXES].find((p) => message.includes(p));
  if (prefix) return `a usage or policy limit ("${prefix}")`;
  if (AUTHENTICATION_ERROR_PATTERN.test(message)) return "an authentication failure";
  if (CREDIT_BALANCE_ERROR_PATTERN.test(message)) return "an exhausted API credit balance";
  if (message.includes(AGENT_AUTH_PATH_MISMATCH)) return "the agents authenticating by a path HELPDESK_AGENT_AUTH forbids";
  return null;
}
