/**
 * This gateway's own extension points into @helpdesk/gateway-core's runToolCall() (SPRINT3.md,
 * 3.2). Shorter than the identity gateway's: this gateway has no approval store and no write
 * tool, so it supplies no `onApproval` at all — core's own fixed refusal covers the branch if
 * decide() ever returns "approval" (SPRINT2.md, Component 1 gives this gateway no write tools
 * today). What carries over unchanged, now in core:
 *
 *   1. validate input shape
 *   2. call decide()
 *   3. commit an audit record for the decision, whatever it is
 *   4. branch: autonomous -> Graph, then a second audit record with the result
 *              approval   -> fails loudly (no onApproval supplied)
 *              denied     -> return a refusal naming the rules, call nothing
 */
import { createHandOffExecute, runToolCall, type ErrorOutput, type GatewayToolOutput, type HandOffOk, type SessionContext, type ToolCallResult } from "@helpdesk/gateway-core";
import type { HandoffStore } from "@helpdesk/handoff-core";

import type { AuditInput, AuditRecord } from "@helpdesk/audit-core";
import type { DeviceSummary } from "@helpdesk/identity-gateway";
import { GraphError } from "@helpdesk/identity-gateway";

import { decide as defaultDecide } from "../policy/decide.js";
import { parseToolRequest, type ValidatedToolRequest } from "../policy/schemas.js";
import type { Decision, PolicyConfig, RequestContext, RuleId, ToolRequest } from "../policy/types.js";

export type { SessionContext };

export interface GatewayDeps {
  audit: { append(input: AuditInput): AuditRecord };
  graph: {
    listDevices(): Promise<DeviceSummary[]>;
    getDevice(deviceId: string): Promise<DeviceSummary>;
  };
  /** SPRINT4.md, section 2: identical on every gateway. */
  handoffs: Pick<HandoffStore, "create">;
  config: PolicyConfig;
  decide?: (request: ToolRequest, context: RequestContext, config: PolicyConfig) => Decision;
  now?: () => Date;
}

type Ok = { status: "ok"; devices: DeviceSummary[] } | { status: "ok"; device: DeviceSummary } | HandOffOk;

export type ToolOutput = GatewayToolOutput<Ok, RuleId>;

const describeError = (error: unknown): ErrorOutput => {
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
    describeError,
    deniedMessageSuffix: "Nothing was looked up.",
  });
}

async function execute(request: ValidatedToolRequest, deps: GatewayDeps, session: SessionContext): Promise<Ok> {
  switch (request.tool) {
    case "list_devices":
      return { status: "ok", devices: await deps.graph.listDevices() };
    case "get_device":
      return { status: "ok", device: await deps.graph.getDevice(request.params.deviceId) };
    case "hand_off":
      return createHandOffExecute(deps.handoffs)(request, session);
  }
}
