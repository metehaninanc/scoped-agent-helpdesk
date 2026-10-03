/**
 * Endpoint gateway policy contract. Same shape as the identity and MDM gateways' (SPRINT1.md,
 * Component 1; SPRINT2.md, Component 1), its own rule set (SPRINT3.md, 3.4): two reads and one
 * write against the stub endpoint service, and reset_password, which never leaves the deny tier.
 */
export interface ToolRequest {
  tool: string;
  params: unknown;
}

/** Who is asking, through which agent, and when. */
export interface RequestContext {
  actor: string;
  agent: string;
  /** ISO 8601, UTC. */
  timestamp: string;
}

export type Decision =
  | { outcome: "autonomous" }
  | { outcome: "approval"; rules: RuleId[] }
  | { outcome: "denied"; rules: RuleId[] };

/** Nothing to configure yet. Kept as a real type and a real config.ts, not skipped, for the same
 * reason the MDM gateway's own PolicyConfig is: a future rule (say, an endpoint allowlist) has an
 * obvious home, and the two gateways' startup and import shape stay parallel. */
export type PolicyConfig = Record<string, never>;

/**
 * Stable identifiers for every rule that can appear in a Decision. Written to the audit log
 * verbatim, so treat renames as a schema change — same rule as every other gateway's.
 */
export const Rule = {
  // Structural denials: the request could not even be evaluated.
  DenyUnknownTool: "deny.unknown_tool",
  DenyMalformedParameters: "deny.malformed_parameters",
  DenyPolicyError: "deny.policy_error",

  // Deny rules, checked first, never overridable. SPRINT3.md, 3.4: password reset moved to the
  // never-automated class before this gateway was built, not added to it as an afterthought —
  // see the README, "Endpoint gateway notes", for the reasoning. Every call to reset_password
  // matches this rule regardless of parameters; there is no argument that reaches a different
  // outcome, because this rule reads only the tool name, never the request text or who is asking.
  DenyPasswordResetNeverAutomated: "deny.password_reset_never_automated",

  // Default: anything no rule claims.
  DenyNoMatchingRule: "deny.no_matching_rule",

  // Approval rules.
  ApprovalRebootEndpoint: "approval.reboot_endpoint",

  // Autonomous rules.
  AutonomousListEndpoints: "autonomous.list_endpoints",
  AutonomousGetEndpoint: "autonomous.get_endpoint",
  // SPRINT4.md, section 2: hand_off is identical, unconditionally autonomous, on every gateway.
  AutonomousHandOff: "autonomous.hand_off",
} as const;

export type RuleId = (typeof Rule)[keyof typeof Rule];
