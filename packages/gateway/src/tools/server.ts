/**
 * The MCP surface: exactly two tools, advertised from descriptions.ts, dispatched through
 * handler.ts. Built on the low-level Server rather than McpServer.registerTool on purpose:
 * registerTool validates arguments before the handler runs, and a malformed call rejected
 * there would never reach decide() or the audit log. Here every call is audited.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { log } from "../log.js";
import { toolDefinitions } from "./descriptions.js";
import { handleToolCall, type GatewayDeps, type SessionContext } from "./handler.js";

export const GATEWAY_NAME = "helpdesk-identity-gateway";
export const GATEWAY_VERSION = "0.1.0";

export function createGatewayServer(session: SessionContext, deps: GatewayDeps): Server {
  const server = new Server({ name: GATEWAY_NAME, version: GATEWAY_VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions(deps.config) }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    try {
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
