/**
 * This gateway's own environment. SPRINT3.md, 3.3: notice what is missing compared to the other
 * two gateways' env.ts — no `AZURE_KNOWLEDGE_CLIENT_ID`, no certificate path, no thumbprint. This
 * gateway validates tokens against Entra's public keys; it never mints one of its own, because
 * it never calls anything that would need one. `AZURE_TENANT_ID` is the one field it shares with
 * every other gateway on this tenant, the same as always; `KNOWLEDGE_GATEWAY_AUDIENCE` is its own
 * Application ID URI, the value a bearer token's `aud` claim must equal before this gateway will
 * honour it. The knowledge *agent*'s own certificate (`AZURE_KNOWLEDGE_AGENT_*`) lives in the
 * agent package's own env module, same convention as the other two agents.
 */
import { z } from "zod";

import { loadEnv, type LoadEnvOptions } from "@helpdesk/gateway-core";

const knowledgeGatewayEnvSchema = z.object({
  AZURE_TENANT_ID: z.guid(),
  /** This gateway's own Application ID URI, e.g. api://helpdesk-knowledge-gateway. */
  KNOWLEDGE_GATEWAY_AUDIENCE: z.string().min(1),
});

export type KnowledgeGatewayEnv = z.infer<typeof knowledgeGatewayEnvSchema>;

export function loadKnowledgeGatewayEnv(options: LoadEnvOptions = {}): KnowledgeGatewayEnv {
  return loadEnv(knowledgeGatewayEnvSchema, options);
}
