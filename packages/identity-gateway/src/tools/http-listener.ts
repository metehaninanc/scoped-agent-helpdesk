/**
 * The HTTP layer in front of the MCP transport (SPRINT2.md, Stage B, Component 3). Shared by
 * both gateways — the mechanics of "check a bearer token, check two headers, audit a refusal"
 * are identical; what differs (the TokenValidator's own audience, the transport factory, the
 * audit log) is injected, not hardcoded here. This is the same "shared code, not shared
 * configuration" split as GraphClient and TokenValidator.
 *
 * A rejected token, or a well-authenticated request missing the actor/request-id headers the
 * calling agent must set itself, is refused here and never reaches a transport at all — by the
 * time the MCP layer would see it, there is no HTTP status code left to return, and Component 3
 * requires the refusal to come back as a 401. Both refusals are audited: a request that failed
 * authentication is still a request that happened.
 *
 * `createTransport` is a factory, not a fixed instance: a stateless StreamableHTTPServerTransport
 * (no sessionIdGenerator) throws "cannot be reused across requests" if handleRequest is called on
 * it twice, and a Server that is already connected to one transport refuses to connect to a
 * second. Bin/gateway.ts builds a fresh Server and transport pair per call, which is cheap — it
 * only registers handlers over already-shared deps (the audit log, the Graph client, ...), it
 * does not reopen anything.
 *
 * The identity comes from the validated token's own client id and from headers the agent
 * process sets, exactly as documented in tools/server.ts's sessionFromExtra() — never from
 * anything in the JSON-RPC body, which this file never parses at all.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import type { AuditInput, AuditRecord } from "@helpdesk/audit-core";

import type { TokenValidator } from "../auth/verify-token.js";
import { log } from "../log.js";

export interface RequestTransport {
  handleRequest(req: IncomingMessage & { auth?: AuthInfo }, res: ServerResponse): Promise<void>;
}

export interface HttpGatewayDeps {
  /** Builds a fresh, already-connected transport for one request. See the file header. */
  createTransport: () => Promise<RequestTransport>;
  validator: Pick<TokenValidator, "validate">;
  audit: { append(input: AuditInput): AuditRecord };
  /** The path the MCP endpoint is served on. Default: "/mcp". */
  path?: string;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A request listener for node:http's createServer(), auditing every refusal before it happens. */
export function createRequestListener(deps: HttpGatewayDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const path = deps.path ?? "/mcp";

  return async (req, res) => {
    if (req.url !== path) {
      res.writeHead(404).end();
      return;
    }

    const requestId = firstHeader(req.headers["x-request-id"]) ?? randomUUID();
    const actor = firstHeader(req.headers["x-actor"]);

    const result = await deps.validator.validate(req.headers.authorization);
    if (!result.ok) {
      deps.audit.append({
        requestId,
        actor: actor ?? "unknown",
        agent: "unknown",
        tool: null,
        parameters: { authorizationHeaderPresent: req.headers.authorization !== undefined },
        decision: "denied",
        rules: [`deny.${result.reason}`],
      });
      log.warn(`401 ${result.reason} requestId=${requestId}`);
      respond(res, 401, { status: "error", code: `token_${result.reason}`, message: "Bearer token rejected." });
      return;
    }

    if (actor === undefined) {
      deps.audit.append({
        requestId,
        actor: "unknown",
        agent: result.token.clientId,
        tool: null,
        parameters: {},
        decision: "denied",
        rules: ["deny.missing_actor_header"],
      });
      log.warn(`400 missing_actor_header requestId=${requestId}`);
      respond(res, 400, { status: "error", code: "missing_actor_header", message: "x-actor header is required." });
      return;
    }

    // The one thing this handler hands to the MCP layer: which application the token belongs
    // to and what it is scoped to. Never the raw token itself past this point.
    const authedReq = req as IncomingMessage & { auth?: AuthInfo };
    authedReq.auth = { token: "", clientId: result.token.clientId, scopes: result.token.roles };

    const transport = await deps.createTransport();
    await transport.handleRequest(authedReq, res);
  };
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
