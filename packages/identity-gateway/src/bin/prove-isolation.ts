/**
 * Prove that Microsoft, not this codebase, enforces the separation between the identity, MDM,
 * knowledge and endpoint gateways — at two layers (SPRINT2.md, Component 2 for Stage A; Stage B,
 * Component 4 extends it; SPRINT3.md, 3.3 extends it for the third gateway, 3.4 for the fourth) —
 * plus two checks that this codebase's own enforcement holds on the gateway endpoints that are
 * not MCP tool calls. Twenty-two checks in total:
 *
 *   - eight Graph-level checks, all refused the same way, by Graph's authorization layer, with a
 *     403 Authorization_RequestDenied: the identity and MDM gateways' own certificates against
 *     the other gateway's Graph resource (Stage A, four checks), and the knowledge and endpoint
 *     *agents'* certificates — the only credential anywhere near either gateway, since neither
 *     gateway holds one of its own — against Graph directly (SPRINT3.md, 3.3 and 3.4, four
 *     checks). It would be tempting to expect Entra to refuse to even *mint* a token for an agent
 *     with no app role assignment on Graph at all — this script originally assumed exactly that,
 *     for the knowledge agent. It does not: client-credential token acquisition with a valid
 *     certificate succeeds regardless of app role assignment, producing a token with an empty
 *     roles claim. The refusal happens where it happens for the identity and MDM agents'
 *     out-of-scope calls too — at the moment Graph itself authorizes the request — which makes
 *     this a stronger proof, not a weaker one: zero permissions and the wrong permissions are
 *     refused by the identical mechanism, not by two different code paths that could drift apart.
 *     The endpoint agent's own zero-Graph-permission state is not an incidental fact carried over
 *     from the knowledge gateway's pattern — SPRINT3.md, 3.4 moved password reset to the
 *     never-automated class specifically so this gateway would never need to request one (see the
 *     README, "Endpoint gateway notes").
 *   - twelve gateway-level checks (Stage B, extended in 3.3 and 3.4): each agent's own token,
 *     valid for its own gateway, presented to *another* gateway over HTTP should be refused with
 *     a 401 naming an audience mismatch — enforced by this codebase's token validation, not
 *     Graph, which is exactly why these need their own checks rather than reusing the Graph-level
 *     ones. Every ordered pair across all four gateways is covered.
 *   - two endpoint-coverage checks (Stage B, Component 5; extended in 3.4): a request to the
 *     identity gateway's, and separately the endpoint gateway's, approval-decision endpoint with
 *     no bearer token at all must be refused the same way an unauthenticated MCP call would be —
 *     proving decision-listener.ts (now @helpdesk/gateway-core's, shared by both gateways since
 *     3.4's approvals generalization) shares the *same* TokenValidator as http-listener.ts on
 *     each gateway, not a second, independently-written check that could silently drift from it.
 *
 * The gateway-level checks need all four gateways actually running and reachable at their
 * configured URLs (IDENTITY_GATEWAY_URL / MDM_GATEWAY_URL / KNOWLEDGE_GATEWAY_URL /
 * ENDPOINT_GATEWAY_URL, defaulting to the same localhost ports the gateways themselves default
 * to): this script cannot start them itself, since starting a process from inside its own
 * isolation proof would make the proof depend on code this repo controls, not on Entra. Start all
 * four with `pnpm identity-gateway`, `pnpm mdm-gateway`, `pnpm knowledge-gateway` and
 * `pnpm endpoint-gateway` first.
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
  // No try/catch around getToken: client-credential acquisition with a valid certificate
  // succeeds regardless of app role assignment on the target resource (confirmed empirically for
  // the knowledge agent, which has none on Graph at all — see the file header). A real acquisition
  // failure here is unexpected and should surface as a script error via main().catch, not be
  // absorbed into a synthetic result.
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
async function runUnauthenticatedDecisionEndpointCheck(label: string, decisionUrl: string): Promise<CheckResult> {
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
    label,
    expectedStatus: EXPECTED_UNAUTHENTICATED_STATUS,
    actualStatus: response.status,
    roles: [],
    errorCode,
    pass: response.status === EXPECTED_UNAUTHENTICATED_STATUS,
  };
}

/** Each agent's own credential, read directly: these vars belong to the agent files, not to
 * loadGatewayEnv(), and this script is a diagnostic consumer of all three, same as token-smoke.ts. */
