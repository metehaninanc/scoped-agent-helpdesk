/**
 * The shape written to evidence/simulation-results.jsonl, one line per ticket — shared between
 * bin/simulate.ts (which produces it) and simulation-summary.ts (which reads it back). Never
 * carries actualNeed: see simulation-tickets.ts for where that is dropped, before a ticket's text
 * ever reaches this type or a model.
 */

/** One policy-visible tool call within the ticket's single agent turn. Almost always zero or one;
 * kept as a list rather than assuming exactly one, since a turn that looks up a managed group
 * before writing to it makes two. */
export interface SimToolCall {
  tool: string;
  decision: "autonomous" | "approval" | "denied";
  rules: string[];
}

export type SimCategory = "identity" | "mdm" | "knowledge" | "endpoint" | "unsupported" | "triage_failed" | "error";

export interface TicketResult {
  id: string;
  sourceFile: string;
  submittedBy: string;
  /** The real UPN this ticket's synthetic submittedBy was mapped to — see simulation-actor-mapping.ts. */
  actor: string;
  requestId: string | null;
  category: SimCategory;
  /** Null when triage never completed (triage_failed) or the runner itself errored — there is no
   * classification to have flagged as partially out of scope. */
  partiallyOutOfScope: boolean | null;
  agentInvoked: "identity-agent" | "mdm-agent" | "knowledge-agent" | "endpoint-agent" | null;
  toolCalled: boolean;
  toolCalls: SimToolCall[];
  /** The last tool call's own tool/decision/rules, for a quick read without walking toolCalls —
   * null when toolCalls is empty. */
  toolName: string | null;
  policyDecision: "autonomous" | "approval" | "denied" | null;
  policyRules: string[];
  reply: string;
  /** Set only when the runner itself threw (a network blip, a credential failure, ...) rather
   * than the system producing an ordinary outcome. category is "error" whenever this is set. */
  error?: string;
}
