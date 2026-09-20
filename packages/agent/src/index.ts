/**
 * Public surface of the agent package: the functions other packages (the web app) call to run a
 * request through one of the four agents, and, as of SPRINT3.md 3.1, the orchestration layer
 * that decides which one. Deliberately four separate agent exports, not a shared `RunQuery`
 * type or a `runAgent(kind, ...)` dispatcher — see mdm-agent.ts's header comment for why the
 * agents stay separate files rather than one parameterized implementation. routeRequest() is the
 * one function other packages should call for a raw, unclassified request;
 * runIdentityAgent/runMdmAgent/runKnowledgeAgent/runEndpointAgent stay exported for direct use
 * (the CLIs, and routeRequest's own default wiring).
 */
export { runIdentityAgent, type IdentityAgentOptions, type IdentityAgentResult, type RunQuery } from "./identity-agent.js";
export { runMdmAgent, type MdmAgentOptions, type MdmAgentResult, type RunQuery as MdmRunQuery } from "./mdm-agent.js";
export {
  runKnowledgeAgent,
  type KnowledgeAgentOptions,
  type KnowledgeAgentResult,
  type RunQuery as KnowledgeRunQuery,
} from "./knowledge-agent.js";
export {
  runEndpointAgent,
  type EndpointAgentOptions,
  type EndpointAgentResult,
  type RunQuery as EndpointRunQuery,
} from "./endpoint-agent.js";
export { routeRequest, type RouteRequestOptions, type RouteRequestResult } from "./orchestrator.js";
export { TRIAGE_CATEGORIES, type TriageCategory } from "./triage.js";
export { DEFAULT_AGENT_MODEL, DEFAULT_TRIAGE_MODEL } from "./models.js";
