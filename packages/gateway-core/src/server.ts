/**
 * The MCP surface every gateway serves its tools through (SPRINT3.md, 3.2): a low-level
 * `Server`, never the SDK's higher-level `registerTool`, because `registerTool` validates
 * arguments before the handler runs, and a call rejected there would never reach decide() or
 * the audit log — here every call is audited (SPRINT1.md, Component 2).
 *
 * A gateway supplies its name, version, tool list and a single `onToolCall` — already closed
 * over that gateway's own `runToolCall()` dependencies (config, decide, parse, execute, ...).
 * This file does not know what a tool call does; it only knows how to receive one, derive who is
 * asking from the already-validated request (never the JSON-RPC body), and hand both to the
 * caller.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { createLogger, type Logger } from "./log.js";
import { sessionFromExtra, type SessionContext, type ToolCallExtra } from "./session.js";
import type { ToolCallResult } from "./tool-call.js";

export type { ToolCallExtra } from "./session.js";
export { sessionFromExtra } from "./session.js";

const defaultLog = createLogger("gateway-core");

/** The minimum shape a gateway's own `toolDefinitions()` must produce. Structural, not the
 * SDK's own `Tool` type, so this file's dependency on the SDK's type surface stays narrow. */
export interface ToolDefinitionLike {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface CreateGatewayServerOptions {
  name: string;
  version: string;
  listTools: () => ToolDefinitionLike[];
  onToolCall: (tool: string, args: unknown, session: SessionContext) => Promise<ToolCallResult>;
  /** Injectable so a gateway_unavailable error logs under this gateway's own prefix. */
  log?: Logger;
}

export function createGatewayServer(options: CreateGatewayServerOptions): Server {
  const log = options.log ?? defaultLog;
  const server = new Server({ name: options.name, version: options.version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: options.listTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra: ToolCallExtra): Promise<CallToolResult> => {
    try {
      const session = sessionFromExtra(extra);
      const result = await options.onToolCall(request.params.name, request.params.arguments, session);
      return { content: result.content, isError: result.isError ?? false };
    } catch (error) {
      // Only the audit write can throw out of onToolCall. No record means no action, and the
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

/**
 * A stateless `StreamableHTTPServerTransport` (no sessionIdGenerator) throws if `handleRequest`
 * runs on it twice, and a `Server` already connected to one transport refuses a second. So: a
 * fresh `Server` and transport pair per HTTP request, over whatever already-shared dependencies
 * `buildServer` closes over (the audit log, a backend client, ...) — cheap, since building the
 * pair only registers a few JSON-RPC handlers, it does not reopen anything.
 */
export function createTransportFactory(buildServer: () => Server): () => Promise<StreamableHTTPServerTransport> {
  return async () => {
    const transport = new StreamableHTTPServerTransport();
    // The cast works around an exactOptionalPropertyTypes/accessor-pair mismatch between this
    // transport's own onclose setter type and the Transport interface Server.connect() expects
    // — a type-declaration quirk in this SDK version, not a real shape mismatch.
    await buildServer().connect(transport as unknown as Transport);
    return transport;
  };
}
