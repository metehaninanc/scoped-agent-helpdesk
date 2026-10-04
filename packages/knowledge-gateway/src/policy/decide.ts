/**
 * The knowledge gateway's policy engine. Same evaluation shape as the other three gateways'
 * decide.ts (SPRINT1.md, Component 1), the shortest ladder of the four: two tools, both always
 * autonomous, no deny rules and no approval rules yet — this gateway makes nothing worth
 * restricting beyond the structural checks every gateway makes.
 *
 *   1. structural checks  - unknown tool, malformed parameters
 *   2. deny rules         - none yet
 *   3. approval rules     - none yet; this gateway has no approval store to act on one
 *   4. autonomous rules   - search_documentation, unconditionally; hand_off, unconditionally
 *      (SPRINT4.md, section 2 — identical on every gateway)
 *   5. default            - denied
 *
 * A pure function: no I/O, no network, no model call, no randomness. Never throws.
 */
import { parseToolRequest, type ValidatedToolRequest } from "./schemas.js";
import { policyConfig as defaultPolicyConfig } from "./config.js";
import { Rule, type Decision, type PolicyConfig, type RequestContext, type RuleId, type ToolRequest } from "./types.js";

interface PolicyRule {
  id: RuleId;
  matches: (request: ValidatedToolRequest, context: RequestContext, config: PolicyConfig) => boolean;
}

const denyRules: readonly PolicyRule[] = [];
const approvalRules: readonly PolicyRule[] = [];

const autonomousRules: readonly PolicyRule[] = [
  { id: Rule.AutonomousSearchDocumentation, matches: (request) => request.tool === "search_documentation" },
  // SPRINT4.md, section 2: identical on every gateway. Creating a handoff touches nothing
  // external and is reversible, so there is nothing here to gate behind approval.
  { id: Rule.AutonomousHandOff, matches: (request) => request.tool === "hand_off" },
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
