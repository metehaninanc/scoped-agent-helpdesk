/**
 * This gateway's identity on the MCP surface. Same shape as every other gateway's own
 * tools/server.ts — the mechanics live in @helpdesk/gateway-core (SPRINT3.md, 3.2) and only the
 * name, tool definitions and call-order wiring (handler.ts) are this gateway's own.
 */
import { createGatewayServer as createCoreGatewayServer, type CreateGatewayServerOptions } from "@helpdesk/gateway-core";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { toolDefinitions } from "./descriptions.js";
import { handleToolCall, type GatewayDeps } from "./handler.js";

export const GATEWAY_NAME = "helpdesk-endpoint-gateway";
export const GATEWAY_VERSION = "0.1.0";

export function createGatewayServer(deps: GatewayDeps): Server {
  const options: CreateGatewayServerOptions = {
    name: GATEWAY_NAME,
    version: GATEWAY_VERSION,
    listTools: toolDefinitions,
    onToolCall: (tool, args, session) => handleToolCall(tool, args, session, deps),
  };
  return createCoreGatewayServer(options);
}

export { sessionFromExtra, type ToolCallExtra } from "@helpdesk/gateway-core";
