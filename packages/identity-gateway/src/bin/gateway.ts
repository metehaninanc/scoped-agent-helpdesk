/**
 * The identity gateway, as an MCP server over HTTP (SPRINT2.md, Stage B, Component 2 and 3).
 * Replaces Sprint 1's stdio transport: this is now a long-running server, started once, not one
 * process per agent session. The call order inside every tool handler is unchanged (see
 * tools/handler.ts): validate, decide, commit the audit record, then branch. What is new is
 * everything in front of that: the transport, and the bearer token every request must carry
 * (see tools/http-listener.ts, shared with the MDM gateway).
 *
 *   node dist/bin/gateway.js [--port <n>] [--db <path>]
 *
 * Never forwards the incoming bearer token to Graph (see the README, "Stage B: gateways do not
 * forward tokens", for why): this process keeps minting its own Graph token from its own
 * certificate, exactly as it always has.
 *
 * stdout is free again now that the protocol runs over HTTP; log.ts still writes to stderr only,
 * out of habit and because nothing depends on stdout being clean anymore.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { AuditLog } from "@helpdesk/audit-core";

import { createRationaleGenerator, type RationaleGenerator } from "../approvals/rationale.js";
import { ApprovalStore } from "../approvals/store.js";
import { TokenValidator } from "../auth/verify-token.js";
import { openDatabase } from "../db.js";
import { loadGatewayEnv } from "../env.js";
import { CertificateCredential } from "../graph/certificate-credential.js";
import { GraphClient } from "../graph/client.js";
import { log } from "../log.js";
import { policyConfig } from "../policy/config.js";
import { formatFinding, verifyManagedGroups } from "../startup/verify-managed-groups.js";
import { createRequestListener } from "../tools/http-listener.js";
import { createGatewayServer } from "../tools/server.js";

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
  const db = openDatabase(dbPath);
  const audit = new AuditLog(db);
  const approvals = new ApprovalStore(db);

  // Startup-only: does config.ts still describe the tenant? Warn, never mutate the allowlist.
  for (const finding of await verifyManagedGroups(graph, policyConfig.managedGroups)) {
    log.warn(formatFinding(finding));
  }

  let rationale: RationaleGenerator | undefined;
  if (env.ANTHROPIC_API_KEY === undefined) {
    log.warn("ANTHROPIC_API_KEY is not set: approvals will be created without a rationale");
  } else {
    rationale = createRationaleGenerator({
      apiKey: env.ANTHROPIC_API_KEY,
      ...(env.HELPDESK_RATIONALE_MODEL === undefined ? {} : { model: env.HELPDESK_RATIONALE_MODEL }),
    });
  }

  const gatewayDeps = { audit, approvals, graph, config: policyConfig, ...(rationale === undefined ? {} : { rationale }) };

  // A stateless transport (no sessionIdGenerator — omitted entirely, not set to undefined, to
  // sidestep an exactOptionalPropertyTypes/accessor-pair quirk in the SDK's own type
  // declarations) throws if handleRequest runs on it twice, and a Server already connected to
  // one transport refuses a second. So: a fresh Server and transport pair per request, built
  // over the same shared deps. See tools/http-listener.ts's header comment for why.
  async function createTransport(): Promise<StreamableHTTPServerTransport> {
    const transport = new StreamableHTTPServerTransport();
    // The cast works around an exactOptionalPropertyTypes/accessor-pair mismatch between this
    // transport's own onclose setter type and the Transport interface Server.connect() expects
    // — a type-declaration quirk in this SDK version, not a real shape mismatch.
    await createGatewayServer(gatewayDeps).connect(transport as unknown as Transport);
    return transport;
  }

  const validator = new TokenValidator({ tenantId: env.AZURE_TENANT_ID, audience: env.IDENTITY_GATEWAY_AUDIENCE, requiredRole: REQUIRED_ROLE });
  const listener = createRequestListener({ createTransport, validator, audit });

  const port = args.port ?? Number.parseInt(process.env.IDENTITY_GATEWAY_PORT ?? String(DEFAULT_PORT), 10);
  const httpServer = createServer((req, res) => {
    listener(req, res).catch((error: unknown) => {
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
      `ready: http://127.0.0.1:${port}/mcp audience=${env.IDENTITY_GATEWAY_AUDIENCE} db=${dbPath} managedGroups=${policyConfig.managedGroups.length} rationale=${rationale === undefined ? "off" : (env.HELPDESK_RATIONALE_MODEL ?? "claude-opus-5")}`,
    );
  });
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