const agentCredentialEnv = z.object({
  AZURE_IDENTITY_AGENT_CLIENT_ID: z.guid(),
  AZURE_IDENTITY_AGENT_CERT_PATH: z.string().min(1),
  AZURE_IDENTITY_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i),
  AZURE_MDM_AGENT_CLIENT_ID: z.guid(),
  AZURE_MDM_AGENT_CERT_PATH: z.string().min(1),
  AZURE_MDM_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i),
  AZURE_KNOWLEDGE_AGENT_CLIENT_ID: z.guid(),
  AZURE_KNOWLEDGE_AGENT_CERT_PATH: z.string().min(1),
  AZURE_KNOWLEDGE_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i),
  AZURE_ENDPOINT_AGENT_CLIENT_ID: z.guid(),
  AZURE_ENDPOINT_AGENT_CERT_PATH: z.string().min(1),
  AZURE_ENDPOINT_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i),
});

/** SPRINT3.md, 3.2: the MDM gateway's own credential and audience belong to its own env.ts, not
 * to loadGatewayEnv() (this gateway's own). This script proves isolation across both gateways,
 * so — same reasoning as agentCredentialEnv just above — it reads the MDM gateway's fields
 * directly rather than importing @helpdesk/mdm-gateway, which would be a circular dependency
 * (that package already depends on this one for Graph plumbing). */
const mdmGatewayCredentialEnv = z.object({
  AZURE_MDM_CLIENT_ID: z.guid(),
  AZURE_MDM_CERT_PATH: z.string().min(1),
  AZURE_MDM_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i),
  MDM_GATEWAY_AUDIENCE: z.string().min(1),
});

/** SPRINT3.md, 3.3: the knowledge gateway's own env.ts, same reasoning as mdmGatewayCredentialEnv
 * above — except there is no certificate to read here at all, because the knowledge gateway
 * holds no credential of any kind. Its own Application ID URI is the only field it owns. */
const knowledgeGatewayAudienceEnv = z.object({
  KNOWLEDGE_GATEWAY_AUDIENCE: z.string().min(1),
});

/** SPRINT3.md, 3.4: the endpoint gateway's own env.ts, same reasoning as
 * knowledgeGatewayAudienceEnv above — no certificate here either, since this gateway holds no
 * credential of any kind. Its own Application ID URI is the only field it owns. */
const endpointGatewayAudienceEnv = z.object({
  ENDPOINT_GATEWAY_AUDIENCE: z.string().min(1),
});

