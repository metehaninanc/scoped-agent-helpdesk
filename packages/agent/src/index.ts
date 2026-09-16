/**
 * Public surface of the agent package: the one function other packages (the web app) call to
 * run a request through the identity agent.
 */
export { runIdentityAgent, type IdentityAgentOptions, type IdentityAgentResult, type RunQuery } from "./identity-agent.js";
