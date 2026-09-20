/**
 * Prove the MDM gateway's certificate credential works with one read call, and that the
 * `roles` claim carries exactly `Device.Read.All` and nothing else (SPRINT2.md, Stage A). No
 * gateway or policy code for the MDM gateway exists yet; this is the same order Sprint 1 used
 * for the identity gateway's credential (`graph-smoke.ts`), one generation earlier.
 *
 *   pnpm mdm-graph-smoke
 *
 * Exit code 0 on success, 1 on any failure (including the wrong role set).
 */
import { readFileSync } from "node:fs";

import { z } from "zod";

import { loadGatewayEnv } from "../env.js";
import { CertificateCredential, TokenError } from "../graph/certificate-credential.js";
import { decodeJwtClaims } from "../graph/jwt.js";

const GRAPH = "https://graph.microsoft.com";
const EXPECTED_ROLES = ["Device.Read.All"];

/** SPRINT3.md, 3.2: the MDM gateway's own credential belongs to its own env.ts, not to
 * loadGatewayEnv() (the identity gateway's own). This diagnostic lives here anyway (Graph
 * plumbing is identity-gateway's package), so it reads the MDM gateway's fields directly rather
 * than importing @helpdesk/mdm-gateway, which would be a circular dependency. */
const mdmGatewayCredentialEnv = z.object({
  AZURE_MDM_CLIENT_ID: z.guid(),
  AZURE_MDM_CERT_PATH: z.string().min(1),
  AZURE_MDM_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i),
});

async function main(): Promise<void> {
  const env = loadGatewayEnv();
  const mdmEnv = mdmGatewayCredentialEnv.parse(process.env);
  console.log(`tenant     ${env.AZURE_TENANT_ID}`);
  console.log(`client     ${mdmEnv.AZURE_MDM_CLIENT_ID}`);
  console.log(`thumbprint ${mdmEnv.AZURE_MDM_CERT_THUMBPRINT}`);
  console.log(`key file   ${mdmEnv.AZURE_MDM_CERT_PATH}`);

  const credential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: mdmEnv.AZURE_MDM_CLIENT_ID,
    thumbprint: mdmEnv.AZURE_MDM_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(mdmEnv.AZURE_MDM_CERT_PATH),
  });

  const { token, expiresAt } = await credential.getToken(`${GRAPH}/.default`);
  const c = decodeJwtClaims(token);
  const roles = Array.isArray(c.roles) ? (c.roles as unknown[]).map(String) : [];
  console.log("");
  console.log(`token      ok, expires ${new Date(expiresAt).toISOString()}`);
  console.log(`  appid    ${String(c.appid)}`);
  console.log(`  tid      ${String(c.tid)}`);
  console.log(`  roles    ${roles.length > 0 ? roles.join(", ") : "(none)"}`);

  const sameSet = roles.length === EXPECTED_ROLES.length && EXPECTED_ROLES.every((r) => roles.includes(r));
  if (!sameSet) {
    throw new Error(
      `roles claim is [${roles.join(", ")}], expected exactly [${EXPECTED_ROLES.join(", ")}]. ` +
        "Check the app registration's granted application permissions before touching any code.",
    );
  }

  const url = `${GRAPH}/v1.0/devices?$top=5&$select=id,displayName,operatingSystem`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as {
    value?: { id: string; displayName: string; operatingSystem: string }[];
    error?: { code: string; message: string };
  };

  console.log("");
  console.log(`GET /devices ${response.status}`);
  if (!response.ok || body.value === undefined) {
    throw new Error(`Graph error ${body.error?.code ?? response.status}: ${body.error?.message ?? "no body"}`);
  }
  if (body.value.length === 0) {
    console.log("  (no devices in the tenant — an empty list is a successful call, SPRINT2.md Stage A)");
  }
  for (const d of body.value) console.log(`  ${d.id}  ${d.displayName}  (${d.operatingSystem})`);

  console.log("");
  console.log("PASS: MDM credential verified, roles claim carries exactly Device.Read.All.");
}

main().catch((error: unknown) => {
  const message = error instanceof TokenError || error instanceof Error ? error.message : String(error);
  console.error(`\nFAILED: ${message}`);
  process.exit(1);
});
