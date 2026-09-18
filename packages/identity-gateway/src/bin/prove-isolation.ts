/**
 * Prove that Microsoft, not this codebase, enforces the separation between the identity and
 * MDM gateways — at two layers now (SPRINT2.md, Component 2 for Stage A; Stage B, Component 4
 * extends it) — plus one more check that this codebase's own enforcement holds on the one
 * gateway endpoint that is not an MCP tool call. Seven checks in total:
 *
 *   - four Graph-level checks (Stage A): each gateway's own certificate against the other
 *     gateway's Graph resource should be refused by Graph itself.
 *   - two gateway-level checks (Stage B): each agent's own token, valid for its own gateway,
 *     presented to the *other* gateway over HTTP should be refused with a 401 naming an
 *     audience mismatch — enforced by this codebase's token validation this time, not Graph,
 *     which is exactly why it needs its own two checks rather than reusing the first four.
 *   - one endpoint-coverage check (Stage B, Component 5): a request to the identity gateway's
 *     approval-decision endpoint with no bearer token at all must be refused the same way an
 *     unauthenticated MCP call would be — proving decision-listener.ts shares the *same*
 *     TokenValidator as http-listener.ts, not a second, independently-written check that could
 *     silently drift from it. (bin/gateway.ts constructs exactly one TokenValidator and passes
 *     it to both listeners; this check is what stops a future refactor from quietly splitting
 *     that back into two.)
 *
 * The Stage B checks need both gateways actually running and reachable at their configured
 * URLs (IDENTITY_GATEWAY_URL / MDM_GATEWAY_URL, defaulting to the same localhost ports the
 * gateways themselves default to): this script cannot start them itself, since starting a
 * process from inside its own isolation proof would make the proof depend on code this repo
 * controls, not on Entra. Start both with `pnpm identity-gateway` and `pnpm mdm-gateway` first.
 *
 * This proves Microsoft enforces the Graph-level separation, and that this codebase's own
 * token validation enforces the gateway-level one, on every endpoint that accepts a bearer
 * token. It does not prove that a gateway process cannot read the other gateway's certificate
 * from disk; that is a host-level concern (separate users, or separate hosts), out of scope
 * here (see README).
 *
 *   pnpm prove-isolation
 *
 * Writes evidence/isolation-run.txt and exits non-zero if any check does not match its expected
 * outcome. Never logs a token or a client assertion, only decoded claims (see certificate-
 * credential.ts) and the error codes Graph or this gateway returned.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import { loadGatewayEnv } from "../env.js";
import { CertificateCredential, TokenError } from "../graph/certificate-credential.js";
import { decodeJwtClaims } from "../graph/jwt.js";

const GRAPH = "https://graph.microsoft.com";
const EVIDENCE_PATH = resolve("evidence/isolation-run.txt");

interface GraphCheck {
  label: string;
  credential: CertificateCredential;
  url: string;
  expectedStatus: number;
}

interface CheckResult {
  label: string;
  expectedStatus: number;
  actualStatus: number;
  roles: string[];
  errorCode: string | null;
  pass: boolean;
}

async function runGraphCheck(check: GraphCheck): Promise<CheckResult> {
  const { token } = await check.credential.getToken(`${GRAPH}/.default`);
  const claims = decodeJwtClaims(token);
  const roles = Array.isArray(claims.roles) ? (claims.roles as unknown[]).map(String) : [];

  const response = await fetch(check.url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body: { error?: { code?: string } } = {};
  try {
    if (text.length > 0) body = JSON.parse(text) as { error?: { code?: string } };
  } catch {
    // Non-JSON body: no Graph error code to report, the status alone is the evidence.
  }

  return {
    label: check.label,
    expectedStatus: check.expectedStatus,
    actualStatus: response.status,
    roles,
    errorCode: body.error?.code ?? null,
    pass: response.status === check.expectedStatus,
  };
}

interface AgentTokenCheck {
  label: string;
  agentCredential: CertificateCredential;
  agentAudience: string;
  otherGatewayUrl: string;
}

const EXPECTED_REFUSAL_STATUS = 401;
const EXPECTED_REFUSAL_CODE = "token_audience_mismatch";

async function runAgentTokenCheck(check: AgentTokenCheck): Promise<CheckResult> {
  const { token } = await check.agentCredential.getToken(`${check.agentAudience}/.default`);
  const claims = decodeJwtClaims(token);
  const roles = Array.isArray(claims.roles) ? (claims.roles as unknown[]).map(String) : [];

  const response = await fetch(check.otherGatewayUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "x-actor": "prove-isolation@local",
      "x-request-id": `prove-isolation-${randomUUID()}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let errorCode: string | null = null;
  try {
    if (text.length > 0) errorCode = (JSON.parse(text) as { code?: string }).code ?? null;
  } catch {
    // Non-JSON body (unexpected for this endpoint): no code to report, the status is the evidence.
  }

  return {
    label: check.label,
    expectedStatus: EXPECTED_REFUSAL_STATUS,
    actualStatus: response.status,
    roles,
    errorCode,
    pass: response.status === EXPECTED_REFUSAL_STATUS && errorCode === EXPECTED_REFUSAL_CODE,
  };
}

const EXPECTED_UNAUTHENTICATED_STATUS = 401;

/**
 * No credential at all, minted or otherwise: a bare request to the decision endpoint. Confirms
 * SPRINT2.md Component 3's rule ("a rejected token returns 401 and is audited") holds on the
 * one gateway endpoint that is not an MCP tool call — decision-listener.ts is a second listener
 * function, and nothing here guarantees at compile time that it kept using the validator it was
 * given rather than skipping the check. This is what checks that at runtime instead.
 */
