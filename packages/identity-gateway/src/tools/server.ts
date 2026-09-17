/**
 * The MCP surface: exactly four tools, advertised from descriptions.ts, dispatched through
 * handler.ts. Built on the low-level Server rather than McpServer.registerTool on purpose:
 * registerTool validates arguments before the handler runs, and a malformed call rejected
 * there would never reach decide() or the audit log. Here every call is audited.
 *
 * SPRINT2.md, Stage B: the gateway runs over HTTP now, not stdio (see bin/gateway.ts), so there
 * is no longer one fixed session bound at process spawn. Each tool call derives its own
 * SessionContext from the already-validated bearer token and from x-actor/x-request-id headers
 * the calling agent sets itself. bin/gateway.ts validates the token and rejects a request
 * missing either header with a 401 or 400 before transport.handleRequest ever runs, so by the
 * time sessionFromExtra() below is called in production, both are guaranteed present; it still
 * falls back to a placeholder rather than throwing, since the in-memory test transport used in
 * server.test.ts has no HTTP layer beneath it to make that guarantee.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ServerNotification,
  type ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

import { log } from "../log.js";
import { toolDefinitions } from "./descriptions.js";
import { handleToolCall, type GatewayDeps, type SessionContext } from "./handler.js";

export const GATEWAY_NAME = "helpdesk-identity-gateway";
export const GATEWAY_VERSION = "0.1.0";

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
 * transport never verified at all.
 */
export function sessionFromExtra(extra: ToolCallExtra): SessionContext {
  return {
    actor: headerValue(extra.requestInfo?.headers, "x-actor") ?? "unknown",
    agent: extra.authInfo?.clientId ?? "unknown",
    requestId: headerValue(extra.requestInfo?.headers, "x-request-id") ?? "unknown",
  };
}

export function createGatewayServer(deps: GatewayDeps): Server {
  const server = new Server({ name: GATEWAY_NAME, version: GATEWAY_VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions() }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    try {
      const session = sessionFromExtra(extra);
      const result = await handleToolCall(request.params.name, request.params.arguments, session, deps);
      return { content: result.content, isError: result.isError ?? false };
    } catch (error) {
      // Only the audit write can throw out of the handler. No record means no action, and the
      // agent must hear that as a failure of the gateway, not of the request.
      log.error(`tool call ${request.params.name} aborted: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              code: "gateway_unavailable",
              message: "The gateway could not record this call, so it did nothing. Report this to the requester.",
            }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
