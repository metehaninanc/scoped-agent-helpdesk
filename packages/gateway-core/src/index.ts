/**
 * Public surface of @helpdesk/gateway-core. SPRINT3.md, 3.2: the shared spine every gateway is
 * built from — HTTP transport, MCP wiring, token validation, the call order, audit wiring, the
 * refusal shapes — and nothing a gateway's own identity depends on: no policy rules, no tool
 * schemas, no credential. A gateway with neither a credential nor a backend client is a
 * first-class case here, not a workaround (SPRINT3.md, 3.3 needs exactly that).
 */
export { createLogger, type Logger } from "./log.js";
export { openDatabase, assertNodeSupportsSqlite, IN_MEMORY, MIN_NODE_VERSION, type DatabaseSync } from "./db.js";
export { findEnvFile, loadEnv, optionalString, type LoadEnvOptions } from "./env.js";

export { JwksClient, type Jwk, type JwksClientOptions } from "./auth/jwks.js";
export {
  TokenValidator,
  type TokenValidationReason,
  type TokenValidationResult,
  type TokenValidatorOptions,
  type ValidatedToken,
} from "./auth/verify-token.js";

export {
  sessionFromExtra,
  type Decision,
  type ParseResult,
  type RequestContext,
  type SessionContext,
  type ToolCallExtra,
  type ToolRequest,
} from "./session.js";

export {
  runToolCall,
  type DeniedOutput,
  type ErrorOutput,
  type GatewayToolOutput,
  type PendingApprovalOutput,
  type RunToolCallDeps,
  type ToolCallResult,
} from "./tool-call.js";

export { createGatewayServer, createTransportFactory, type CreateGatewayServerOptions, type ToolDefinitionLike } from "./server.js";
export { createRequestListener, type HttpGatewayDeps, type RequestTransport } from "./http-listener.js";

export { createTestSigningKeys, type TestSigningKeys } from "./testing.js";
export { conformanceSuite, type ConformanceHarness } from "./conformance.js";

export { userPrincipalName } from "./upn.js";

// SPRINT3.md, 3.4: moved from the identity gateway once the endpoint gateway needed its own
// approval store, workflow and decision endpoint, not identity's — see approvals/workflow.ts's
// header comment for what was generalized (execute() became an injected callback) and what
// stayed identical (everything else).
export { ApprovalStore, type ApprovalCreateInput, type ApprovalRecord, type ApprovalStatus, type ApprovalVerdict } from "./approvals/store.js";
export {
  ApprovalError,
  ApprovalWorkflow,
  APPROVER_AGENT,
  DENY_SELF_APPROVAL,
  type ApprovalDecisionInput,
  type ApprovalErrorCode,
  type ApprovalOutcome,
  type ApprovalWorkflowDeps,
  type ExecutionOutcome,
} from "./approvals/workflow.js";
export { createDecisionListener, type DecisionListenerDeps } from "./approvals/decision-listener.js";

// SPRINT4.md, section 2: one tool, identical on every gateway. The generic queue-item lifecycle
// this builds on lives in @helpdesk/handoff-core, not here — see that package's own header
// comment for why a gateway's own `hand_off` tool and the orchestrator's direct-creation path
// share a standalone package rather than one importing the other's runtime.
export {
  createHandOffExecute,
  HAND_OFF_PARAMS_SCHEMA,
  HAND_OFF_TOOL_DESCRIPTION,
  HAND_OFF_TOOL_NAME,
  type HandOffOk,
} from "./hand-off-tool.js";
