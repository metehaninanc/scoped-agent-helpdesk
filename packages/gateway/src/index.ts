/**
 * Public surface of the gateway package. Other packages may import TYPES from here and nothing
 * else (SPRINT1.md: "The agent package must not import anything from the gateway package
 * other than type definitions"). Runtime access to the gateway is over MCP.
 *
 * The audit record types are re-exported from @helpdesk/audit-core for convenience, so a
 * consumer of the gateway's types (the web app, rendering an approval) does not need to know
 * that package exists separately. The agent package imports @helpdesk/audit-core directly,
 * as a normal dependency, not through here — it is a shared package, not gateway internals.
 */
export type { AuditDecision, AuditInput, AuditRecord, ChainBreak } from "@helpdesk/audit-core";
export type { ApprovalRecord, ApprovalStatus } from "./approvals/store.js";
export type { ApprovalDecisionInput, ApprovalErrorCode, ApprovalOutcome, ExecutionOutcome } from "./approvals/workflow.js";
export type { RationaleFacts, RationaleResult } from "./approvals/rationale.js";
export type { Decision, PolicyConfig, RequestContext, RuleId, ToolRequest } from "./policy/types.js";
export type { ToolName, ToolParams } from "./policy/schemas.js";
export type { SessionContext, ToolOutput } from "./tools/handler.js";
export { TOOL_NAMES } from "./tools/descriptions.js";
export { GATEWAY_NAME } from "./tools/server.js";
