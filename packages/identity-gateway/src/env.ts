/**
 * This gateway's own environment. This is the only place in the repo that reads its
 * certificate path. SPRINT1.md: "Never let the agent package read the certificate path from the
 * environment. If that import becomes convenient, the architecture has drifted."
 *
 * SPRINT3.md, 3.2: before this phase, one schema here also declared the MDM gateway's own
 * `AZURE_MDM_*` fields and `MDM_GATEWAY_AUDIENCE`, so that the MDM gateway could import this same
 * schema rather than write its own. That does not survive a third gateway with different fields
 * again (a credential-less one, from 3.3, has none of these at all) — see
 * @helpdesk/gateway-core's env.ts for the generic find/load/validate mechanics this file now
 * uses. What is left here is only what this gateway itself needs: `AZURE_TENANT_ID` is the one
 * field every gateway on this tenant happens to share, not a reason to share the whole schema.
 */
import { z } from "zod";

import { loadEnv, optionalString, type LoadEnvOptions } from "@helpdesk/gateway-core";

const guid = z.guid();
const thumbprint = z.string().regex(/^[0-9a-f]{40}$/i, "must be a 40-character hex SHA-1 thumbprint");

export const gatewayEnvSchema = z.object({
  AZURE_TENANT_ID: guid,
  AZURE_IDENTITY_CLIENT_ID: guid,
  /** Path to the PEM private key. Lives outside the repo. */
  AZURE_IDENTITY_CERT_PATH: z.string().min(1),
  /** SHA-1 thumbprint, 40 hex characters, as the portal shows it. */
  AZURE_IDENTITY_CERT_THUMBPRINT: thumbprint,
  /** This gateway's own Application ID URI, e.g. api://helpdesk-identity-gateway. */
  IDENTITY_GATEWAY_AUDIENCE: z.string().min(1),
  /** Optional. SQLite file for the audit log and approvals. Default: data/identity-helpdesk.db. */
  HELPDESK_DB_PATH: optionalString,
  /**
   * Optional. Used for one thing: the approval rationale, one model call per approval record.
   * Without it the gateway still runs; approvals simply carry no rationale, and it says so.
   */
  ANTHROPIC_API_KEY: optionalString,
  /** Optional. Model for the rationale call. Default: claude-opus-5. */
  HELPDESK_RATIONALE_MODEL: optionalString,
});

export type GatewayEnv = z.infer<typeof gatewayEnvSchema>;

export function loadGatewayEnv(options: LoadEnvOptions = {}): GatewayEnv {
  return loadEnv(gatewayEnvSchema, options);
}

