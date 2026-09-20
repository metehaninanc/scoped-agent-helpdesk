/**
 * Which model each model-calling component in this system runs on, and why — gathered in one
 * place because the dashboard's cost breakdown (SPRINT3.md, 3.5) is only meaningful once the
 * model behind every component is a deliberate choice, not whatever the Agent SDK's CLI happens
 * to resolve as its default on the day it runs. Before this file, only two of the three tiers
 * were actually pinned:
 *
 *   Triage (DEFAULT_TRIAGE_MODEL, triage.ts) already ran on a fixed model. It classifies every
 *   single request into one of five closed-set values, nothing more. That is the cheapest kind
 *   of judgement call to ask a model to make, and it runs on every request, including every one
 *   that gets refused before any agent runs — the smallest model that classifies reliably is the
 *   right one.
 *
 *   The rationale generator (DEFAULT_RATIONALE_MODEL,
 *   packages/identity-gateway/src/approvals/rationale.ts) already ran on a fixed model too. It
 *   runs only when a write needs a human's approval — a small fraction of all requests — and its
 *   entire output is read by a person deciding whether to change a production identity system.
 *   That is exactly the situation worth paying for the strongest available model: rare, and
 *   weighed directly in a consequential decision.
 *
 *   The four agents (DEFAULT_AGENT_MODEL, below) were the gap: nothing in identity-agent.ts,
 *   mdm-agent.ts, knowledge-agent.ts or endpoint-agent.ts ever set `model` in the Options passed
 *   to the Agent SDK's query(), so each one ran on whatever the CLI resolved as its own default —
 *   a value this repo does not control and that could change under it at any time. They sit
 *   between the other two tiers by what they are asked to do: more judgement than triage's
 *   closed-set pick (a real conversation, choosing a tool and its parameters, reporting a
 *   refusal or a pending approval honestly), but running once per routed request rather than once
 *   per request including every refused one, and never the thing a human approval decision itself
 *   is weighed against. The middle tier is the right cost/capability trade for that.
 *
 * Each tier keeps its own env var override, read at its own existing call site, unchanged by this
 * file: HELPDESK_TRIAGE_MODEL (orchestrator.ts), HELPDESK_RATIONALE_MODEL (identity-gateway's
 * bin/gateway.ts), HELPDESK_AGENT_MODEL (each of the four agent files). This file only fixes what
 * each one defaults to when no override is set, and writes the reasoning down in one place
 * instead of three. The identity gateway's own DEFAULT_RATIONALE_MODEL is not re-exported here:
 * that package's public surface (see its index.ts) deliberately exposes no runtime value to this
 * package beyond CertificateCredential, and a model name string is not worth widening that for —
 * packages/web/src/pricing.ts, which needs all three names for the dashboard's cost breakdown,
 * says the same thing at its own duplicated literal.
 */
export { DEFAULT_TRIAGE_MODEL } from "./triage.js";

/** The middle tier: real judgement, once per routed request. See the file header. */
export const DEFAULT_AGENT_MODEL = "claude-sonnet-5";
