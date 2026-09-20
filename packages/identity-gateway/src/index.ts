/**
 * Public surface of the gateway package.
 *
 * Two different rules apply to two different consumers:
 *
 *   - The agent package may import TYPES from here, plus, as of SPRINT2.md Stage B, exactly one
 *     runtime value: CertificateCredential. SPRINT1.md's original rule ("must not import
 *     anything from the gateway package other than type definitions") held throughout Sprint 1
 *     and Stage A; Stage B narrows rather than drops it, for a stated reason. CertificateCredential
 *     is generic — tenant/client/thumbprint/key as constructor parameters, no embedded Graph
 *     knowledge or credential of its own — so an agent using it to mint a token for its own
 *     gateway's Application ID URI does not reopen the door the original rule closed: the
 *     agent's certificate carries zero Graph permissions by construction (see the README,
 *     "Stage B: agents get a credential"), so nothing it can obtain reaches Graph. What the
 *     agent must still never import: GraphClient, the policy engine, a Graph credential, or
 *     anything else this package exposes.
 *   - The web app is a human-only interface (the approver's screen), not model-reachable. Through
 *     Stage A it held a Graph credential directly, because Sprint 1 had no HTTP transport on the
 *     gateway to call into instead. SPRINT2.md, Stage B, Component 5 removed that: the web app
 *     reads pending approvals with ApprovalStore and talks to a gateway's decision endpoint with
 *     ApprovalError and the ApprovalDecisionInput/ApprovalOutcome/ApprovalErrorCode types — all
 *     four moved to @helpdesk/gateway-core in SPRINT3.md, 3.4 (see that package's approvals/
 *     for why), so the web app now takes them from there directly, the same way it already takes
 *     openDatabase and TokenValidator from there rather than through this package. What stays
 *     here for the web app: loadGatewayEnv, and CertificateCredential — the same one narrow
 *     exception the agent package gets, reused for the same reason: authenticating itself to a
 *     gateway, never to Graph. GraphClient and this gateway's own ApprovalWorkflow wiring
 *     (execute.ts) now run only inside the gateway process (see bin/gateway.ts and
 *     gateway-core's approvals/decision-listener.ts); the web app no longer imports either.
 *
 * The audit record types are re-exported from @helpdesk/audit-core for convenience, so a
 * consumer of the gateway's types (the web app, rendering an approval) does not need to know
 * that package exists separately. The agent package imports @helpdesk/audit-core directly,
 * as a normal dependency, not through here — it is a shared package, not gateway internals.
 *
 * SPRINT3.md, 3.2: the generic gateway mechanics this package used to hold and @helpdesk/mdm-gateway
 * imported across the package boundary — openDatabase, TokenValidator, JwksClient,
 * createRequestListener, the MCP server wiring — now live in @helpdesk/gateway-core, a neutral
 * package both gateways depend on symmetrically, and are no longer re-exported from here at all.
 * A consumer that needs them (the web app, the MDM gateway) now takes @helpdesk/gateway-core as
 * its own direct dependency, the same way it already takes @helpdesk/audit-core directly rather
 * than through this package. What is left here and still genuinely gateway-specific: Graph
 * plumbing (CertificateCredential, GraphClient, userPrincipalName) and this gateway's own
 * approvals, policy and tool surface.
 */
export type { AuditDecision, AuditInput, AuditRecord, ChainBreak } from "@helpdesk/audit-core";

// SPRINT3.md, 3.4: ApprovalStore, ApprovalWorkflow, ApprovalError and the decision-endpoint
// types moved to @helpdesk/gateway-core once the endpoint gateway needed its own — no longer
// re-exported here; a consumer takes them from gateway-core directly, same as openDatabase.
export type { RationaleFacts, RationaleResult } from "./approvals/rationale.js";

export { loadGatewayEnv } from "./env.js";
export type { GatewayEnv } from "./env.js";

export { CertificateCredential } from "./graph/certificate-credential.js";
export type { AccessToken } from "./graph/certificate-credential.js";

export { GraphClient, GraphError, GRAPH_SCOPE, deviceId } from "./graph/client.js";
export type { AddMemberResult, DeviceSummary, GroupSummary } from "./graph/client.js";
export { decodeJwtClaims } from "./graph/jwt.js";

export { policyConfig } from "./policy/config.js";
export type { Decision, PolicyConfig, RequestContext, RuleId, ToolRequest } from "./policy/types.js";
export { userPrincipalName } from "./policy/schemas.js";
export type { ToolName, ToolParams } from "./policy/schemas.js";

export type { SessionContext, ToolOutput } from "./tools/handler.js";
export { TOOL_NAMES } from "./tools/descriptions.js";
export { GATEWAY_NAME } from "./tools/server.js";
