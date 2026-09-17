/**
 * The MCP surface: exactly two tools, advertised from descriptions.ts, dispatched through
 * handler.ts. Same low-level Server choice as the identity gateway's server.ts, for the same
 * reason: registerTool validates arguments before the handler runs, and a call rejected there
 * would never reach decide() or the audit log.
 *
 * SPRINT2.md, Stage B: HTTP now, not stdio (see bin/gateway.ts), so there is no longer one fixed
 * session bound at process spawn. Each tool call derives its own SessionContext the same way the
 * identity gateway's server.ts does — see that file's header comment for the full reasoning;
 * this is the same shape, not shared code, since each gateway's Server wiring is its own.
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

export const GATEWAY_NAME = "helpdesk-mdm-gateway";
export const GATEWAY_VERSION = "0.1.0";

export type ToolCallExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function headerValue(headers: Record<string, string | string[] | undefined> | undefined, name: string): string | undefined {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Same as the identity gateway's sessionFromExtra(): the agent identity is the token's own
 * validated client id, actor and requestId are headers the calling agent sets itself. */
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
