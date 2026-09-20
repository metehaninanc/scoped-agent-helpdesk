/**
 * Public surface of the knowledge gateway package. Same two-consumer split as the other
 * gateways' index.ts; the knowledge agent (packages/agent/src/knowledge-agent.ts) imports only
 * type definitions from here, same as SPRINT1.md's original rule.
 */
export { policyConfig } from "./policy/config.js";
export type { Decision, PolicyConfig, RequestContext, RuleId, ToolRequest } from "./policy/types.js";
export type { ToolName, ToolParams } from "./policy/schemas.js";

export type { SessionContext, ToolOutput } from "./tools/handler.js";
export { TOOL_NAMES } from "./tools/descriptions.js";
export { GATEWAY_NAME } from "./tools/server.js";

export { loadCorpus, corpusRawDir, type CorpusChunk } from "./corpus.js";
export { createDocumentationSearch, type DocumentationSearch, type SearchResult } from "./search.js";
