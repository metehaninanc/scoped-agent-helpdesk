/**
 * The tool call path. SPRINT1.md, Component 2, "Call order inside every tool handler, without
 * exception":
 *
 *   1. validate input shape
 *   2. call decide()
 *   3. commit an audit record for the decision, whatever it is
 *   4. branch: autonomous -> Graph, then a second audit record with the result
 *              approval   -> create the approval record, return pending
 *              denied     -> return a refusal naming the rules, call nothing
 *
 * Step 3 is synchronous and transactional (AuditLog.append), so by the time step 4 starts the
 * decision is on disk. A crash in step 4 still leaves evidence of what was decided. If step 3
 * fails, the handler throws and nothing else happens: no evidence, no action.
 *
 * Malformed input is not rejected before the audit. It goes through decide(), which denies
 * it by name, and the raw input is recorded as evidence. An agent that sends garbage is a
 * signal worth keeping.
 */
import type { ApprovalCreateInput, ApprovalRecord } from "../approvals/store.js";
import type { AuditInput, AuditRecord } from "../audit/types.js";
import { GraphError, type AddMemberResult, type GroupSummary } from "../graph/client.js";
import { decide as defaultDecide } from "../policy/decide.js";
import { parseToolRequest, type ValidatedToolRequest } from "../policy/schemas.js";
import type { Decision, PolicyConfig, RequestContext, RuleId, ToolRequest } from "../policy/types.js";

/** Who this gateway process is acting for. Bound once per session, never taken from the model. */
export interface SessionContext {
  actor: string;
  agent: string;
  requestId: string;
}

export interface GatewayDeps {
  audit: { append(input: AuditInput): AuditRecord };
  approvals: { create(input: ApprovalCreateInput): ApprovalRecord };
  graph: {
    listUserGroups(userPrincipalName: string): Promise<GroupSummary[]>;
    addUserToGroup(userPrincipalName: string, groupId: string): Promise<AddMemberResult>;
  };
  config: PolicyConfig;
  decide?: (request: ToolRequest, context: RequestContext, config: PolicyConfig) => Decision;
  now?: () => Date;
}

/** What the model receives. Mirrors MCP's CallToolResult without importing the SDK here. */
export interface ToolCallResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export type ToolOutput =
  | { status: "ok"; groups: GroupSummary[] }
  | { status: "executed" }
  | { status: "pending_approval"; approvalId: string }
  | { status: "denied"; rules: RuleId[]; message: string }
  | { status: "error"; code: string; message: string; requestId?: string };

const reply = (output: ToolOutput, isError = false): ToolCallResult => ({
  content: [{ type: "text", text: JSON.stringify(output) }],
  isError,
});

const describeError = (error: unknown): Extract<ToolOutput, { status: "error" }> => {
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
  const decide = deps.decide ?? defaultDecide;
  const now = deps.now ?? (() => new Date());

  // 1. Validate. The typed request is only used on the paths that act.
  const request: ToolRequest = { tool, params: args };
  const parsed = parseToolRequest(request);

  // 2. Decide. decide() re-validates and denies anything malformed by name.
  const context: RequestContext = { actor: session.actor, agent: session.agent, timestamp: now().toISOString() };
  const decision = decide(request, context, deps.config);
  const rules = decision.outcome === "autonomous" ? [] : decision.rules;

  // 3. Commit the audit record. Synchronous; throws if it cannot, and then nothing else runs.
  const base = {
    requestId: session.requestId,
    actor: session.actor,
    agent: session.agent,
    tool,
    parameters: args,
  };
  deps.audit.append({ ...base, decision: decision.outcome, rules });

  // 4. Branch.
  if (decision.outcome === "denied" || !parsed.ok) {
    return reply({
      status: "denied",
      rules,
      message: `Refused by policy: ${rules.join(", ")}. Nothing was changed and nothing was looked up.`,
    });
  }

  if (decision.outcome === "approval") {
    const approval = deps.approvals.create({
      requestId: session.requestId,
      actor: session.actor,
      tool,
      params: parsed.request.params,
      rules,
    });
    return reply({ status: "pending_approval", approvalId: approval.id });
  }

  // autonomous
  let output: ToolOutput;
  try {
    output = await execute(parsed.request, deps.graph);
  } catch (error) {
    output = describeError(error);
  }
  deps.audit.append({ ...base, decision: decision.outcome, rules, result: output });
  return reply(output, output.status === "error");
}

async function execute(request: ValidatedToolRequest, graph: GatewayDeps["graph"]): Promise<ToolOutput> {
  switch (request.tool) {
    case "list_user_groups":
      return { status: "ok", groups: await graph.listUserGroups(request.params.userPrincipalName) };
    case "add_user_to_group":
      // Not reachable in Sprint 1: add_user_to_group always needs approval. Kept so the
      // branch is honest if the policy ever changes.
      await graph.addUserToGroup(request.params.userPrincipalName, request.params.groupId);
      return { status: "executed" };
  }
}
