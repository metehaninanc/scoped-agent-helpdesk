/**
 * The web app entry point. Two server-rendered pages (server.ts); no framework, no build
 * pipeline (SPRINT1.md, Component 6).
 *
 * SPRINT2.md, Stage B, Component 5: this process no longer holds a Graph credential at all. It
 * used to build its own CertificateCredential and GraphClient because Sprint 1 had no HTTP
 * transport on the gateway to call into instead; now it does, so an approval decision is
 * recorded and executed entirely inside the owning gateway process, which already holds whatever
 * that decision needs (a Graph credential for identity, a local stub for the endpoint gateway).
 *
 * SPRINT3.md, 3.4: this process now talks to *two* approval-gated gateways, not one. It reads
 * pending approvals from both gateways' own SQLite files and merges them for display; deciding
 * one means finding which store actually holds that approval id, then POSTing the decision to
 * that gateway's own decision endpoint, authenticated with that gateway's own agent credential.
 * Each gateway keeps its own store and its own audit chain (SPRINT2.md, Component 6: "a
 * compromise of one cannot rewrite the other's history"); this file is the one place that reads
 * both, the same way it was already the one place that reached the single gateway before this
 * phase — approvals-page.ts and server.ts are untouched, since they only ever depended on the
 * injected listPendingApprovals/getApproval/decide functions, never on how many gateways back them.
 *
 * This process needs a credential per approval-gated gateway it talks to — not to reach Graph or
 * the stub directly, but to authenticate itself to each gateway's decision endpoint, the same way
 * any agent does. It reuses the identity and endpoint agents' own app registrations rather than
 * minting new ones: this process is a human-only interface, on the same trust footing those
 * agents already have (Gateway.Invoke on their own gateway, nothing else), so separate identities
 * here would add Azure app registrations without adding a real boundary.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import { routeRequest } from "@helpdesk/agent";
import { AuditLog } from "@helpdesk/audit-core";
import { ApprovalError, ApprovalStore, openDatabase, type ApprovalErrorCode, type ApprovalOutcome, type ApprovalRecord } from "@helpdesk/gateway-core";
import { CertificateCredential, loadGatewayEnv } from "@helpdesk/identity-gateway";

import { computeDashboardData, type ChainSnapshot, type DashboardData } from "../dashboard-metrics.js";
import { createWebServer } from "../server.js";

const env = loadGatewayEnv();
const port = Number.parseInt(process.env.WEB_PORT ?? "3000", 10);
const identityDbPath = resolve(env.HELPDESK_DB_PATH ?? "data/identity-helpdesk.db");
const endpointDbPath = resolve(process.env.ENDPOINT_HELPDESK_DB_PATH ?? "data/endpoint-helpdesk.db");
// SPRINT3.md, 3.5: the dashboard reads all five chains, but only identity's and endpoint's were
// ever opened here before this phase (for the approvals inbox). These three are new, each
// defaulting to the same path its own gateway defaults to, so a dev running the standard `pnpm
// *-gateway` commands with no overrides needs to set nothing new.
const orchestratorDbPath = resolve(process.env.ORCHESTRATOR_DB_PATH ?? "data/orchestrator.db");
const mdmDbPath = resolve(process.env.MDM_HELPDESK_DB_PATH ?? "data/mdm-helpdesk.db");
const knowledgeDbPath = resolve(process.env.KNOWLEDGE_HELPDESK_DB_PATH ?? "data/knowledge-helpdesk.db");

const identityDb = openDatabase(identityDbPath);
const identityApprovals = new ApprovalStore(identityDb);
const endpointDb = openDatabase(endpointDbPath);
const endpointApprovals = new ApprovalStore(endpointDb);
const orchestratorDb = openDatabase(orchestratorDbPath);
const mdmDb = openDatabase(mdmDbPath);
const knowledgeDb = openDatabase(knowledgeDbPath);

// One AuditLog per chain, read-only from this process's point of view (it never calls .append()
// on any of them) — the same class every gateway and agent already writes through, opened again
// here only to read it back, the same way pnpm verify-audit does.
const auditLogs = {
  orchestrator: new AuditLog(orchestratorDb),
  identity: new AuditLog(identityDb),
  mdm: new AuditLog(mdmDb),
  knowledge: new AuditLog(knowledgeDb),
  endpoint: new AuditLog(endpointDb),
};

/** Re-reads and re-verifies all five chains on every call — see dashboard-metrics.ts's header
 * comment for why this page's own render is the verification, not a report of an earlier one. */
function getDashboardData(): DashboardData {
  const snapshot = (log: AuditLog): ChainSnapshot => ({ records: log.list(), chainBreak: log.verifyChain() });
  return computeDashboardData({
    orchestrator: snapshot(auditLogs.orchestrator),
    identity: snapshot(auditLogs.identity),
    mdm: snapshot(auditLogs.mdm),
    knowledge: snapshot(auditLogs.knowledge),
    endpoint: snapshot(auditLogs.endpoint),
    now: new Date(),
  });
}

/** This process's own credential env: one certificate per approval-gated gateway, reusing that
 * gateway's own agent's app registration (see file header) rather than minting new ones. */
