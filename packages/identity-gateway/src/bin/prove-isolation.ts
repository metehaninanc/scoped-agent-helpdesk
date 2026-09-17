/**
 * Prove that Microsoft, not this codebase, enforces the separation between the identity and
 * MDM gateways' Graph permissions (SPRINT2.md, Component 2). Four checks: each credential
 * against the other's endpoint should come back refused by Graph itself. That refusal is the
 * deliverable, not a bug to route around.
 *
 * This proves Microsoft enforces the separation. It does not prove that a gateway process
 * cannot read the other gateway's certificate from disk; that is a host-level concern (separate
 * users, or separate hosts), out of scope here (see README).
 *
 *   pnpm prove-isolation
 *
 * Writes evidence/isolation-run.txt and exits non-zero if any check does not match its expected
 * status. Never logs a token or a client assertion, only decoded claims (see certificate-
 * credential.ts) and Graph's own error codes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadGatewayEnv } from "../env.js";
import { CertificateCredential, TokenError } from "../graph/certificate-credential.js";
import { decodeJwtClaims } from "../graph/jwt.js";

const GRAPH = "https://graph.microsoft.com";
const EVIDENCE_PATH = resolve("evidence/isolation-run.txt");

interface Check {
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
  graphErrorCode: string | null;
  pass: boolean;
}

async function runCheck(check: Check): Promise<CheckResult> {
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
    graphErrorCode: body.error?.code ?? null,
    pass: response.status === check.expectedStatus,
  };
}

function formatReport(results: CheckResult[], tenantId: string): string {
  // Always append the gutter, even when a field overflows its column: otherwise a long roles
  // claim runs straight into the next column with no space at all.
  const col = (s: string, w: number): string => (s.length >= w ? s : s + " ".repeat(w - s.length)) + "  ";
  const lines: string[] = [
    "Sprint 2, Stage A: gateway credential isolation (SPRINT2.md, Component 2)",
    `Run at: ${new Date().toISOString()}`,
    `Tenant: ${tenantId}`,
    "",
    "This proves Microsoft enforces the separation between the identity and MDM gateways'",
    "Graph permissions. It does not prove that a gateway process cannot read the other",
    "gateway's certificate from disk; that is a host-level concern (separate users or separate",
    "hosts), out of scope here.",
    "",
    "An empty result set is still a 200: the tenant has no devices, and the check is the status",
    "code Graph returns, not how many rows come back.",
    "",
    col("check", 34) + col("expected", 10) + col("actual", 8) + col("roles", 34) + "graph error",
    "-".repeat(110),
  ];

  for (const r of results) {
    lines.push(
      col(r.label, 34) +
        col(String(r.expectedStatus), 10) +
        col(String(r.actualStatus), 8) +
        col(r.roles.join(", ") || "(none)", 34) +
        (r.graphErrorCode ?? "-"),
    );
  }
  lines.push("");

  const failed = results.filter((r) => !r.pass);
  if (failed.length === 0) {
    lines.push(`PASS: all ${results.length} checks matched their expected status.`);
  } else {
    lines.push(`FAIL: ${failed.length} of ${results.length} checks did not match their expected status:`);
    for (const r of failed) lines.push(`  ${r.label}: expected ${r.expectedStatus}, got ${r.actualStatus}`);
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const env = loadGatewayEnv();

  const identity = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_IDENTITY_CLIENT_ID,
    thumbprint: env.AZURE_IDENTITY_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_IDENTITY_CERT_PATH),
  });
  const mdm = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_MDM_CLIENT_ID,
    thumbprint: env.AZURE_MDM_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_MDM_CERT_PATH),
  });

  const checks: Check[] = [
    { label: "identity token -> GET /users", credential: identity, url: `${GRAPH}/v1.0/users?$top=1`, expectedStatus: 200 },
    { label: "identity token -> GET /devices", credential: identity, url: `${GRAPH}/v1.0/devices?$top=1`, expectedStatus: 403 },
    { label: "mdm token -> GET /devices", credential: mdm, url: `${GRAPH}/v1.0/devices?$top=1`, expectedStatus: 200 },
    { label: "mdm token -> GET /users", credential: mdm, url: `${GRAPH}/v1.0/users?$top=1`, expectedStatus: 403 },
  ];

  const results: CheckResult[] = [];
  for (const check of checks) results.push(await runCheck(check));

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
  process.exit(1);
});
