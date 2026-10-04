/**
 * This gateway's own extension points into @helpdesk/gateway-core's runToolCall() (SPRINT3.md,
 * 3.2): what a tool actually does (execute), how a pending change gets recorded (onApproval),
 * and how a Graph failure reads as a tool error (describeError). The call order itself — validate,
 * decide, commit the audit record, then branch — now lives in gateway-core, unchanged from
 * SPRINT1.md, Component 2.
 *
 *   1. validate input shape
 *   2. call decide()
 *   3. commit an audit record for the decision, whatever it is
 *   4. branch: autonomous -> Graph, then a second audit record with the result
 *              approval   -> create an approval record, return pending
 *              denied     -> return a refusal naming the rules, call nothing
 *
 * Malformed input is not rejected before the audit. It goes through decide(), which denies it
 * by name, and the raw input is recorded as evidence.
 *
 * SPRINT4.md, section 4: onApproval no longer generates a rationale. That used to happen inline,
 * here, as the last step of creating the approval; it is now a separate action an approver takes
 * from the console's own opened-approval screen, on its own audited path
 * (../approvals/rationale-workflow.ts, served at POST /approvals/rationale). This file creates the
 * approval and nothing else.
 */
import {
  createHandOffExecute,
  runToolCall,
  type ApprovalCreateInput,
  type ApprovalRecord,
  type ErrorOutput,
  type GatewayToolOutput,
  type HandOffOk,
  type PendingApprovalOutput,
  type SessionContext,
  type ToolCallResult,
} from "@helpdesk/gateway-core";
import type { HandoffStore } from "@helpdesk/handoff-core";

import type { AuditInput, AuditRecord } from "@helpdesk/audit-core";
import { GraphError, type AddMemberResult, type GroupSummary } from "../graph/client.js";
import { decide as defaultDecide } from "../policy/decide.js";
import { parseToolRequest, type ValidatedToolRequest } from "../policy/schemas.js";
import type { Decision, PolicyConfig, RequestContext, RuleId, ToolRequest } from "../policy/types.js";

export type { SessionContext };

export interface GatewayDeps {
  audit: { append(input: AuditInput): AuditRecord };
  /** No setRationale here: generating a rationale is no longer something an approval's own
   * creation triggers (SPRINT4.md, section 4). See ../approvals/rationale-workflow.ts. */
  approvals: { create(input: ApprovalCreateInput): ApprovalRecord };
  graph: {
    listUserGroups(userPrincipalName: string): Promise<GroupSummary[]>;
    addUserToGroup(userPrincipalName: string, groupId: string): Promise<AddMemberResult>;
    removeUserFromGroup(userPrincipalName: string, groupId: string): Promise<void>;
  };
  /** SPRINT4.md, section 2: identical on every gateway. */
  handoffs: Pick<HandoffStore, "create">;
  config: PolicyConfig;
  decide?: (request: ToolRequest, context: RequestContext, config: PolicyConfig) => Decision;
  now?: () => Date;
}

type Ok = { status: "ok"; groups: GroupSummary[] } | { status: "executed" } | HandOffOk;

export type ToolOutput = GatewayToolOutput<Ok, RuleId>;

/** Shared with bin/gateway.ts's ApprovalWorkflow wiring: `ExecutionOutcome`'s error variant and
 * `ErrorOutput` are structurally identical, so the same Graph-error-message cleanup applies to
 * both an autonomous tool call's failure and an approved change's execution failure. */
export const describeError = (error: unknown): ErrorOutput => {
  if (error instanceof GraphError) {
    return error.requestId === undefined
      ? { status: "error", code: error.code, message: error.message.replace(/^Graph \d+ \S+: /, "") }
      : { status: "error", code: error.code, message: error.message.replace(/^Graph \d+ \S+: /, ""), requestId: error.requestId };
  }
  return { status: "error", code: "unknown", message: error instanceof Error ? error.message : String(error) };
};

export async function handleToolCall(
  tool: string,
  args: unknown,
  session: SessionContext,
  deps: GatewayDeps,
): Promise<ToolCallResult> {
  return runToolCall(tool, args, session, {
    audit: deps.audit,
    decide: deps.decide ?? defaultDecide,
    config: deps.config,
    ...(deps.now ? { now: deps.now } : {}),
    parse: parseToolRequest,
    execute: (request) => execute(request, deps, session),
    onApproval: (request, rules, callSession) => onApproval(request, rules, callSession, deps),
    describeError,
    deniedMessageSuffix: "Nothing was changed and nothing was looked up.",
  });
}

async function onApproval(
  request: ValidatedToolRequest,
  rules: RuleId[],
  session: SessionContext,
  deps: GatewayDeps,
): Promise<PendingApprovalOutput | ErrorOutput> {
  const approval = deps.approvals.create({
    requestId: session.requestId,
    actor: session.actor,
    tool: request.tool,
    params: request.params,
    rules,
  });
  return { status: "pending_approval", approvalId: approval.id };
}

async function execute(request: ValidatedToolRequest, deps: GatewayDeps, session: SessionContext): Promise<Ok> {
  switch (request.tool) {
    case "list_user_groups":
      return { status: "ok", groups: await deps.graph.listUserGroups(request.params.userPrincipalName) };
    case "list_managed_groups":
      // The allowlist, from config. No Graph call. Audited like any other tool call, so the
      // log shows when the agent asked what it could see.
      return { status: "ok", groups: deps.config.managedGroups.map((g) => ({ id: g.id, displayName: g.displayName })) };
    case "add_user_to_group":
      // Not reachable in Sprint 1: add_user_to_group always needs approval. Kept so the
      // branch is honest if the policy ever changes.
      await deps.graph.addUserToGroup(request.params.userPrincipalName, request.params.groupId);
      return { status: "executed" };
    case "remove_user_from_group":
      // Not reachable: remove_user_from_group always needs approval, same as the addition.
      await deps.graph.removeUserFromGroup(request.params.userPrincipalName, request.params.groupId);
      return { status: "executed" };
    case "hand_off":
      return createHandOffExecute(deps.handoffs)(request, session);
  }
}
