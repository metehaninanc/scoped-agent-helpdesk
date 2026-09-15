/**
 * Public surface of the gateway package. Other packages may import TYPES from here and nothing
 * else (SPRINT1.md: "The agent package must not import anything from the gateway package
 * other than type definitions"). Runtime access to the gateway is over MCP.
 */
export type { AuditDecision, AuditInput, AuditRecord, ChainBreak } from "./audit/types.js";
export type { ApprovalRecord, ApprovalStatus } from "./approvals/store.js";
export type { ApprovalDecisionInput, ApprovalErrorCode, ApprovalOutcome, ExecutionOutcome } from "./approvals/workflow.js";
export type { RationaleFacts, RationaleResult } from "./approvals/rationale.js";
export type { Decision, PolicyConfig, RequestContext, RuleId, ToolRequest } from "./policy/types.js";
export type { ToolName, ToolParams } from "./policy/schemas.js";
export type { SessionContext, ToolOutput } from "./tools/handler.js";
export { TOOL_NAMES } from "./tools/descriptions.js";
export { GATEWAY_NAME } from "./tools/server.js";
