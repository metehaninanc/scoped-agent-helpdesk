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
 *   - The web app is a human-only interface (the approver's screen), not model-reachable, and
 *     Sprint 1 has no HTTP transport on the gateway for it to call into instead. So it imports
 *     the runtime pieces it genuinely needs directly: the Graph client and credential, the
 *     approval store and workflow, and the environment loader. SPRINT2.md, Stage B, Component 5
 *     removes this once HTTP transport exists (see "Scope" below): tracked there, not yet done
 *     as of this comment.
 *
 * The audit record types are re-exported from @helpdesk/audit-core for convenience, so a
 * consumer of the gateway's types (the web app, rendering an approval) does not need to know
 * that package exists separately. The agent package imports @helpdesk/audit-core directly,
 * as a normal dependency, not through here — it is a shared package, not gateway internals.
 *
 * A third consumer as of SPRINT2.md, Stage A: @helpdesk/mdm-gateway imports the Graph HTTP/auth
 * plumbing (CertificateCredential, GraphClient, deviceId), openDatabase, loadGatewayEnv and
 * userPrincipalName from here, the same way the web app does — genuinely shared code, never
 * shared configuration. It does not import this package's PolicyConfig, policyConfig, or any
 * identity-specific tool schema; its own policy/ module is its own, on purpose.
 */
export type { AuditDecision, AuditInput, AuditRecord, ChainBreak } from "@helpdesk/audit-core";

export { ApprovalStore } from "./approvals/store.js";
export type { ApprovalCreateInput, ApprovalRecord, ApprovalStatus, ApprovalVerdict } from "./approvals/store.js";
export { ApprovalError, ApprovalWorkflow } from "./approvals/workflow.js";
export type {
  ApprovalDecisionInput,
  ApprovalErrorCode,
  ApprovalOutcome,
  ApprovalWorkflowDeps,
  ExecutionOutcome,
} from "./approvals/workflow.js";
export type { RationaleFacts, RationaleResult } from "./approvals/rationale.js";

export { openDatabase } from "./db.js";
export { loadGatewayEnv } from "./env.js";
export type { GatewayEnv } from "./env.js";

export { CertificateCredential } from "./graph/certificate-credential.js";
export type { AccessToken } from "./graph/certificate-credential.js";

export { JwksClient } from "./auth/jwks.js";
export { TokenValidator } from "./auth/verify-token.js";
export type { TokenValidationReason, TokenValidationResult, ValidatedToken } from "./auth/verify-token.js";
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
export { createRequestListener } from "./tools/http-listener.js";
export type { HttpGatewayDeps } from "./tools/http-listener.js";
