/**
 * The MDM gateway, as an MCP server over HTTP (SPRINT2.md, Stage B, Component 2 and 3). Same
 * shape as the identity gateway's (packages/identity-gateway/src/bin/gateway.ts): as of
 * SPRINT3.md 3.2, both reuse TokenValidator, createRequestListener and createTransportFactory
 * from @helpdesk/gateway-core, a neutral package, rather than this gateway importing them from
 * the identity gateway's own internals as it did before this phase (this gateway supplies its
 * own audience and its own certificate; the mechanics, not the configuration, are what is
 * shared). A disjoint credential still: this process holds the `helpdesk-mdm-gateway`
 * certificate, scoped to Device.Read.All only, and validates tokens against its own Application
 * ID URI, never the identity gateway's.
 *
 *   node dist/bin/gateway.js [--port <n>] [--db <path>]
 *
 * The default database path is not read from any environment variable: SPRINT3.md 3.2 gave this
 * gateway its own env.ts (env.ts), separate from the identity gateway's HELPDESK_DB_PATH, and
 * defaulting to a shared variable would let one env file silently point both gateways at the
 * same file, merging the two audit chains SPRINT2.md, Component 6 says to keep separate. `--db`
 * still overrides the default explicitly.
 *
 * Never forwards the incoming bearer token to Graph: this process keeps minting its own Graph
 * token from its own certificate, exactly as it always has.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { AuditLog } from "@helpdesk/audit-core";
import { TokenValidator, createRequestListener, createTransportFactory, openDatabase } from "@helpdesk/gateway-core";
import { CertificateCredential, GraphClient } from "@helpdesk/identity-gateway";

import { loadMdmGatewayEnv } from "../env.js";
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
  const env = loadMdmGatewayEnv();

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

  // A fresh Server and transport pair per request: see @helpdesk/gateway-core's server.ts
  // header comment (createTransportFactory) for why a stateless transport cannot be reused.
  const createTransport = createTransportFactory(() => createGatewayServer(gatewayDeps));

  const validator = new TokenValidator({ tenantId: env.AZURE_TENANT_ID, audience: env.MDM_GATEWAY_AUDIENCE, requiredRole: REQUIRED_ROLE });
  const listener = createRequestListener({ createTransport, validator, audit, log });

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
