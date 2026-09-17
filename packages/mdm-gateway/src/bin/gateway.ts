/**
 * The MDM gateway, as an MCP server over HTTP (SPRINT2.md, Stage B, Component 2 and 3). Same
 * shape as the identity gateway's (packages/identity-gateway/src/bin/gateway.ts), reusing its
 * TokenValidator and createRequestListener (shared code, not shared configuration: this
 * gateway supplies its own audience and its own certificate). A disjoint credential still: this
 * process holds the `helpdesk-mdm-gateway` certificate, scoped to Device.Read.All only, and
 * validates tokens against its own Application ID URI, never the identity gateway's.
 *
 *   node dist/bin/gateway.js [--port <n>] [--db <path>]
 *
 * The default database path is hardcoded, not read from HELPDESK_DB_PATH: that variable is
 * shared with the identity gateway, and defaulting to it here would let one env file silently
 * point both gateways at the same file, merging the two audit chains SPRINT2.md, Component 6
 * says to keep separate. `--db` still overrides it explicitly.
 *
 * Never forwards the incoming bearer token to Graph: this process keeps minting its own Graph
 * token from its own certificate, exactly as it always has.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { AuditLog } from "@helpdesk/audit-core";
import {
  CertificateCredential,
  GraphClient,
  TokenValidator,
  createRequestListener,
  loadGatewayEnv,
  openDatabase,
} from "@helpdesk/identity-gateway";

import { log } from "../log.js";
import { policyConfig } from "../policy/config.js";
import { createGatewayServer } from "../tools/server.js";

const DEFAULT_DB_PATH = "data/mdm-helpdesk.db";
const DEFAULT_PORT = 3002;
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
    clientId: env.AZURE_MDM_CLIENT_ID,
    thumbprint: env.AZURE_MDM_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_MDM_CERT_PATH),
  });
  const graph = new GraphClient({ credential });

  const dbPath = resolve(args.db ?? DEFAULT_DB_PATH);
  const db = openDatabase(dbPath);
  const audit = new AuditLog(db);

  const gatewayDeps = { audit, graph, config: policyConfig };

  // A fresh Server and transport pair per request: see the identity gateway's http-listener.ts
  // header comment for why a stateless transport cannot be reused across requests.
  async function createTransport(): Promise<StreamableHTTPServerTransport> {
    const transport = new StreamableHTTPServerTransport();
    await createGatewayServer(gatewayDeps).connect(transport as unknown as Transport);
    return transport;
  }

  const validator = new TokenValidator({ tenantId: env.AZURE_TENANT_ID, audience: env.MDM_GATEWAY_AUDIENCE, requiredRole: REQUIRED_ROLE });
  const listener = createRequestListener({ createTransport, validator, audit });

  const port = args.port ?? Number.parseInt(process.env.MDM_GATEWAY_PORT ?? String(DEFAULT_PORT), 10);
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
    log.info(`ready: http://127.0.0.1:${port}/mcp audience=${env.MDM_GATEWAY_AUDIENCE} db=${dbPath}`);
  });
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