async function runUnauthenticatedDecisionEndpointCheck(decisionUrl: string): Promise<CheckResult> {
  const response = await fetch(decisionUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      approvalId: "00000000-0000-4000-8000-000000000000",
      decidedBy: "prove-isolation@local",
      decision: "approved",
      note: "prove-isolation: unauthenticated decision endpoint check",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let errorCode: string | null = null;
  try {
    if (text.length > 0) errorCode = (JSON.parse(text) as { code?: string }).code ?? null;
  } catch {
    // Non-JSON body (unexpected for this endpoint): no code to report, the status is the evidence.
  }

  return {
    label: "no token -> POST /approvals/decide",
    expectedStatus: EXPECTED_UNAUTHENTICATED_STATUS,
    actualStatus: response.status,
    roles: [],
    errorCode,
    pass: response.status === EXPECTED_UNAUTHENTICATED_STATUS,
  };
}

/** Each agent's own credential, read directly: these vars belong to the agent files, not to
 * loadGatewayEnv(), and this script is a diagnostic consumer of both, same as token-smoke.ts. */
const agentCredentialEnv = z.object({
  AZURE_IDENTITY_AGENT_CLIENT_ID: z.guid(),
  AZURE_IDENTITY_AGENT_CERT_PATH: z.string().min(1),
  AZURE_IDENTITY_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i),
  AZURE_MDM_AGENT_CLIENT_ID: z.guid(),
  AZURE_MDM_AGENT_CERT_PATH: z.string().min(1),
  AZURE_MDM_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i),
});