const agentCredentialEnvSchema = z.object({
  AZURE_TENANT_ID: z.guid(),
  AZURE_IDENTITY_AGENT_CLIENT_ID: z.guid(),
  AZURE_IDENTITY_AGENT_CERT_PATH: z.string().min(1),
  AZURE_IDENTITY_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i, "must be a 40-character hex SHA-1 thumbprint"),
  IDENTITY_GATEWAY_AUDIENCE: z.string().min(1),
  AZURE_ENDPOINT_AGENT_CLIENT_ID: z.guid(),
  AZURE_ENDPOINT_AGENT_CERT_PATH: z.string().min(1),
  AZURE_ENDPOINT_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i, "must be a 40-character hex SHA-1 thumbprint"),
  ENDPOINT_GATEWAY_AUDIENCE: z.string().min(1),
});
const agentEnv = agentCredentialEnvSchema.parse(process.env);

const identityGatewayBaseUrl = process.env.IDENTITY_GATEWAY_URL ?? "http://127.0.0.1:3001";
const endpointGatewayBaseUrl = process.env.ENDPOINT_GATEWAY_URL ?? "http://127.0.0.1:3004";

interface ApprovalGatewayClient {
  approvals: ApprovalStore;
  credential: CertificateCredential;
  audience: string;
  decisionUrl: string;
}

const identityGateway: ApprovalGatewayClient = {
  approvals: identityApprovals,
  credential: new CertificateCredential({
    tenantId: agentEnv.AZURE_TENANT_ID,
    clientId: agentEnv.AZURE_IDENTITY_AGENT_CLIENT_ID,
    thumbprint: agentEnv.AZURE_IDENTITY_AGENT_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(agentEnv.AZURE_IDENTITY_AGENT_CERT_PATH),
  }),
  audience: agentEnv.IDENTITY_GATEWAY_AUDIENCE,
  decisionUrl: `${identityGatewayBaseUrl}/approvals/decide`,
};

const endpointGateway: ApprovalGatewayClient = {
  approvals: endpointApprovals,
  credential: new CertificateCredential({
    tenantId: agentEnv.AZURE_TENANT_ID,
    clientId: agentEnv.AZURE_ENDPOINT_AGENT_CLIENT_ID,
    thumbprint: agentEnv.AZURE_ENDPOINT_AGENT_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(agentEnv.AZURE_ENDPOINT_AGENT_CERT_PATH),
  }),
  audience: agentEnv.ENDPOINT_GATEWAY_AUDIENCE,
  decisionUrl: `${endpointGatewayBaseUrl}/approvals/decide`,
};

const approvalGateways = [identityGateway, endpointGateway];

/**
 * The web app's own thin HTTP client for a gateway's decision endpoint. Reconstructs an
 * ApprovalError from the gateway's error response so approvals-page.ts's existing `instanceof
 * ApprovalError` handling keeps working unchanged: that file never re-implements the
 * requester/approver or required-note checks, it just has to show the refusal honestly, and it
 * still does not know or care whether the answer came from an in-process call or over HTTP.
 */
async function decideThroughGateway(gateway: ApprovalGatewayClient, input: {
  approvalId: string;
  decidedBy: string;
  decision: "approved" | "rejected";
  note: string;
}): Promise<ApprovalOutcome> {
  const { token } = await gateway.credential.getToken(`${gateway.audience}/.default`);
  const response = await fetch(gateway.decisionUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string } & Partial<ApprovalOutcome>;

  if (!response.ok) {
    const code = (body.code ?? "unknown") as ApprovalErrorCode;
    throw new ApprovalError(code, body.message ?? "The gateway refused this decision.");
  }
  return body as ApprovalOutcome;
}

function listPendingApprovals(): ApprovalRecord[] {
  return approvalGateways
    .flatMap((gateway) => gateway.approvals.listPending())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function getApproval(id: string): ApprovalRecord | null {
  for (const gateway of approvalGateways) {
    const found = gateway.approvals.get(id);
    if (found) return found;
  }
  return null;
}

async function decide(input: { approvalId: string; decidedBy: string; decision: "approved" | "rejected"; note: string }): Promise<ApprovalOutcome> {
  for (const gateway of approvalGateways) {
    if (gateway.approvals.get(input.approvalId)) return decideThroughGateway(gateway, input);
  }
  throw new ApprovalError("not_found", `approval ${input.approvalId} not found`);
}

const server = createWebServer({
  // SPRINT3.md, 3.1: every raw request now goes through triage and the orchestration layer
  // first, which decides which agent, if any, handles it. identityDbPath preserves this
  // process's own HELPDESK_DB_PATH; routeRequest()'s own mdmDbPath/knowledgeDbPath/
  // endpointDbPath/dbPath options are left unset here, so a routed request still writes to each
  // agent's and the orchestrator's own default path — orchestratorDbPath/mdmDbPath/
  // knowledgeDbPath above configure where this process reads those same defaults back from for
  // the dashboard (SPRINT3.md, 3.5), a separate concern from where a request gets routed to.
  routeRequest: (input) => routeRequest({ actor: input.actor, requestText: input.requestText, identityDbPath }),
  decide,
  listPendingApprovals,
  getApproval,
  getDashboardData,
});

const shutdown = (why: string): void => {
  console.error(`[web] shutting down (${why})`);
  server.close();
  identityDb.close();
  endpointDb.close();
  orchestratorDb.close();
  mdmDb.close();
  knowledgeDb.close();
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen(port, () => {
  console.error(
    `[web] listening on http://localhost:${port} (identityDb=${identityDbPath}, endpointDb=${endpointDbPath}, ` +
      `orchestratorDb=${orchestratorDbPath}, mdmDb=${mdmDbPath}, knowledgeDb=${knowledgeDbPath}, ` +
      `gateways=${identityGatewayBaseUrl},${endpointGatewayBaseUrl})`,
  );
});
