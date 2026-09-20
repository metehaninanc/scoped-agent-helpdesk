/**
 * Knowledge gateway policy contract. Same shape as the identity and MDM gateways' own
 * (SPRINT1.md, Component 1). SPRINT3.md, 3.3: this gateway's own rule set is the shortest of the
 * three — one tool, always autonomous, nothing to configure — but it is still a real ladder, not
 * skipped, for the same reason the MDM gateway's is: a future rule (say, restricting which
 * corpus sections `search_documentation` may draw from) has an obvious, already-reviewed home.
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
 * Nothing to configure. This gateway has no credential, no backend client, and no data beyond
 * the corpus vendored into the package itself — there is no allowlist, no break-glass list, and
 * no per-tenant setting for a documentation search to respect.
 */
export type PolicyConfig = Record<string, never>;

/**
 * Stable identifiers for every rule that can appear in a Decision. Written to the audit log
 * verbatim, same rule as the other two gateways'.
 */
export const Rule = {
  // Structural denials: the request could not even be evaluated.
  DenyUnknownTool: "deny.unknown_tool",
  DenyMalformedParameters: "deny.malformed_parameters",
  DenyPolicyError: "deny.policy_error",

  // Default: anything no rule claims. No deny or approval tier exists yet.
  DenyNoMatchingRule: "deny.no_matching_rule",

  // Autonomous rules.
  AutonomousSearchDocumentation: "autonomous.search_documentation",
} as const;

export type RuleId = (typeof Rule)[keyof typeof Rule];
