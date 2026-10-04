/**
 * MDM gateway policy contract. Same shape as the identity gateway's (SPRINT1.md, Component 1),
 * its own rule set (SPRINT2.md, Component 1): "the policy engine is shared code but not shared
 * config... a rule that only makes sense for one gateway does not belong in the other's
 * configuration." The identity gateway's PolicyConfig, Decision and RuleId are not reused here
 * even though the shapes look similar: break glass users and a managed group allowlist are
 * meaningless for two device reads, and importing them would either lie about what this
 * gateway's policy considers or invite a rule meant for one gateway to silently apply to both.
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

/**
 * Nothing to configure yet. SPRINT2.md, Component 1: two read tools, both unconditionally
 * autonomous, no write tools and no device allowlist. Kept as a real type and a real config.ts,
 * not skipped, so the two gateways' startup and import shape stay parallel and a future device
 * rule (for example, restricting get_device to compliant devices) has an obvious home.
 */
export type PolicyConfig = Record<string, never>;

/**
 * Stable identifiers for every rule that can appear in a Decision. Written to the audit log
 * verbatim, so treat renames as a schema change — same rule as the identity gateway's.
 */
export const Rule = {
  // Structural denials: the request could not even be evaluated.
  DenyUnknownTool: "deny.unknown_tool",
  DenyMalformedParameters: "deny.malformed_parameters",
  DenyPolicyError: "deny.policy_error",

  // Default: anything no rule claims. No deny or approval tier exists yet (see decide.ts).
  DenyNoMatchingRule: "deny.no_matching_rule",

  // Autonomous rules.
  AutonomousListDevices: "autonomous.list_devices",
  AutonomousGetDevice: "autonomous.get_device",
  // SPRINT4.md, section 2: hand_off is identical, unconditionally autonomous, on every gateway.
  AutonomousHandOff: "autonomous.hand_off",
} as const;

export type RuleId = (typeof Rule)[keyof typeof Rule];
