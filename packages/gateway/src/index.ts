/**
 * Public surface of the gateway package.
 *
 * Two different rules apply to two different consumers:
 *
 *   - The agent package may import TYPES from here and nothing else (SPRINT1.md: "The agent
 *     package must not import anything from the gateway package other than type
 *     definitions"). It reaches the gateway's behaviour only over MCP, as a spawned
 *     subprocess it does not trust with its own model-facing tool surface.
 *   - The web app is a human-only interface (the approver's screen), not model-reachable, and
 *     Sprint 1 has no HTTP transport on the gateway for it to call into instead (that is a
 *     named Sprint 2 item). So it imports the runtime pieces it genuinely needs directly:
 *     the Graph client and credential, the approval store and workflow, and the environment
 *     loader. This is the same trust boundary as the gateway process itself, not a new one.
 *
 * The audit record types are re-exported from @helpdesk/audit-core for convenience, so a
 * consumer of the gateway's types (the web app, rendering an approval) does not need to know
 * that package exists separately. The agent package imports @helpdesk/audit-core directly,
 * as a normal dependency, not through here — it is a shared package, not gateway internals.
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
export { GraphClient, GraphError, GRAPH_SCOPE } from "./graph/client.js";
export type { AddMemberResult, GroupSummary } from "./graph/client.js";

export { policyConfig } from "./policy/config.js";
export type { Decision, PolicyConfig, RequestContext, RuleId, ToolRequest } from "./policy/types.js";
export type { ToolName, ToolParams } from "./policy/schemas.js";

export type { SessionContext, ToolOutput } from "./tools/handler.js";
export { TOOL_NAMES } from "./tools/descriptions.js";
export { GATEWAY_NAME } from "./tools/server.js";
