/**
 * Public surface of the MDM gateway package. Same two-consumer split as the identity gateway's
 * index.ts: an agent package, once one exists for this gateway, may import only type
 * definitions from here (SPRINT1.md's rule, carried forward); nothing does yet in Sprint 2.
 */
export { policyConfig } from "./policy/config.js";
export type { Decision, PolicyConfig, RequestContext, RuleId, ToolRequest } from "./policy/types.js";
export type { ToolName, ToolParams } from "./policy/schemas.js";

export type { SessionContext, ToolOutput } from "./tools/handler.js";
export { TOOL_NAMES } from "./tools/descriptions.js";
export { GATEWAY_NAME } from "./tools/server.js";
