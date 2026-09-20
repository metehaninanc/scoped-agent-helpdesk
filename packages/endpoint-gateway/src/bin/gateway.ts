/**
 * The endpoint gateway, as an MCP server over HTTP, built on @helpdesk/gateway-core the same way
 * every gateway since SPRINT3.md, 3.2 is. SPRINT3.md, 3.4: this process holds no credential of
 * any kind — no certificate, no client id, nothing — because its two reads and one gated write
 * run against a local stub service, and its one Graph-shaped tool, reset_password, is never
 * executed (see policy/decide.ts and tools/handler.ts). This is the second gateway in this
 * project with zero credential (the first was the knowledge gateway, SPRINT3.md 3.3), for a
 * different reason than the first: the knowledge gateway has none because its backend needs
 * none; this one has none because the one capability that would need Graph access was
 * deliberately never built (see the README, "Endpoint gateway notes").
 *
 * This process is also where the endpoint gateway's own ApprovalWorkflow runs, reached through
 * its own non-MCP HTTP endpoint (approvals/decision-listener, from @helpdesk/gateway-core) —
 * its own approval store and its own audit chain, not the identity gateway's, for the same
 * reason the identity and MDM gateways' chains have always been kept separate (SPRINT2.md,
 * Component 6: "a compromise of one cannot rewrite the other's history").
 *
 *   node dist/bin/gateway.js [--port <n>] [--db <path>]
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { AuditLog } from "@helpdesk/audit-core";
import {
  ApprovalStore,
  ApprovalWorkflow,
  TokenValidator,
  createDecisionListener,
  createRequestListener,
  createTransportFactory,
  openDatabase,
} from "@helpdesk/gateway-core";

import { createApprovalExecute } from "../approvals/execute.js";
import { loadEndpointGatewayEnv } from "../env.js";
import { log } from "../log.js";
import { policyConfig } from "../policy/config.js";
import { createEndpointService } from "../stub/endpoint-service.js";
import { describeError } from "../tools/handler.js";
import { createGatewayServer } from "../tools/server.js";

const DECISION_PATH = "/approvals/decide";

const DEFAULT_DB_PATH = "data/endpoint-helpdesk.db";
const DEFAULT_PORT = 3004;
const REQUIRED_ROLE = "Gateway.Invoke";

function parseCliArgs(): { db: string | undefined; port: number | undefined } {
  const { values } = parseArgs({ options: { db: { type: "string" }, port: { type: "string" } }, strict: true });
  return { db: values.db, port: values.port === undefined ? undefined : Number.parseInt(values.port, 10) };
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const env = loadEndpointGatewayEnv();

  const stub = createEndpointService();

  const dbPath = resolve(args.db ?? DEFAULT_DB_PATH);
  const db = openDatabase(dbPath);
  const audit = new AuditLog(db);
  const approvals = new ApprovalStore(db);

  const gatewayDeps = { audit, approvals, stub, config: policyConfig };

  // A fresh Server and transport pair per request: see @helpdesk/gateway-core's server.ts
  // header comment (createTransportFactory) for why a stateless transport cannot be reused.
  const createTransport = createTransportFactory(() => createGatewayServer(gatewayDeps));

  const validator = new TokenValidator({ tenantId: env.AZURE_TENANT_ID, audience: env.ENDPOINT_GATEWAY_AUDIENCE, requiredRole: REQUIRED_ROLE });
  const mcpListener = createRequestListener({ createTransport, validator, audit, log });

  const approvalWorkflow = new ApprovalWorkflow({ approvals, audit, execute: createApprovalExecute(stub), describeError });
  const decisionListener = createDecisionListener({ workflow: approvalWorkflow, validator, audit, path: DECISION_PATH });

  const port = args.port ?? Number.parseInt(process.env.ENDPOINT_GATEWAY_PORT ?? String(DEFAULT_PORT), 10);
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const handle = req.url === DECISION_PATH ? decisionListener : mcpListener;
    handle(req, res).catch((error: unknown) => {
      log.error(`request ${req.url} aborted: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  const shutdown = (why: string): void => {
    log.info(`shutting down (${why})`);
    httpServer.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  httpServer.listen(port, () => {
    log.info(`ready: http://127.0.0.1:${port}/mcp and ${DECISION_PATH} audience=${env.ENDPOINT_GATEWAY_AUDIENCE} db=${dbPath} stub=local`);
  });
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
