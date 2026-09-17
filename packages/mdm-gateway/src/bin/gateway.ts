/**
 * The MDM gateway, as an MCP server over stdio. Same spawn shape as the identity gateway's
 * (packages/identity-gateway/src/bin/gateway.ts), a disjoint credential: this process holds the
 * `helpdesk-mdm-gateway` certificate, scoped to Device.Read.All only.
 *
 *   node dist/bin/gateway.js --actor <upn> --request-id <id> [--agent <name>] [--db <path>]
 *
 * One process per agent session. The requesting user's identity and the session's requestId
 * are bound here, at spawn, never taken from the model.
 *
 * The default database path is hardcoded, not read from HELPDESK_DB_PATH: that variable is
 * shared with the identity gateway, and defaulting to it here would let one env file silently
 * point both gateways at the same file, merging the two audit chains SPRINT2.md, Component 6
 * says to keep separate. `--db` still overrides it explicitly, per invocation.
 *
 * stdout is the protocol channel. Everything human-facing goes to stderr via log.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AuditLog } from "@helpdesk/audit-core";
import { CertificateCredential, GraphClient, loadGatewayEnv, openDatabase, userPrincipalName } from "@helpdesk/identity-gateway";

import { log } from "../log.js";
import { policyConfig } from "../policy/config.js";
import { createGatewayServer } from "../tools/server.js";

const DEFAULT_DB_PATH = "data/mdm-helpdesk.db";

function parseSession(): { actor: string; agent: string; requestId: string; db: string | undefined } {
  const { values } = parseArgs({
    options: {
      actor: { type: "string" },
      "request-id": { type: "string" },
      agent: { type: "string", default: "mdm-agent" },
      db: { type: "string" },
    },
    strict: true,
  });

  const actor = userPrincipalName.safeParse(values.actor);
  if (!actor.success) throw new Error("--actor must be the requesting user's UPN");
  if (!values["request-id"] || values["request-id"].trim() === "") throw new Error("--request-id is required");

  return { actor: actor.data, agent: values.agent, requestId: values["request-id"], db: values.db };
}

async function main(): Promise<void> {
  const session = parseSession();
  const env = loadGatewayEnv();

  const credential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_MDM_CLIENT_ID,
    thumbprint: env.AZURE_MDM_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_MDM_CERT_PATH),
  });
  const graph = new GraphClient({ credential });

  const dbPath = resolve(session.db ?? DEFAULT_DB_PATH);
  const db = openDatabase(dbPath);
  const audit = new AuditLog(db);

  const server = createGatewayServer(
    { actor: session.actor, agent: session.agent, requestId: session.requestId },
    { audit, graph, config: policyConfig },
  );

  const shutdown = (why: string): void => {
    log.info(`shutting down (${why})`);
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const transport = new StdioServerTransport();
  transport.onclose = () => shutdown("stdin closed");
  await server.connect(transport);

  log.info(`ready: actor=${session.actor} agent=${session.agent} requestId=${session.requestId} db=${dbPath}`);
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