function formatReport(results: CheckResult[], tenantId: string): string {
  // Always append the gutter, even when a field overflows its column: otherwise a long roles
  // claim runs straight into the next column with no space at all.
  const col = (s: string, w: number): string => (s.length >= w ? s : s + " ".repeat(w - s.length)) + "  ";
  const lines: string[] = [
    "Gateway isolation: Graph-level (Sprint 2 Stage A; extended, SPRINT3.md 3.3 and 3.4),",
    "gateway-level (Sprint 2 Stage B; extended, 3.3 and 3.4), and endpoint coverage (Stage B,",
    "Component 5; extended, 3.4)",
    `Run at: ${new Date().toISOString()}`,
    `Tenant: ${tenantId}`,
    "",
    "Checks 1-4 prove Microsoft enforces the separation between the identity and MDM gateways'",
    "Graph permissions. Checks 5-8 prove the same holds for the knowledge and endpoint agents'",
    "own certificates — the only credential anywhere near either gateway, since neither gateway",
    "holds one of its own: neither has any app role assignment on Graph's resource at all, and",
    "Graph refuses every one of these four calls with the same 403 Authorization_RequestDenied",
    "the identity and MDM agents get above, not some other, weaker refusal for having zero",
    "permissions instead of the wrong ones.",
    "Checks 9-20 prove this codebase's own token validation refuses a token minted for one",
    "gateway when it is presented to another, with a 401 naming the audience mismatch, across",
    "every ordered pair of all four gateways. Checks 21-22 prove that same validation covers the",
    "identity gateway's and the endpoint gateway's own approval-decision endpoints, not just",
    "their MCP endpoints: a bare request with no token at all is refused the same way on both.",
    "None of this proves a gateway process cannot read another gateway's certificate from disk;",
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
  const mdmEnv = mdmGatewayCredentialEnv.parse(process.env);
  const knowledgeEnv = knowledgeGatewayAudienceEnv.parse(process.env);
  const endpointEnv = endpointGatewayAudienceEnv.parse(process.env);

  const identityGraphCredential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_IDENTITY_CLIENT_ID,
    thumbprint: env.AZURE_IDENTITY_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_IDENTITY_CERT_PATH),
  });
  const mdmGraphCredential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: mdmEnv.AZURE_MDM_CLIENT_ID,
    thumbprint: mdmEnv.AZURE_MDM_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(mdmEnv.AZURE_MDM_CERT_PATH),
  });

  const knowledgeAgentCredential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: agentEnv.AZURE_KNOWLEDGE_AGENT_CLIENT_ID,
    thumbprint: agentEnv.AZURE_KNOWLEDGE_AGENT_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(agentEnv.AZURE_KNOWLEDGE_AGENT_CERT_PATH),
  });

  const endpointAgentCredential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: agentEnv.AZURE_ENDPOINT_AGENT_CLIENT_ID,
    thumbprint: agentEnv.AZURE_ENDPOINT_AGENT_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(agentEnv.AZURE_ENDPOINT_AGENT_CERT_PATH),
  });

  const graphChecks: GraphCheck[] = [
    { label: "identity token -> GET /users", credential: identityGraphCredential, url: `${GRAPH}/v1.0/users?$top=1`, expectedStatus: 200 },
    { label: "identity token -> GET /devices", credential: identityGraphCredential, url: `${GRAPH}/v1.0/devices?$top=1`, expectedStatus: 403 },
    { label: "mdm token -> GET /devices", credential: mdmGraphCredential, url: `${GRAPH}/v1.0/devices?$top=1`, expectedStatus: 200 },
    { label: "mdm token -> GET /users", credential: mdmGraphCredential, url: `${GRAPH}/v1.0/users?$top=1`, expectedStatus: 403 },
    // SPRINT3.md, 3.3: the knowledge agent is the only credential anywhere near the knowledge
    // gateway (which holds none of its own), so this is the check that stands in for "the
    // knowledge gateway's own Graph token" the other two gateways get above. Its certificate
    // mints a Graph-scoped token fine (see the file header) but with an empty roles claim, and
    // Graph's authorization layer refuses both calls with the same 403 Authorization_RequestDenied
    // the identity and MDM checks above get for their own out-of-scope resource.
    {
      label: "knowledge agent token -> GET /users",
      credential: knowledgeAgentCredential,
      url: `${GRAPH}/v1.0/users?$top=1`,
      expectedStatus: 403,
    },
    {
      label: "knowledge agent token -> GET /devices",
      credential: knowledgeAgentCredential,
      url: `${GRAPH}/v1.0/devices?$top=1`,
      expectedStatus: 403,
    },
    // SPRINT3.md, 3.4: same reasoning as the knowledge agent's two checks above — the endpoint
    // agent is the only credential anywhere near the endpoint gateway, which holds none of its
    // own, and it has zero Graph permission by design, not by omission (password reset was moved
    // to the never-automated class before this gateway was built; see the README).
    {
      label: "endpoint agent token -> GET /users",
      credential: endpointAgentCredential,
      url: `${GRAPH}/v1.0/users?$top=1`,
      expectedStatus: 403,
    },
    {
      label: "endpoint agent token -> GET /devices",
      credential: endpointAgentCredential,
      url: `${GRAPH}/v1.0/devices?$top=1`,
      expectedStatus: 403,
    },
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

  // All four env vars name an origin, not a path — see identity-agent.ts's, mdm-agent.ts's,
  // knowledge-agent.ts's and endpoint-agent.ts's own comments on their *_GATEWAY_URL vars for why.
  const mdmGatewayUrl = `${process.env.MDM_GATEWAY_URL ?? "http://127.0.0.1:3002"}/mcp`;
  const identityGatewayUrl = `${process.env.IDENTITY_GATEWAY_URL ?? "http://127.0.0.1:3001"}/mcp`;
  const knowledgeGatewayUrl = `${process.env.KNOWLEDGE_GATEWAY_URL ?? "http://127.0.0.1:3003"}/mcp`;
  const endpointGatewayUrl = `${process.env.ENDPOINT_GATEWAY_URL ?? "http://127.0.0.1:3004"}/mcp`;

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
      agentAudience: mdmEnv.MDM_GATEWAY_AUDIENCE,
      otherGatewayUrl: identityGatewayUrl,
    },
    {
      label: "knowledge agent token -> identity gateway",
      agentCredential: knowledgeAgentCredential,
      agentAudience: knowledgeEnv.KNOWLEDGE_GATEWAY_AUDIENCE,
      otherGatewayUrl: identityGatewayUrl,
    },
    {
      label: "knowledge agent token -> MDM gateway",
      agentCredential: knowledgeAgentCredential,
      agentAudience: knowledgeEnv.KNOWLEDGE_GATEWAY_AUDIENCE,
      otherGatewayUrl: mdmGatewayUrl,
    },
    // The other direction, for the same reason Stage B checked both directions between identity
    // and MDM: proves the knowledge gateway's own audience check refuses a foreign token too,
    // not just that the knowledge agent's token is well-behaved everywhere else.
    {
      label: "identity agent token -> knowledge gateway",
      agentCredential: identityAgentCredential,
      agentAudience: env.IDENTITY_GATEWAY_AUDIENCE,
      otherGatewayUrl: knowledgeGatewayUrl,
    },
    {
      label: "MDM agent token -> knowledge gateway",
      agentCredential: mdmAgentCredential,
      agentAudience: mdmEnv.MDM_GATEWAY_AUDIENCE,
      otherGatewayUrl: knowledgeGatewayUrl,
    },
    // SPRINT3.md, 3.4: the endpoint gateway is a fourth party in every pairwise check above.
    // Three more "endpoint agent token -> the other gateway" checks, then three more in the
    // other direction, same reasoning as the knowledge gateway's own six checks in 3.3: every
    // ordered pair needs its own check, since this is this codebase's own enforcement, not
    // Graph's, and nothing here should be assumed to generalize without being run.
    {
      label: "endpoint agent token -> identity gateway",
      agentCredential: endpointAgentCredential,
      agentAudience: endpointEnv.ENDPOINT_GATEWAY_AUDIENCE,
      otherGatewayUrl: identityGatewayUrl,
    },
    {
      label: "endpoint agent token -> MDM gateway",
      agentCredential: endpointAgentCredential,
      agentAudience: endpointEnv.ENDPOINT_GATEWAY_AUDIENCE,
      otherGatewayUrl: mdmGatewayUrl,
    },
    {
      label: "endpoint agent token -> knowledge gateway",
      agentCredential: endpointAgentCredential,
      agentAudience: endpointEnv.ENDPOINT_GATEWAY_AUDIENCE,
      otherGatewayUrl: knowledgeGatewayUrl,
    },
    {
      label: "identity agent token -> endpoint gateway",
      agentCredential: identityAgentCredential,
      agentAudience: env.IDENTITY_GATEWAY_AUDIENCE,
      otherGatewayUrl: endpointGatewayUrl,
    },
    {
      label: "MDM agent token -> endpoint gateway",
      agentCredential: mdmAgentCredential,
      agentAudience: mdmEnv.MDM_GATEWAY_AUDIENCE,
      otherGatewayUrl: endpointGatewayUrl,
    },
    {
      label: "knowledge agent token -> endpoint gateway",
      agentCredential: knowledgeAgentCredential,
      agentAudience: knowledgeEnv.KNOWLEDGE_GATEWAY_AUDIENCE,
      otherGatewayUrl: endpointGatewayUrl,
    },
  ];

  const identityDecisionUrl = `${process.env.IDENTITY_GATEWAY_URL ?? "http://127.0.0.1:3001"}/approvals/decide`;
  const endpointDecisionUrl = `${process.env.ENDPOINT_GATEWAY_URL ?? "http://127.0.0.1:3004"}/approvals/decide`;

  const results: CheckResult[] = [];
  for (const check of graphChecks) results.push(await runGraphCheck(check));
  for (const check of agentTokenChecks) results.push(await runAgentTokenCheck(check));
  results.push(await runUnauthenticatedDecisionEndpointCheck("no token -> POST identity /approvals/decide", identityDecisionUrl));
  results.push(await runUnauthenticatedDecisionEndpointCheck("no token -> POST endpoint /approvals/decide", endpointDecisionUrl));

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
  console.error(
    "(If a gateway-level check failed to connect, confirm all four gateways are running: pnpm identity-gateway, pnpm mdm-gateway, pnpm knowledge-gateway, pnpm endpoint-gateway.)",
  );
  process.exit(1);
});
