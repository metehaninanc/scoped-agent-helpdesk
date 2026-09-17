/**
 * Public surface of the agent package: the functions other packages (the web app) call to run a
 * request through one of the two agents. Deliberately two separate exports, not a shared
 * `RunQuery` type or a `runAgent(kind, ...)` dispatcher — see mdm-agent.ts's header comment for
 * why the two agents stay two files rather than one parameterized implementation.
 */
export { runIdentityAgent, type IdentityAgentOptions, type IdentityAgentResult, type RunQuery } from "./identity-agent.js";
export { runMdmAgent, type MdmAgentOptions, type MdmAgentResult, type RunQuery as MdmRunQuery } from "./mdm-agent.js";
