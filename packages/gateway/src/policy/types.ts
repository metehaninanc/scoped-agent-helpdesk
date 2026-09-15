/**
 * Policy engine contract. See SPRINT1.md, "Component 1: policy engine".
 *
 * Everything in this file is data. The engine itself lives in decide.ts and is a pure
 * function over these types: no I/O, no network, no model call, no randomness.
 */

/**
 * A tool call as it arrives at the gateway.
 *
 * `params` is deliberately `unknown`. The gateway validates input before calling decide(),
 * but the engine re-validates so that a malformed parameter can never make it throw: a
 * policy engine that throws skips the audit record, and that is worse than a denial.
 */
export interface ToolRequest {
  tool: string;
  params: unknown;
}

/** Who is asking, through which agent, and when. Carried through every layer from day one. */
export interface RequestContext {
  /** UPN of the human whose request this is. */
  actor: string;
  /** Identity of the calling agent, e.g. "identity-agent". */
  agent: string;
  /** ISO 8601, UTC. */
  timestamp: string;
}

export type Decision =
  | { outcome: "autonomous" }
  | { outcome: "approval"; rules: RuleId[] }
  | { outcome: "denied"; rules: RuleId[] };

export interface ManagedGroup {
  /** Entra group object id. */
  id: string;
  /** Human label for reviewers of this config. The engine never uses it. */
  displayName: string;
}

export interface PolicyConfig {
  /** UPNs that no tool may target, for any purpose. */
  breakGlassUsers: readonly string[];
  /** The only groups add_user_to_group may ever touch. Empty means nothing can be added. */
  managedGroups: readonly ManagedGroup[];
  /**
   * Ids that identify a directory role rather than a group: the public, stable role template
   * ids, plus any tenant-specific directoryRole object ids you want named explicitly.
   */
  directoryRoleIds: readonly string[];
}

/**
 * Stable identifiers for every rule that can appear in a Decision. They are written to the
 * audit log verbatim, so treat renames as a schema change.
 */
export const Rule = {
  // Structural denials: the request could not even be evaluated.
  DenyUnknownTool: "deny.unknown_tool",
  DenyMalformedParameters: "deny.malformed_parameters",
  DenyPolicyError: "deny.policy_error",

  // Deny rules, checked first, never overridable.
  DenyDirectoryRoleTarget: "deny.directory_role_target",
  DenyBreakGlassUser: "deny.break_glass_user",
  DenyGroupNotManaged: "deny.group_not_managed",

  // Default: anything no rule claims.
  DenyNoMatchingRule: "deny.no_matching_rule",

  // Approval rules.
  ApprovalAddUserToGroup: "approval.add_user_to_group",

  // Autonomous rules. These never surface in a Decision but keep the ladder uniform.
  AutonomousListUserGroups: "autonomous.list_user_groups",
  AutonomousListManagedGroups: "autonomous.list_managed_groups",
} as const;

export type RuleId = (typeof Rule)[keyof typeof Rule];
