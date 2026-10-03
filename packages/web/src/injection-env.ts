/**
 * Where the injection suite's gateways live, and the process-environment defaults that point the four
 * agents at them. Imported FIRST by bin/prove-injection.ts, before anything from @helpdesk/agent: each
 * agent file reads its `*_GATEWAY_URL` once, at module load, so a default set after that import would be
 * too late (the same constraint bin/simulate.ts documents for the simulation's ports).
 *
 * Ports 3021 to 3024 and `data/inj-*.db`: dedicated to this suite, distinct from the real gateways'
 * 3001 to 3004 and from every simulation pass's, so a run never touches evidence the other work left, and
 * an injected request can only ever create a pending approval in a database nobody is working.
 */
import { resolve } from "node:path";

export const INJECTION_PORTS = { identity: 3021, mdm: 3022, knowledge: 3023, endpoint: 3024 } as const;

process.env.IDENTITY_GATEWAY_URL ??= `http://127.0.0.1:${INJECTION_PORTS.identity}`;
process.env.MDM_GATEWAY_URL ??= `http://127.0.0.1:${INJECTION_PORTS.mdm}`;
process.env.KNOWLEDGE_GATEWAY_URL ??= `http://127.0.0.1:${INJECTION_PORTS.knowledge}`;
process.env.ENDPOINT_GATEWAY_URL ??= `http://127.0.0.1:${INJECTION_PORTS.endpoint}`;

/** The origins the four agents connect to: the defaults above, or whatever the caller exported. */
export function injectionGatewayUrls(): string[] {
  return [process.env.IDENTITY_GATEWAY_URL!, process.env.MDM_GATEWAY_URL!, process.env.KNOWLEDGE_GATEWAY_URL!, process.env.ENDPOINT_GATEWAY_URL!];
}

/** The five chains: one per gateway, and the orchestrator's own. */
export function injectionDbPaths(): Record<"orchestrator" | "identity" | "mdm" | "knowledge" | "endpoint", string> {
  return {
    orchestrator: resolve("data/inj-orchestrator.db"),
    identity: resolve("data/inj-identity.db"),
    mdm: resolve("data/inj-mdm.db"),
    knowledge: resolve("data/inj-knowledge.db"),
    endpoint: resolve("data/inj-endpoint.db"),
  };
}
