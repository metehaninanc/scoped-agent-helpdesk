/**
 * The identity gateway, as an MCP server over HTTP (SPRINT2.md, Stage B, Component 2 and 3).
 * Replaces Sprint 1's stdio transport: this is now a long-running server, started once, not one
 * process per agent session. The call order inside every tool handler is unchanged (see
 * tools/handler.ts): validate, decide, commit the audit record, then branch. As of SPRINT3.md,
 * 3.2, the transport, the bearer token check every request must pass, and that call order itself
 * all live in @helpdesk/gateway-core, shared with the MDM gateway as a real dependency now
 * rather than an import from this package's own internals.
 *
 *   node dist/bin/gateway.js [--port <n>] [--db <path>]
 *
 * Never forwards the incoming bearer token to Graph (see the README, "Stage B: gateways do not
 * forward tokens", for why): this process keeps minting its own Graph token from its own
 * certificate, exactly as it always has.
 *
 * As of Stage B, Component 5, this process is also where ApprovalWorkflow runs (see
 * approvals/decision-listener.ts): the web app no longer holds a Graph credential at all, so
 * executing an approved change has to happen somewhere that does, and this is the same
 * certificate above, not a second one.
 *
 * SPRINT4.md, section 4: this process is also where RationaleWorkflow runs, at its own path,
 * POST /approvals/rationale — generating a briefing is now something the console asks for, on an
 * opened approval, not something onApproval does automatically at creation time (see
 * ../approvals/rationale-workflow.ts).
 *
 * stdout is free again now that the protocol runs over HTTP; log.ts still writes to stderr only,
 * out of habit and because nothing depends on stdout being clean anymore.
 */
import { readFileSync } from "node:fs";
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
import { HandoffStore } from "@helpdesk/handoff-core";

import { createRationaleGenerator, type RationaleGenerator } from "../approvals/rationale.js";
import { createRationaleListener } from "../approvals/rationale-listener.js";
import { RationaleWorkflow } from "../approvals/rationale-workflow.js";
import { createApprovalExecute } from "../approvals/execute.js";
import { loadGatewayEnv } from "../env.js";
import { CertificateCredential } from "../graph/certificate-credential.js";
import { GraphClient } from "../graph/client.js";
import { log } from "../log.js";
import { policyConfig } from "../policy/config.js";
import { formatFinding, verifyManagedGroups } from "../startup/verify-managed-groups.js";
import { describeError } from "../tools/handler.js";
import { createGatewayServer } from "../tools/server.js";

const DECISION_PATH = "/approvals/decide";
const RATIONALE_PATH = "/approvals/rationale";

const DEFAULT_DB_PATH = "data/identity-helpdesk.db";
const DEFAULT_PORT = 3001;
const REQUIRED_ROLE = "Gateway.Invoke";

function parseCliArgs(): { db: string | undefined; port: number | undefined } {
  const { values } = parseArgs({ options: { db: { type: "string" }, port: { type: "string" } }, strict: true });
  return { db: values.db, port: values.port === undefined ? undefined : Number.parseInt(values.port, 10) };
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const env = loadGatewayEnv();

  const credential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_IDENTITY_CLIENT_ID,
    thumbprint: env.AZURE_IDENTITY_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_IDENTITY_CERT_PATH),
  });
  const graph = new GraphClient({ credential });

  const dbPath = resolve(args.db ?? env.HELPDESK_DB_PATH ?? DEFAULT_DB_PATH);
  const db = openDatabase(dbPath, { create: true });
  const audit = new AuditLog(db);
  const approvals = new ApprovalStore(db);
  const handoffs = new HandoffStore(db, audit);

  // Startup-only: does config.ts still describe the tenant? Warn, never mutate the allowlist.
  for (const finding of await verifyManagedGroups(graph, policyConfig.managedGroups)) {
    log.warn(formatFinding(finding));
  }

  let rationale: RationaleGenerator | undefined;
  if (env.ANTHROPIC_API_KEY === undefined) {
    log.warn("ANTHROPIC_API_KEY is not set: no briefing can be generated for any approval on this gateway");
  } else {
    rationale = createRationaleGenerator({
      apiKey: env.ANTHROPIC_API_KEY,
      ...(env.HELPDESK_RATIONALE_MODEL === undefined ? {} : { model: env.HELPDESK_RATIONALE_MODEL }),
    });
  }

  const gatewayDeps = { audit, approvals, handoffs, graph, config: policyConfig };

  // A fresh Server and transport pair per request: see @helpdesk/gateway-core's server.ts
  // header comment (createTransportFactory) for why a stateless transport cannot be reused.
  const createTransport = createTransportFactory(() => createGatewayServer(gatewayDeps));

  const validator = new TokenValidator({ tenantId: env.AZURE_TENANT_ID, audience: env.IDENTITY_GATEWAY_AUDIENCE, requiredRole: REQUIRED_ROLE });
  const mcpListener = createRequestListener({ createTransport, validator, audit, log });

  const approvalWorkflow = new ApprovalWorkflow({ approvals, audit, execute: createApprovalExecute(graph), describeError });
  const decisionListener = createDecisionListener({ workflow: approvalWorkflow, validator, audit, path: DECISION_PATH });

  // Only wired when a generator is configured; a POST here otherwise gets a plain, honest 503
  // rather than a listener that would just throw on the first request.
  const rationaleWorkflow = rationale && new RationaleWorkflow({ approvals, audit, generator: rationale, config: policyConfig });
  const rationaleListener = rationaleWorkflow
    ? createRationaleListener({ workflow: rationaleWorkflow, validator, audit, path: RATIONALE_PATH })
    : async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
        res.writeHead(503, { "content-type": "application/json" }).end(
          JSON.stringify({ code: "not_configured", message: "ANTHROPIC_API_KEY is not set on this gateway; no briefing can be generated." }),
        );
      };

  const port = args.port ?? Number.parseInt(process.env.IDENTITY_GATEWAY_PORT ?? String(DEFAULT_PORT), 10);
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const handle = req.url === DECISION_PATH ? decisionListener : req.url === RATIONALE_PATH ? rationaleListener : mcpListener;
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
    log.info(
      `ready: http://127.0.0.1:${port}/mcp, ${DECISION_PATH} and ${RATIONALE_PATH} audience=${env.IDENTITY_GATEWAY_AUDIENCE} db=${dbPath} managedGroups=${policyConfig.managedGroups.length} rationale=${rationale === undefined ? "off" : (env.HELPDESK_RATIONALE_MODEL ?? "claude-opus-5")}`,
    );
  });
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
