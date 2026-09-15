/**
 * The identity gateway, as an MCP server over stdio.
 *
 *   node dist/bin/gateway.js --actor <upn> --request-id <id> [--agent <name>] [--db <path>]
 *
 * One process per agent session. The requesting user's identity and the session's requestId
 * are bound here, at spawn, from arguments the agent runtime supplies. They are never taken
 * from the model: nothing the model sends can change who the gateway is acting for.
 *
 * stdout is the protocol channel. Everything human-facing goes to stderr via log.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ApprovalStore } from "../approvals/store.js";
import { AuditLog } from "../audit/audit-log.js";
import { openDatabase } from "../db.js";
import { loadGatewayEnv } from "../env.js";
import { CertificateCredential } from "../graph/certificate-credential.js";
import { GraphClient } from "../graph/client.js";
import { log } from "../log.js";
import { policyConfig } from "../policy/config.js";
import { userPrincipalName } from "../policy/schemas.js";
import { formatFinding, verifyManagedGroups } from "../startup/verify-managed-groups.js";
import { createGatewayServer } from "../tools/server.js";

const DEFAULT_DB_PATH = "data/helpdesk.db";

function parseSession(): { actor: string; agent: string; requestId: string; db: string | undefined } {
  const { values } = parseArgs({
    options: {
      actor: { type: "string" },
      "request-id": { type: "string" },
      agent: { type: "string", default: "identity-agent" },
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
    clientId: env.AZURE_CLIENT_ID,
    thumbprint: env.AZURE_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_CERT_PATH),
  });
  const graph = new GraphClient({ credential });

  const dbPath = resolve(session.db ?? env.HELPDESK_DB_PATH ?? DEFAULT_DB_PATH);
  const db = openDatabase(dbPath);
  const audit = new AuditLog(db);
  const approvals = new ApprovalStore(db);

  // Startup-only: does config.ts still describe the tenant? Warn, never mutate the allowlist.
  for (const finding of await verifyManagedGroups(graph, policyConfig.managedGroups)) {
    log.warn(formatFinding(finding));
  }

  const server = createGatewayServer(
    { actor: session.actor, agent: session.agent, requestId: session.requestId },
    { audit, approvals, graph, config: policyConfig },
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

  log.info(
    `ready: actor=${session.actor} agent=${session.agent} requestId=${session.requestId} db=${dbPath} managedGroups=${policyConfig.managedGroups.length}`,
  );
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
