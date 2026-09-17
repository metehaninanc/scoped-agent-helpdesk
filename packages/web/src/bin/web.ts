/**
 * The web app entry point. Two server-rendered pages (server.ts); no framework, no build
 * pipeline (SPRINT1.md, Component 6).
 *
 * SPRINT2.md, Stage B, Component 5: this process no longer holds a Graph credential at all. It
 * used to build its own CertificateCredential and GraphClient because Sprint 1 had no HTTP
 * transport on the gateway to call into instead; now it does, so an approval decision is
 * recorded and executed entirely inside the identity gateway process (approvals/decision-listener.ts),
 * which already holds the Graph credential this process no longer needs.
 *
 * This process still needs *a* credential — not to reach Graph, but to authenticate itself to
 * the gateway's decision endpoint, the same way any agent does. It reuses the identity agent's
 * own app registration (AZURE_IDENTITY_AGENT_*) rather than getting a third one: this process is
 * a human-only interface calling exactly one gateway, on the same trust footing the identity
 * agent already has (Gateway.Invoke on the identity gateway, nothing else), so a separate
 * identity would add an Azure app registration without adding a real boundary.
 *
 * It still reads approvals directly from the shared SQLite file (ApprovalStore, unchanged): that
 * is a read, needs no credential, and was never the gap Stage B closes — only the Graph-writing
 * path was.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import { runIdentityAgent } from "@helpdesk/agent";
import {
  ApprovalError,
  ApprovalStore,
  CertificateCredential,
  loadGatewayEnv,
  openDatabase,
  type ApprovalErrorCode,
  type ApprovalOutcome,
} from "@helpdesk/identity-gateway";

import { createWebServer } from "../server.js";

const env = loadGatewayEnv();
const port = Number.parseInt(process.env.WEB_PORT ?? "3000", 10);
const dbPath = resolve(env.HELPDESK_DB_PATH ?? "data/identity-helpdesk.db");

const db = openDatabase(dbPath);
const approvals = new ApprovalStore(db);

/** This process's own credential env, same shape and same variables as identity-agent.ts's
 * (see that file's header comment) — reusing that app registration, not a third identity. */
const agentCredentialEnvSchema = z.object({
  AZURE_TENANT_ID: z.guid(),
  AZURE_IDENTITY_AGENT_CLIENT_ID: z.guid(),
  AZURE_IDENTITY_AGENT_CERT_PATH: z.string().min(1),
  AZURE_IDENTITY_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i, "must be a 40-character hex SHA-1 thumbprint"),
  IDENTITY_GATEWAY_AUDIENCE: z.string().min(1),
});
const agentEnv = agentCredentialEnvSchema.parse(process.env);

const gatewayCredential = new CertificateCredential({
  tenantId: agentEnv.AZURE_TENANT_ID,
  clientId: agentEnv.AZURE_IDENTITY_AGENT_CLIENT_ID,
  thumbprint: agentEnv.AZURE_IDENTITY_AGENT_CERT_THUMBPRINT,
  privateKeyPem: readFileSync(agentEnv.AZURE_IDENTITY_AGENT_CERT_PATH),
});
const identityGatewayBaseUrl = process.env.IDENTITY_GATEWAY_URL ?? "http://127.0.0.1:3001";
const decisionUrl = `${identityGatewayBaseUrl}/approvals/decide`;

/**
 * The web app's own thin HTTP client for the gateway's decision endpoint. Reconstructs an
 * ApprovalError from the gateway's error response so approvals-page.ts's existing `instanceof
 * ApprovalError` handling keeps working unchanged: that file never re-implements the
 * requester/approver or required-note checks, it just has to show the refusal honestly, and it
 * still does not know or care whether the answer came from an in-process call or over HTTP.
 */
async function decideThroughGateway(input: {
  approvalId: string;
  decidedBy: string;
  decision: "approved" | "rejected";
  note: string;
}): Promise<ApprovalOutcome> {
  const { token } = await gatewayCredential.getToken(`${agentEnv.IDENTITY_GATEWAY_AUDIENCE}/.default`);
  const response = await fetch(decisionUrl, {
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

const server = createWebServer({
  runIdentityAgent: (input) => runIdentityAgent({ actor: input.actor, requestText: input.requestText, dbPath }),
  decide: decideThroughGateway,
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
  console.error(`[web] listening on http://localhost:${port} (db=${dbPath}, gateway=${identityGatewayBaseUrl})`);
});
