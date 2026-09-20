/**
 * The call order every gateway's tool handler follows, unchanged since SPRINT1.md, Component 2,
 * now written once (SPRINT3.md, 3.2):
 *
 *   1. validate input shape
 *   2. call decide()
 *   3. commit an audit record for the decision, whatever it is
 *   4. branch: autonomous -> execute(), then a second audit record with the result
 *              approval   -> onApproval(), if this gateway supports one; a fixed refusal if not
 *              denied     -> return a refusal naming the rules, call nothing
 *
 * Step 3 is synchronous and transactional (AuditLog.append), so by the time step 4 starts the
 * decision is on disk. A crash in step 4 still leaves evidence of what was decided. If step 3
 * fails, this throws and nothing else happens: no evidence, no action.
 *
 * Malformed input is not rejected before the audit. It goes through decide(), which denies it
 * by name, and the raw input is recorded as evidence. An agent that sends garbage is a signal
 * worth keeping.
 *
 * What is generic, and what each gateway still supplies:
 *
 *   - `config`, `decide`, `parse` carry a gateway's own policy rules and tool schemas
 *     (SPRINT2.md: "the policy engine is shared code but not shared configuration") — this file
 *     never inspects their shape, only threads them through.
 *   - `execute` performs the autonomous branch: a Graph call, a local file search, or nothing at
 *     all, whatever this gateway's backend is (SPRINT3.md, 3.3: a gateway may have none).
 *   - `onApproval`, if supplied, performs the approval branch (create an approval record,
 *     generate a rationale — identity-gateway-shaped concerns this file knows nothing about).
 *     Its absence is a first-class case, not a workaround: a gateway that never produces an
 *     "approval" decision (the MDM gateway today; the knowledge gateway from SPRINT3.md 3.3)
 *     simply omits it, and a decision that somehow reaches "approval" anyway fails loudly with a
 *     fixed refusal rather than silently executing as if it had been autonomous.
 *   - `describeError` turns a thrown backend error into the tool's error shape. Default: an
 *     "unknown" error carrying the thrown message. A gateway with a backend that has its own
 *     error taxonomy (GraphError's code and requestId) supplies its own.
 */
import type { AuditInput, AuditRecord } from "@helpdesk/audit-core";

import type { Decision, ParseResult, RequestContext, SessionContext, ToolRequest } from "./session.js";

/** What the model receives. Mirrors MCP's CallToolResult without importing the SDK here. */
export interface ToolCallResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface DeniedOutput<TRuleId extends string = string> {
  status: "denied";
  rules: TRuleId[];
  message: string;
}

export interface ErrorOutput {
  status: "error";
  code: string;
  message: string;
  requestId?: string;
}

export interface PendingApprovalOutput {
  status: "pending_approval";
  approvalId: string;
}

/** Every tool call's result is one of: this gateway's own success shapes (`TOk`), or one of the
 * three universal refusal/pending shapes every gateway shares verbatim. */
export type GatewayToolOutput<TOk, TRuleId extends string = string> =
  | TOk
  | DeniedOutput<TRuleId>
  | ErrorOutput
  | PendingApprovalOutput;

export interface RunToolCallDeps<TConfig, TRuleId extends string, TValidated, TOk> {
  audit: { append(input: AuditInput): AuditRecord };
  decide: (request: ToolRequest, context: RequestContext, config: TConfig) => Decision<TRuleId>;
  config: TConfig;
  now?: () => Date;
  /** Validates & narrows raw args into this gateway's own typed request. Never throws. */
  parse: (request: ToolRequest) => ParseResult<TValidated>;
  /** The autonomous branch. May throw; a throw is converted via `describeError`. */
  execute: (request: TValidated) => Promise<TOk>;
  /** The approval branch. Omit if this gateway never produces an "approval" decision. */
  onApproval?: (request: TValidated, rules: TRuleId[], session: SessionContext) => Promise<PendingApprovalOutput | ErrorOutput>;
  /** Default: `{ status: "error", code: "unknown", message: <the thrown error's message> }`. */
  describeError?: (error: unknown) => ErrorOutput;
  /** Appended after "Refused by policy: <rules>." in a denied reply's message. */
  deniedMessageSuffix: string;
}

function reply(output: unknown, isError = false): ToolCallResult {
  return { content: [{ type: "text", text: JSON.stringify(output) }], isError };
}

const defaultDescribeError = (error: unknown): ErrorOutput => ({
  status: "error",
  code: "unknown",
  message: error instanceof Error ? error.message : String(error),
});

/** True for any output this file itself produced with `status: "error"` — a generic check over
 * an otherwise-opaque `TOk`, since core cannot know that type's own shape. */
function isErrorOutput(output: unknown): boolean {
  return typeof output === "object" && output !== null && (output as { status?: unknown }).status === "error";
}

export async function runToolCall<TConfig, TRuleId extends string, TValidated, TOk>(
  tool: string,
  args: unknown,
  session: SessionContext,
  deps: RunToolCallDeps<TConfig, TRuleId, TValidated, TOk>,
): Promise<ToolCallResult> {
  const now = deps.now ?? (() => new Date());

  // 1. Validate. MCP clients may omit `arguments` entirely for a tool that takes none; that is
  // the empty parameter set.
  const params: unknown = args === undefined ? {} : args;
  const request: ToolRequest = { tool, params };
  const parsed = deps.parse(request);

  // 2. Decide. decide() re-validates and denies anything malformed by name.
  const context: RequestContext = { actor: session.actor, agent: session.agent, timestamp: now().toISOString() };
  const decision = deps.decide(request, context, deps.config);
  const rules: TRuleId[] = decision.outcome === "autonomous" ? [] : decision.rules;

  // 3. Commit the audit record. Synchronous; throws if it cannot, and then nothing else runs.
  const base = {
    requestId: session.requestId,
    actor: session.actor,
    agent: session.agent,
    tool,
    parameters: params,
  };
  deps.audit.append({ ...base, decision: decision.outcome, rules });

  // 4. Branch.
  if (decision.outcome === "denied" || !parsed.ok) {
    const output: DeniedOutput<TRuleId> = {
      status: "denied",
      rules,
      message: `Refused by policy: ${rules.join(", ")}. ${deps.deniedMessageSuffix}`,
    };
    return reply(output);
  }

  if (decision.outcome === "approval") {
    if (!deps.onApproval) {
      const output: ErrorOutput = { status: "error", code: "unsupported", message: `${tool} requires approval, which this gateway does not support` };
      return reply(output, true);
    }
    const output = await deps.onApproval(parsed.request, rules, session);
    return reply(output, isErrorOutput(output));
  }

  // autonomous
  let output: TOk | ErrorOutput;
  try {
    output = await deps.execute(parsed.request);
  } catch (error) {
    output = (deps.describeError ?? defaultDescribeError)(error);
  }
  deps.audit.append({ ...base, decision: decision.outcome, rules, result: output });
  return reply(output, isErrorOutput(output));
}
