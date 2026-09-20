/**
 * This gateway's own environment. SPRINT3.md, 3.4: same shape as the knowledge gateway's env.ts
 * (3.3) and for the same reason — no `AZURE_ENDPOINT_CLIENT_ID`, no certificate, no thumbprint.
 * This gateway holds no credential of any kind, because it has nothing that needs one: its two
 * reads and one gated write run against a local stub service, not Graph, and its one Graph-shaped
 * tool, reset_password, is never executed at all (see policy/decide.ts) — there being no working
 * password-reset capability here is exactly why there is no Entra permission to request for it,
 * either. `AZURE_TENANT_ID` is the one field shared with every other gateway on this tenant;
 * `ENDPOINT_GATEWAY_AUDIENCE` is this gateway's own Application ID URI, the value a bearer
 * token's `aud` claim must equal before this gateway will honour it. The endpoint *agent*'s own
 * certificate (`AZURE_ENDPOINT_AGENT_*`) lives in the agent package's own env module, same
 * convention as the other three agents.
 */
import { z } from "zod";

import { loadEnv, type LoadEnvOptions } from "@helpdesk/gateway-core";

const endpointGatewayEnvSchema = z.object({
  AZURE_TENANT_ID: z.guid(),
  /** This gateway's own Application ID URI, e.g. api://helpdesk-endpoint-gateway. */
  ENDPOINT_GATEWAY_AUDIENCE: z.string().min(1),
});

export type EndpointGatewayEnv = z.infer<typeof endpointGatewayEnvSchema>;

export function loadEndpointGatewayEnv(options: LoadEnvOptions = {}): EndpointGatewayEnv {
  return loadEnv(endpointGatewayEnvSchema, options);
}
