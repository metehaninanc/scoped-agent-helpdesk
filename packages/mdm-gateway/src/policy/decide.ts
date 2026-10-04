/**
 * The MDM gateway's policy engine. Same evaluation shape as the identity gateway's decide.ts
 * (SPRINT1.md, Component 1), its own, much shorter ladder: SPRINT2.md, Component 1 gives it two
 * tools, both unconditionally autonomous, and no write tools at all.
 *
 *   1. structural checks  - unknown tool, malformed parameters
 *   2. deny rules         - none yet; the tier stays in the ladder for the same reason
 *                           config.ts stays a real file: a future rule has an obvious home
 *   3. approval rules      - none yet; this gateway has no approval store to act on one
 *   4. autonomous rules
 *   5. default            - denied
 *
 * A pure function: no I/O, no network, no model call, no randomness. Never throws; anything it
 * cannot evaluate is denied and named, the same contract the identity gateway's engine makes.
 */
import { parseToolRequest, type ValidatedToolRequest } from "./schemas.js";
import { policyConfig as defaultPolicyConfig } from "./config.js";
import { Rule, type Decision, type PolicyConfig, type RequestContext, type RuleId, type ToolRequest } from "./types.js";

interface PolicyRule {
  id: RuleId;
  matches: (request: ValidatedToolRequest, context: RequestContext, config: PolicyConfig) => boolean;
}

// Empty on purpose (see file header): nothing in SPRINT2.md's Component 1 restricts which
// device can be read, so there is no deny rule to write yet.
const denyRules: readonly PolicyRule[] = [];

// Empty on purpose: no write tools exist, so nothing needs a human in the loop.
const approvalRules: readonly PolicyRule[] = [];

const autonomousRules: readonly PolicyRule[] = [
  { id: Rule.AutonomousListDevices, matches: (request) => request.tool === "list_devices" },
  { id: Rule.AutonomousGetDevice, matches: (request) => request.tool === "get_device" },
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
