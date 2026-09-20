/**
 * This gateway's own extension points into @helpdesk/gateway-core's runToolCall() (SPRINT3.md,
 * 3.2 template, 3.4 gateway): what a tool actually does (execute), how a pending reboot gets
 * recorded (onApproval), and how a stub failure reads as a tool error (describeError). The call
 * order itself — validate, decide, commit the audit record, then branch — lives in gateway-core.
 *
 *   1. validate input shape
 *   2. call decide()
 *   3. commit an audit record for the decision, whatever it is
 *   4. branch: autonomous -> the stub endpoint service, then a second audit record with the result
 *              approval   -> create an approval record, return pending (no rationale: see the
 *                             README, "Endpoint gateway notes", for why this gateway omits one)
 *              denied     -> return a refusal naming the rules, call nothing
 *
 * No case here ever executes reset_password. It is a known tool (policy/schemas.ts) so decide()
 * can name it in a denial, but policy/decide.ts's deny tier matches it unconditionally, before
 * this file's execute() is ever reached — there is no branch to remove if that changed, because
 * none was ever written. That is what "not implemented as a tool" means in the README: registered
 * so the refusal is nameable and auditable, never wired to anything that could act on it.
 */
import {
  runToolCall,
  type ApprovalCreateInput,
  type ApprovalRecord,
  type ErrorOutput,
  type GatewayToolOutput,
  type PendingApprovalOutput,
  type SessionContext,
  type ToolCallResult,
} from "@helpdesk/gateway-core";

import type { AuditInput, AuditRecord } from "@helpdesk/audit-core";
import type { EndpointService, EndpointSummary } from "../stub/endpoint-service.js";
import { decide as defaultDecide } from "../policy/decide.js";
import { parseToolRequest, type ValidatedToolRequest } from "../policy/schemas.js";
import type { Decision, PolicyConfig, RequestContext, RuleId, ToolRequest } from "../policy/types.js";

export type { SessionContext };

export interface GatewayDeps {
  audit: { append(input: AuditInput): AuditRecord };
  /** No setRationale: this gateway's one gated write omits a rationale entirely (see the
   * README, "Endpoint gateway notes") rather than generalizing the identity-specific generator. */
  approvals: { create(input: ApprovalCreateInput): ApprovalRecord };
  stub: EndpointService;
  config: PolicyConfig;
  decide?: (request: ToolRequest, context: RequestContext, config: PolicyConfig) => Decision;
  now?: () => Date;
}

type Ok = { status: "ok"; endpoints: EndpointSummary[] } | { status: "ok"; endpoint: EndpointSummary | null };

export type ToolOutput = GatewayToolOutput<Ok, RuleId>;

export const describeError = (error: unknown): ErrorOutput => ({
  status: "error",
  code: "unknown",
  message: error instanceof Error ? error.message : String(error),
});

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
    execute: (request) => execute(request, deps),
    onApproval: (request, rules, callSession) => onApproval(request, rules, callSession, deps),
    describeError,
    deniedMessageSuffix:
      "Nothing was reset, changed, or looked up. This system never resets a password: use Self-Service Password Reset, or your manager if SSPR is not available.",
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

async function execute(request: ValidatedToolRequest, deps: GatewayDeps): Promise<Ok> {
  switch (request.tool) {
    case "list_endpoints":
      return { status: "ok", endpoints: await deps.stub.listEndpoints() };
    case "get_endpoint":
      return { status: "ok", endpoint: await deps.stub.getEndpoint(request.params.endpointId) };
    case "reboot_endpoint":
      // Not reachable: reboot_endpoint always needs approval. Kept so the branch is honest if
      // the policy ever changes, same convention as the identity gateway's own writes.
      return { status: "ok", endpoint: await deps.stub.rebootEndpoint(request.params.endpointId) };
    case "reset_password":
      // Not reachable, ever: policy/decide.ts denies this tool unconditionally, before decide()
      // returns anything but "denied". See this file's header comment.
      throw new Error("reset_password has no execute() path: policy denies it unconditionally");
  }
}
