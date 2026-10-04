/**
 * The knowledge gateway, as an MCP server over HTTP (SPRINT3.md, 3.3). Same shape as the other
 * two gateways' bin/gateway.ts, built on the same @helpdesk/gateway-core — and the one that
 * finally exercises the two seams that package left optional from the start: no credential
 * (there is no `CertificateCredential`, anywhere in this file) and no backend client at all
 * (`search` below is a synchronous, in-memory lookup over a corpus vendored into this package,
 * never a network call).
 *
 *   node dist/bin/gateway.js [--port <n>] [--db <path>]
 *
 * The default database path is not read from any shared environment variable, same reasoning as
 * the MDM gateway's own: three gateways sharing one audit chain would defeat the isolation
 * SPRINT2.md's Component 6 argues for. `--db` overrides the default explicitly.
 */
import { createServer } from "node:http";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { AuditLog } from "@helpdesk/audit-core";
import { TokenValidator, createRequestListener, createTransportFactory, openDatabase } from "@helpdesk/gateway-core";
import { HandoffStore } from "@helpdesk/handoff-core";

import { corpusRawDir, loadCorpus } from "../corpus.js";
import { loadKnowledgeGatewayEnv } from "../env.js";
import { log } from "../log.js";
import { policyConfig } from "../policy/config.js";
import { createDocumentationSearch } from "../search.js";
import { createGatewayServer } from "../tools/server.js";

const DEFAULT_DB_PATH = "data/knowledge-helpdesk.db";
const DEFAULT_PORT = 3003;
const REQUIRED_ROLE = "Gateway.Invoke";

function parseCliArgs(): { db: string | undefined; port: number | undefined } {
  const { values } = parseArgs({ options: { db: { type: "string" }, port: { type: "string" } }, strict: true });
  return { db: values.db, port: values.port === undefined ? undefined : Number.parseInt(values.port, 10) };
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const env = loadKnowledgeGatewayEnv();

  const chunks = loadCorpus();
  const documentationSearch = createDocumentationSearch(chunks);

  const dbPath = resolve(args.db ?? DEFAULT_DB_PATH);
  const db = openDatabase(dbPath, { create: true });
  const audit = new AuditLog(db);
  const handoffs = new HandoffStore(db, audit);

  const gatewayDeps = { audit, search: (query: string) => documentationSearch.search(query), handoffs, config: policyConfig };

  // A fresh Server and transport pair per request: see @helpdesk/gateway-core's server.ts
  // header comment (createTransportFactory) for why a stateless transport cannot be reused.
  const createTransport = createTransportFactory(() => createGatewayServer(gatewayDeps));

  const validator = new TokenValidator({ tenantId: env.AZURE_TENANT_ID, audience: env.KNOWLEDGE_GATEWAY_AUDIENCE, requiredRole: REQUIRED_ROLE });
  const listener = createRequestListener({ createTransport, validator, audit, log });

  const port = args.port ?? Number.parseInt(process.env.KNOWLEDGE_GATEWAY_PORT ?? String(DEFAULT_PORT), 10);
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
      `ready: http://127.0.0.1:${port}/mcp audience=${env.KNOWLEDGE_GATEWAY_AUDIENCE} db=${dbPath} corpus=${chunks.length} chunks from ${corpusRawDir()}`,
    );
  });
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
