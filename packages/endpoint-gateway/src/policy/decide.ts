/**
 * The endpoint gateway's policy engine. Same evaluation shape as every other gateway's decide.ts
 * (SPRINT1.md, Component 1):
 *
 *   1. structural checks  - unknown tool, malformed parameters
 *   2. deny rules         - password reset, unconditionally; checked first, never overridable
 *   3. approval rules      - reboot_endpoint
 *   4. autonomous rules    - list_endpoints, get_endpoint
 *   5. default            - denied
 *
 * A pure function: no I/O, no network, no model call, no randomness. Never throws; anything it
 * cannot evaluate is denied and named, the same contract every gateway's engine makes.
 *
 * SPRINT3.md, 3.4: password reset is not implemented as a tool with a working backend anywhere in
 * this package — there is no execute() case for it, and this gateway holds no Graph permission
 * for it at all (see env.ts and the README, "Endpoint gateway notes"). It is still declared in
 * policy/schemas.ts, so decide() can recognize it as a known tool and refuse it by a specific,
 * named rule rather than the generic "unknown tool" — the distinction the README asks this
 * document to preserve: an unnamed refusal reads like a missing feature; a named one reads like a
 * decision. DenyPasswordResetNeverAutomated matches on tool name alone, before any parameter is
 * even inspected, so there is no argument, no rephrasing and no target user that reaches a
 * different outcome.
 */
import { parseToolRequest, type ValidatedToolRequest } from "./schemas.js";
import { policyConfig as defaultPolicyConfig } from "./config.js";
import { Rule, type Decision, type PolicyConfig, type RequestContext, type RuleId, type ToolRequest } from "./types.js";

interface PolicyRule {
  id: RuleId;
  matches: (request: ValidatedToolRequest, context: RequestContext, config: PolicyConfig) => boolean;
}

const denyRules: readonly PolicyRule[] = [
  {
    id: Rule.DenyPasswordResetNeverAutomated,
    matches: (request) => request.tool === "reset_password",
  },
];

const approvalRules: readonly PolicyRule[] = [
  {
    // No exceptions: every reboot is approval gated, the same way every group change is in the
    // identity gateway — there is no "safe endpoint" allowlist that skips review.
    id: Rule.ApprovalRebootEndpoint,
    matches: (request) => request.tool === "reboot_endpoint",
  },
];

const autonomousRules: readonly PolicyRule[] = [
  { id: Rule.AutonomousListEndpoints, matches: (request) => request.tool === "list_endpoints" },
  { id: Rule.AutonomousGetEndpoint, matches: (request) => request.tool === "get_endpoint" },
];

const denied = (...rules: RuleId[]): Decision => ({ outcome: "denied", rules });

const firing = (
  rules: readonly PolicyRule[],
  request: ValidatedToolRequest,
  context: RequestContext,
  config: PolicyConfig,
): RuleId[] => rules.filter((rule) => rule.matches(request, context, config)).map((rule) => rule.id);

function evaluate(request: ToolRequest, context: RequestContext, config: PolicyConfig): Decision {
  const parsed = parseToolRequest(request);
  if (!parsed.ok) {
    return denied(parsed.reason === "unknown_tool" ? Rule.DenyUnknownTool : Rule.DenyMalformedParameters);
  }

  const denies = firing(denyRules, parsed.request, context, config);
  if (denies.length > 0) return denied(...denies);

  const approvals = firing(approvalRules, parsed.request, context, config);
  if (approvals.length > 0) return { outcome: "approval", rules: approvals };

  if (firing(autonomousRules, parsed.request, context, config).length > 0) {
    return { outcome: "autonomous" };
  }

  return denied(Rule.DenyNoMatchingRule);
}

export function decide(
  request: ToolRequest,
  context: RequestContext,
  config: PolicyConfig = defaultPolicyConfig,
): Decision {
  try {
    return evaluate(request, context, config);
  } catch {
    return denied(Rule.DenyPolicyError);
  }
}
