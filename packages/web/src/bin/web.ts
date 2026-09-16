/**
 * The web app entry point. Two server-rendered pages (server.ts); no framework, no build
 * pipeline (SPRINT1.md, Component 6).
 *
 * This process holds Graph credentials directly, alongside the gateway, because Sprint 1 has
 * no HTTP transport on the gateway for it to call into instead (a named Sprint 2 item — see
 * README). It is a human-only interface: an approver acting here is the same trust boundary
 * as the gateway process itself, not model-reachable.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runIdentityAgent } from "@helpdesk/agent";
import { AuditLog } from "@helpdesk/audit-core";
import {
  ApprovalStore,
  ApprovalWorkflow,
  CertificateCredential,
  GraphClient,
  loadGatewayEnv,
  openDatabase,
} from "@helpdesk/gateway";

import { createWebServer } from "../server.js";

const env = loadGatewayEnv();
const port = Number.parseInt(process.env.WEB_PORT ?? "3000", 10);
const dbPath = resolve(env.HELPDESK_DB_PATH ?? "data/helpdesk.db");

const db = openDatabase(dbPath);
const approvals = new ApprovalStore(db);
const audit = new AuditLog(db);

const credential = new CertificateCredential({
  tenantId: env.AZURE_TENANT_ID,
  clientId: env.AZURE_CLIENT_ID,
  thumbprint: env.AZURE_CERT_THUMBPRINT,
  privateKeyPem: readFileSync(env.AZURE_CERT_PATH),
});
const graph = new GraphClient({ credential });
const workflow = new ApprovalWorkflow({ approvals, audit, graph });

const server = createWebServer({
  runIdentityAgent: (input) => runIdentityAgent({ actor: input.actor, requestText: input.requestText, dbPath }),
  decide: (input) => workflow.decide(input),
  listPendingApprovals: () => approvals.listPending(),
  getApproval: (id) => approvals.get(id),
});

const shutdown = (why: string): void => {
  console.error(`[web] shutting down (${why})`);
  server.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen(port, () => {
  console.error(`[web] listening on http://localhost:${port} (db=${dbPath})`);
});
