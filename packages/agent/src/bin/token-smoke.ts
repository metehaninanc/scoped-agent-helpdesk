/**
 * Prove each agent's own credential works before building anything on it (SPRINT2.md, Stage B,
 * Component 1): mint a real token for each agent's own gateway audience, and confirm the `aud`
 * claim is that gateway's Application ID URI and the `roles` claim carries exactly
 * Gateway.Invoke — no Graph permission at all. Same shape as graph-smoke.ts and
 * mdm-graph-smoke.ts, one generation up the stack: those prove a Graph credential, this proves
 * an agent-to-gateway credential.
 *
 * Deliberately standalone rather than importing identity-agent.ts's or mdm-agent.ts's own
 * credential loading: those stay private to each agent file, and this is a diagnostic script,
 * not a third agent, so duplicating the same ~15 lines of env parsing here is the same
 * boundary-respecting duplication those two files already practice with each other.
 *
 *   pnpm token-smoke
 *
 * Never prints a token, only its decoded claims. Exit code 0 on success, 1 on any failure
 * (including the wrong role set).
 */
import { readFileSync } from "node:fs";

import { CertificateCredential, decodeJwtClaims } from "@helpdesk/identity-gateway";

import { ensureEnvLoaded } from "../env.js";

const REQUIRED_ROLE = "Gateway.Invoke";

interface AgentCheck {
  label: string;
  clientIdVar: string;
  certPathVar: string;
  certThumbprintVar: string;
  audienceVar: string;
}

const CHECKS: AgentCheck[] = [
  {
    label: "identity agent -> identity gateway",
    clientIdVar: "AZURE_IDENTITY_AGENT_CLIENT_ID",
    certPathVar: "AZURE_IDENTITY_AGENT_CERT_PATH",
    certThumbprintVar: "AZURE_IDENTITY_AGENT_CERT_THUMBPRINT",
    audienceVar: "IDENTITY_GATEWAY_AUDIENCE",
  },
  {
    label: "mdm agent -> mdm gateway",
    clientIdVar: "AZURE_MDM_AGENT_CLIENT_ID",
    certPathVar: "AZURE_MDM_AGENT_CERT_PATH",
    certThumbprintVar: "AZURE_MDM_AGENT_CERT_THUMBPRINT",
    audienceVar: "MDM_GATEWAY_AUDIENCE",
  },
];

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

async function runCheck(check: AgentCheck, tenantId: string): Promise<boolean> {
  console.log(`\n${check.label}`);

  const clientId = required(check.clientIdVar);
  const certPath = required(check.certPathVar);
  const thumbprint = required(check.certThumbprintVar);
  const audience = required(check.audienceVar);

  const credential = new CertificateCredential({
    tenantId,
    clientId,
    thumbprint,
    privateKeyPem: readFileSync(certPath),
  });

  const { token, expiresAt } = await credential.getToken(`${audience}/.default`);
  const claims = decodeJwtClaims(token);
  const roles = Array.isArray(claims.roles) ? (claims.roles as unknown[]).map(String) : [];

  console.log(`  token      ok, expires ${new Date(expiresAt).toISOString()}`);
  console.log(`  aud        ${String(claims.aud)}`);
  console.log(`  roles      ${roles.length > 0 ? roles.join(", ") : "(none)"}`);

  const audOk = claims.aud === audience;
  const rolesOk = roles.length === 1 && roles[0] === REQUIRED_ROLE;

  if (!audOk) console.log(`  FAIL: aud is not this agent's own gateway audience (${audience})`);
  if (!rolesOk) console.log(`  FAIL: roles is not exactly [${REQUIRED_ROLE}]`);
  if (audOk && rolesOk) console.log("  PASS");

  return audOk && rolesOk;
}

async function main(): Promise<void> {
  ensureEnvLoaded();
  const tenantId = required("AZURE_TENANT_ID");

  // Sequential, not Promise.all: each check's label and its own detail lines must print as one
  // block, not interleaved with the other check's output racing it.
  const results: boolean[] = [];
  for (const check of CHECKS) results.push(await runCheck(check, tenantId));

  console.log("");
  if (results.every(Boolean)) {
    console.log(`PASS: both agent credentials mint a token scoped to their own gateway, carrying only ${REQUIRED_ROLE}.`);
  } else {
    console.log("FAIL: at least one agent credential did not check out.");
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
