/**
 * Prove the certificate credential works with one read call, and show which application
 * permissions the token actually carries. Prints no secrets: the token is decoded for its
 * claims and then discarded.
 *
 *   pnpm graph-smoke
 *
 * Exit code 0 on success, 1 on any failure.
 */
import { readFileSync } from "node:fs";

import { loadGatewayEnv } from "../env.js";
import { CertificateCredential, TokenError } from "../graph/certificate-credential.js";

const GRAPH = "https://graph.microsoft.com";

function claims(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const env = loadGatewayEnv();
  console.log(`tenant     ${env.AZURE_TENANT_ID}`);
  console.log(`client     ${env.AZURE_CLIENT_ID}`);
  console.log(`thumbprint ${env.AZURE_CERT_THUMBPRINT}`);
  console.log(`key file   ${env.AZURE_CERT_PATH}`);

  const credential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_CLIENT_ID,
    thumbprint: env.AZURE_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_CERT_PATH),
  });

  const { token, expiresAt } = await credential.getToken(`${GRAPH}/.default`);
  const c = claims(token);
  console.log("");
  console.log(`token      ok, expires ${new Date(expiresAt).toISOString()}`);
  console.log(`  appid    ${String(c.appid)}`);
  console.log(`  tid      ${String(c.tid)}`);
  console.log(`  roles    ${Array.isArray(c.roles) ? c.roles.join(", ") : "(none)"}`);

  const url = `${GRAPH}/v1.0/users?$top=5&$select=id,userPrincipalName,displayName`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as { value?: { id: string; userPrincipalName: string; displayName: string }[]; error?: { code: string; message: string } };

  console.log("");
  console.log(`GET /users ${response.status}`);
  if (!response.ok || body.value === undefined) {
    throw new Error(`Graph error ${body.error?.code ?? response.status}: ${body.error?.message ?? "no body"}`);
  }
  for (const u of body.value) console.log(`  ${u.id}  ${u.userPrincipalName}  (${u.displayName})`);
}

main().catch((error: unknown) => {
  const message = error instanceof TokenError || error instanceof Error ? error.message : String(error);
  console.error(`\nFAILED: ${message}`);
  process.exit(1);
});
