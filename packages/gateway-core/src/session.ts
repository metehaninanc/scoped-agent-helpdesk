/**
 * Shapes every gateway's policy engine and tool-call path share, and the one place a tool call
 * derives who is asking from the request's own validated identity — SPRINT3.md, 3.2. Each
 * gateway keeps its own `RuleId` union and `PolicyConfig` (its rules are its own, never shared;
 * see SPRINT2.md, Component 1: "the policy engine is shared code but not shared configuration"),
 * but the surrounding shapes — a tool request, who and when, and the three-outcome Decision —
 * are identical every time, so they live here once.
 */
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";

/**
 * A tool call as it arrives at the gateway.
 *
 * `params` is deliberately `unknown`. The gateway validates input before calling decide(), but
 * the engine re-validates so that a malformed parameter can never make it throw: a policy engine
 * that throws skips the audit record, and that is worse than a denial.
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

/** Who this gateway process is acting for, for one tool call. Never taken from the model. */
export interface SessionContext {
  actor: string;
  agent: string;
  requestId: string;
  /** The request exactly as the person typed it. SPRINT4.md, section 2: a `hand_off` tool call
   * needs this on the handoff record it creates ("the record carries ... the original request
   * text"), and the gateway never sees it any other way — a tool's own model-supplied params are
   * for `reason`, what a person should do, never a restatement of what started the conversation,
   * the same reason `actor` travels as a header rather than a tool parameter. Empty string when
   * the header is absent, not enforced the way `x-actor` is: unlike identity, a missing or wrong
   * request text cannot let a request through as someone else, so there is nothing here worth a
   * hard 400 over. */
  requestText: string;
}

/**
 * `TRuleId` is each gateway's own closed set of rule identifiers (SPRINT1.md, Component 1):
 * stable, audited verbatim, and never shared between gateways even when two rules happen to be
 * named alike.
 */
export type Decision<TRuleId extends string = string> =
  | { outcome: "autonomous" }
  | { outcome: "approval"; rules: TRuleId[] }
  | { outcome: "denied"; rules: TRuleId[] };

/** The result of validating a ToolRequest's shape against a gateway's own per-tool schemas. */
export type ParseResult<TValidated> = { ok: true; request: TValidated } | { ok: false };

export type ToolCallExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function headerValue(headers: Record<string, string | string[] | undefined> | undefined, name: string): string | undefined {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The agent identity is the token's own validated client id — not a gateway-side name lookup,
 * not a second trust decision. Entra already vouched for it when it issued a Gateway.Invoke
 * token to that specific application; the audit log records exactly that GUID, which is a
 * cryptographically backed identity, unlike the free-text --agent CLI flag Sprint 1's stdio
 * transport never verified at all. actor and requestId are headers the calling agent sets on
 * itself; bin/gateway.ts validates the token and rejects a request missing either header with a
 * 401 or 400 before the MCP transport ever runs, so by the time this is called in production both
 * are guaranteed present. It still falls back to a placeholder rather than throwing, since an
 * in-memory test transport has no HTTP layer beneath it to make that guarantee.
 */
export function sessionFromExtra(extra: ToolCallExtra): SessionContext {
  return {
    actor: headerValue(extra.requestInfo?.headers, "x-actor") ?? "unknown",
    agent: extra.authInfo?.clientId ?? "unknown",
    requestId: headerValue(extra.requestInfo?.headers, "x-request-id") ?? "unknown",
    requestText: headerValue(extra.requestInfo?.headers, "x-request-text") ?? "",
  };
}
