/**
 * The tool call path. Same call order as the identity gateway's handler.ts (SPRINT1.md,
 * Component 2), shorter branch: this gateway has no approval store and no write tool, so there
 * is no "create an approval" step. What carries over unchanged:
 *
 *   1. validate input shape
 *   2. call decide()
 *   3. commit an audit record for the decision, whatever it is
 *   4. branch: autonomous -> Graph, then a second audit record with the result
 *              denied     -> return a refusal naming the rules, call nothing
 *
 * Step 3 is synchronous and transactional (AuditLog.append), so by the time step 4 starts the
 * decision is on disk. If step 3 fails, the handler throws and nothing else happens.
 *
 * The "approval" branch of Decision is handled even though nothing in decide.ts can currently
 * produce it (SPRINT2.md, Component 1 gives this gateway no write tools): failing loudly here
 * if that ever changes is cheaper than silently falling through to execute() as if it had been
 * autonomous.
 */
import type { AuditInput, AuditRecord } from "@helpdesk/audit-core";
import type { DeviceSummary } from "@helpdesk/identity-gateway";
import { GraphError } from "@helpdesk/identity-gateway";

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
  graph: {
    listDevices(): Promise<DeviceSummary[]>;
    getDevice(deviceId: string): Promise<DeviceSummary>;
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
  | { status: "ok"; devices: DeviceSummary[] }
  | { status: "ok"; device: DeviceSummary }
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

  // 1. Validate. MCP clients may omit `arguments` entirely for a tool that takes none.
  const params: unknown = args === undefined ? {} : args;
  const request: ToolRequest = { tool, params };
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
    parameters: params,
  };
  deps.audit.append({ ...base, decision: decision.outcome, rules });

  // 4. Branch.
  if (decision.outcome === "denied" || !parsed.ok) {
    return reply({
      status: "denied",
      rules,
      message: `Refused by policy: ${rules.join(", ")}. Nothing was looked up.`,
    });
  }

  if (decision.outcome === "approval") {
    // Unreachable today (see file header): fail loudly rather than silently executing as if
    // this had been autonomous.
    return reply(
      { status: "error", code: "unsupported", message: `${tool} requires approval, which this gateway does not support` },
      true,
    );
  }

  // autonomous
  let output: ToolOutput;
  try {
    output = await execute(parsed.request, deps);
  } catch (error) {
    output = describeError(error);
  }
  deps.audit.append({ ...base, decision: decision.outcome, rules, result: output });
  return reply(output, output.status === "error");
}

async function execute(request: ValidatedToolRequest, deps: GatewayDeps): Promise<ToolOutput> {
  switch (request.tool) {
    case "list_devices":
      return { status: "ok", devices: await deps.graph.listDevices() };
    case "get_device":
      return { status: "ok", device: await deps.graph.getDevice(request.params.deviceId) };
  }
}
