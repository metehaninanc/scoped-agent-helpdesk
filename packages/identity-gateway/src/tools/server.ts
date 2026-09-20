/**
 * This gateway's identity on the MCP surface. The mechanics — Server setup, ListTools/CallTool
 * handlers, deriving a session from the validated request — are identical for every gateway and
 * now live in @helpdesk/gateway-core (SPRINT3.md, 3.2); this file supplies only what is this
 * gateway's own: its name, its tool definitions, and its call-order wiring (handler.ts).
 */
import { createGatewayServer as createCoreGatewayServer, type CreateGatewayServerOptions } from "@helpdesk/gateway-core";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { toolDefinitions } from "./descriptions.js";
import { handleToolCall, type GatewayDeps } from "./handler.js";

export const GATEWAY_NAME = "helpdesk-identity-gateway";
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
