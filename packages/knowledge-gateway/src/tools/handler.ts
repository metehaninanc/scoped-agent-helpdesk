/**
 * This gateway's own extension points into @helpdesk/gateway-core's runToolCall() (SPRINT3.md,
 * 3.3). The shortest of the three gateways' handler.ts files: one tool, always autonomous, no
 * `onApproval` (this gateway has no approval store, same as the MDM gateway), and no
 * `describeError` override — a local lexical search over an in-memory index has no backend
 * error taxonomy of its own to translate, unlike Graph. What carries over unchanged, now in core:
 *
 *   1. validate input shape
 *   2. call decide()
 *   3. commit an audit record for the decision, whatever it is
 *   4. branch: autonomous -> search the corpus, then a second audit record with the result
 *              denied     -> return a refusal naming the rules, call nothing
 */
import { createHandOffExecute, runToolCall, type GatewayToolOutput, type HandOffOk, type SessionContext, type ToolCallResult } from "@helpdesk/gateway-core";
import type { HandoffStore } from "@helpdesk/handoff-core";

import type { AuditInput, AuditRecord } from "@helpdesk/audit-core";
import type { SearchResult } from "../search.js";

import { decide as defaultDecide } from "../policy/decide.js";
import { parseToolRequest, type ValidatedToolRequest } from "../policy/schemas.js";
import type { Decision, PolicyConfig, RequestContext, RuleId, ToolRequest } from "../policy/types.js";

export type { SessionContext };

export interface GatewayDeps {
  audit: { append(input: AuditInput): AuditRecord };
  /** No backend client, no credential: a synchronous, in-memory lookup over a corpus vendored
   * into this package (SPRINT3.md, 3.3 — this is the case @helpdesk/gateway-core exists to make
   * first class). */
  search: (query: string) => SearchResult[];
  /** SPRINT4.md, section 2: identical on every gateway. */
  handoffs: Pick<HandoffStore, "create">;
  config: PolicyConfig;
  decide?: (request: ToolRequest, context: RequestContext, config: PolicyConfig) => Decision;
  now?: () => Date;
}

type Ok = { status: "ok"; passages: SearchResult[] } | HandOffOk;

export type ToolOutput = GatewayToolOutput<Ok, RuleId>;

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
    deniedMessageSuffix: "Nothing was searched.",
  });
}

async function execute(request: ValidatedToolRequest, deps: GatewayDeps, session: SessionContext): Promise<Ok> {
  switch (request.tool) {
    case "search_documentation":
      return { status: "ok", passages: deps.search(request.params.query) };
    case "hand_off":
      return createHandOffExecute(deps.handoffs)(request, session);
  }
}
