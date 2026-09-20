/**
 * This gateway's own environment. SPRINT3.md, 3.2: before this phase, this gateway read its
 * `AZURE_MDM_*` fields and `MDM_GATEWAY_AUDIENCE` out of the identity gateway's own
 * `gatewayEnvSchema`, imported across the package boundary — the schema that gateway's env.ts
 * happened to also declare, not a schema this gateway owned. That stopped this gateway's own
 * environment from being reviewable on its own, and would not have survived a third gateway
 * needing yet more fields piled onto the same object. This file owns only what the MDM gateway
 * itself needs; @helpdesk/gateway-core's env.ts supplies the generic find/load/validate
 * mechanics both this file and the identity gateway's own env.ts now share.
 */
import { z } from "zod";

import { loadEnv, type LoadEnvOptions } from "@helpdesk/gateway-core";

const guid = z.guid();
const thumbprint = z.string().regex(/^[0-9a-f]{40}$/i, "must be a 40-character hex SHA-1 thumbprint");

export const mdmGatewayEnvSchema = z.object({
  AZURE_TENANT_ID: guid,
  AZURE_MDM_CLIENT_ID: guid,
  /** Path to the PEM private key. Lives outside the repo. */
  AZURE_MDM_CERT_PATH: z.string().min(1),
  /** SHA-1 thumbprint, 40 hex characters, as the portal shows it. */
  AZURE_MDM_CERT_THUMBPRINT: thumbprint,
  /** This gateway's own Application ID URI, e.g. api://helpdesk-mdm-gateway. */
  MDM_GATEWAY_AUDIENCE: z.string().min(1),
});

export type MdmGatewayEnv = z.infer<typeof mdmGatewayEnvSchema>;

export function loadMdmGatewayEnv(options: LoadEnvOptions = {}): MdmGatewayEnv {
  return loadEnv(mdmGatewayEnvSchema, options);
}