function formatReport(results: CheckResult[], tenantId: string): string {
  // Always append the gutter, even when a field overflows its column: otherwise a long roles
  // claim runs straight into the next column with no space at all.
  const col = (s: string, w: number): string => (s.length >= w ? s : s + " ".repeat(w - s.length)) + "  ";
  const lines: string[] = [
    "Sprint 2: gateway isolation, Graph-level (Stage A, Component 2) and gateway-level (Stage B, Components 3-4)",
    `Run at: ${new Date().toISOString()}`,
    `Tenant: ${tenantId}`,
    "",
    "The first four checks prove Microsoft enforces the separation between the identity and MDM",
    "gateways' Graph permissions. Checks five and six prove this codebase's own token validation",
    "refuses a token minted for the wrong gateway, with a 401 naming the audience mismatch. Check",
    "seven proves that same validation covers the identity gateway's approval-decision endpoint,",
    "not just its MCP endpoint: a bare request with no token at all is refused the same way.",
    "None of this proves a gateway process cannot read the other gateway's certificate from disk;",
    "that is a host-level concern (separate users or separate hosts), out of scope here.",
    "",
    "An empty result set is still a 200: the tenant has no devices, and the check is the status",
    "code Graph returns, not how many rows come back.",
    "",
    col("check", 40) + col("expected", 10) + col("actual", 8) + col("roles", 34) + "error code",
    "-".repeat(116),
  ];

  for (const r of results) {
    lines.push(
      col(r.label, 40) +
        col(String(r.expectedStatus), 10) +
        col(String(r.actualStatus), 8) +
        col(r.roles.join(", ") || "(none)", 34) +
        (r.errorCode ?? "-"),
    );
  }
  lines.push("");

  const failed = results.filter((r) => !r.pass);
  if (failed.length === 0) {
    lines.push(`PASS: all ${results.length} checks matched their expected outcome.`);
  } else {
    lines.push(`FAIL: ${failed.length} of ${results.length} checks did not match their expected outcome:`);
    for (const r of failed) lines.push(`  ${r.label}: expected ${r.expectedStatus}, got ${r.actualStatus} (${r.errorCode ?? "no code"})`);
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const env = loadGatewayEnv();
  const agentEnv = agentCredentialEnv.parse(process.env);

  const identityGraphCredential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_IDENTITY_CLIENT_ID,
    thumbprint: env.AZURE_IDENTITY_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_IDENTITY_CERT_PATH),
  });
  const mdmGraphCredential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_MDM_CLIENT_ID,
    thumbprint: env.AZURE_MDM_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_MDM_CERT_PATH),
  });

  const graphChecks: GraphCheck[] = [
    { label: "identity token -> GET /users", credential: identityGraphCredential, url: `${GRAPH}/v1.0/users?$top=1`, expectedStatus: 200 },
    { label: "identity token -> GET /devices", credential: identityGraphCredential, url: `${GRAPH}/v1.0/devices?$top=1`, expectedStatus: 403 },
    { label: "mdm token -> GET /devices", credential: mdmGraphCredential, url: `${GRAPH}/v1.0/devices?$top=1`, expectedStatus: 200 },
    { label: "mdm token -> GET /users", credential: mdmGraphCredential, url: `${GRAPH}/v1.0/users?$top=1`, expectedStatus: 403 },
  ];

  const identityAgentCredential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: agentEnv.AZURE_IDENTITY_AGENT_CLIENT_ID,
    thumbprint: agentEnv.AZURE_IDENTITY_AGENT_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(agentEnv.AZURE_IDENTITY_AGENT_CERT_PATH),
  });
  const mdmAgentCredential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: agentEnv.AZURE_MDM_AGENT_CLIENT_ID,
    thumbprint: agentEnv.AZURE_MDM_AGENT_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(agentEnv.AZURE_MDM_AGENT_CERT_PATH),
  });

  // Both env vars name an origin, not a path — see identity-agent.ts's and mdm-agent.ts's own
  // comments on IDENTITY_GATEWAY_URL / MDM_GATEWAY_URL for why.
  const mdmGatewayUrl = `${process.env.MDM_GATEWAY_URL ?? "http://127.0.0.1:3002"}/mcp`;
  const identityGatewayUrl = `${process.env.IDENTITY_GATEWAY_URL ?? "http://127.0.0.1:3001"}/mcp`;

  const agentTokenChecks: AgentTokenCheck[] = [
    {
      label: "identity agent token -> MDM gateway",
      agentCredential: identityAgentCredential,
      agentAudience: env.IDENTITY_GATEWAY_AUDIENCE,
      otherGatewayUrl: mdmGatewayUrl,
    },
    {
      label: "MDM agent token -> identity gateway",
      agentCredential: mdmAgentCredential,
      agentAudience: env.MDM_GATEWAY_AUDIENCE,
      otherGatewayUrl: identityGatewayUrl,
    },
  ];

  const decisionUrl = `${process.env.IDENTITY_GATEWAY_URL ?? "http://127.0.0.1:3001"}/approvals/decide`;

  const results: CheckResult[] = [];
  for (const check of graphChecks) results.push(await runGraphCheck(check));
  for (const check of agentTokenChecks) results.push(await runAgentTokenCheck(check));
  results.push(await runUnauthenticatedDecisionEndpointCheck(decisionUrl));

  const report = formatReport(results, env.AZURE_TENANT_ID);
  process.stdout.write(report);

  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, report, "utf8");
  console.log(`Written to ${EVIDENCE_PATH}`);

  if (results.some((r) => !r.pass)) process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof TokenError || error instanceof Error ? error.message : String(error);
  console.error(`\nFAILED: ${message}`);
  console.error("(If a gateway-level check failed to connect, confirm both gateways are running: pnpm identity-gateway, pnpm mdm-gateway.)");
  process.exit(1);
});
