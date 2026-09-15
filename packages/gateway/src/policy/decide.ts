/**
 * The policy engine. A pure function: no I/O, no network, no model call, no randomness.
 *
 * Evaluation order (SPRINT1.md, Component 1):
 *
 *   1. structural checks  - unknown tool, malformed parameters
 *   2. deny rules         - checked first, never overridable
 *   3. approval rules
 *   4. autonomous rules
 *   5. default            - denied
 *
 * "First match wins" is applied per tier: the first tier with any match decides the outcome,
 * and the Decision lists every rule in that tier that matched, in evaluation order. Listing
 * all of them costs nothing and gives the audit log the complete reason, not just the first.
 */
import { policyConfig as defaultPolicyConfig } from "./config.js";
import { parseToolRequest, type ValidatedToolRequest } from "./schemas.js";
import { Rule, type Decision, type PolicyConfig, type RequestContext, type RuleId, type ToolRequest } from "./types.js";

interface PolicyRule {
  id: RuleId;
  matches: (request: ValidatedToolRequest, context: RequestContext, config: PolicyConfig) => boolean;
}

// ---------------------------------------------------------------------------
// Accessors. UPNs and object ids are case-insensitive in Entra, so compare lowercased.
// ---------------------------------------------------------------------------

const lower = (s: string): string => s.toLowerCase();

/** Undefined for tools that name no user, so user rules do not apply to them. */
const targetUser = (request: ValidatedToolRequest): string | undefined =>
  "userPrincipalName" in request.params ? lower(request.params.userPrincipalName) : undefined;

/** Only add_user_to_group has a target group. Undefined means "no group rule applies". */
const targetGroup = (request: ValidatedToolRequest): string | undefined =>
  request.tool === "add_user_to_group" ? lower(request.params.groupId) : undefined;

const includesIgnoringCase = (haystack: readonly string[], needle: string): boolean =>
  haystack.some((candidate) => lower(candidate) === needle);

// ---------------------------------------------------------------------------
// The ladder.
// ---------------------------------------------------------------------------

const denyRules: readonly PolicyRule[] = [
  {
    id: Rule.DenyDirectoryRoleTarget,
    matches: (request, _context, config) => {
      const group = targetGroup(request);
      return group !== undefined && includesIgnoringCase(config.directoryRoleIds, group);
    },
  },
  {
    id: Rule.DenyBreakGlassUser,
    matches: (request, _context, config) => {
      const user = targetUser(request);
      return user !== undefined && includesIgnoringCase(config.breakGlassUsers, user);
    },
  },
  {
    id: Rule.DenyGroupNotManaged,
    matches: (request, _context, config) => {
      const group = targetGroup(request);
      if (group === undefined) return false;
      return !config.managedGroups.some((managed) => lower(managed.id) === group);
    },
  },
];

const approvalRules: readonly PolicyRule[] = [
  {
    // No exceptions, no "safe groups" allowlist in Sprint 1.
    id: Rule.ApprovalAddUserToGroup,
    matches: (request) => request.tool === "add_user_to_group",
  },
];

const autonomousRules: readonly PolicyRule[] = [
  {
    id: Rule.AutonomousListUserGroups,
    matches: (request) => request.tool === "list_user_groups",
  },
  {
    // Reads the allowlist from config; no Graph call, no target. Audited like everything else.
    id: Rule.AutonomousListManagedGroups,
    matches: (request) => request.tool === "list_managed_groups",
  },
];

// ---------------------------------------------------------------------------

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

/**
 * Decide what the gateway may do with a tool request.
 *
 * Never throws. A request the engine cannot evaluate, for any reason, is denied: the gateway
 * writes the audit record for a Decision, and an exception here would skip that record.
 */
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
