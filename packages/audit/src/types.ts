/**
 * Audit log records. See SPRINT1.md, "Component 3: audit log".
 *
 * `decision` doubles as the record kind:
 *
 *   request, no_tool_called     bracket an agent session, so a request the model declined on
 *                               its own, without touching a tool, still leaves a trail
 *   autonomous, approval, denied  policy decisions from decide(); a second record with the
 *                               same kind and a non-null result marks execution
 *   rationale_requested          an approver asked for a briefing on a pending approval
 *                               (SPRINT4.md, section 4). Written before the model is ever called
 *                               — evidence that the ask happened, regardless of what it produces.
 *                               actor is the approver, not the original requester; parameters =
 *                               { approvalId }; result is always null
 *   rationale                   supporting information generated for approvers. Never a
 *                               decision. parameters = exactly the facts the model was given,
 *                               result = the text it returned, verbatim, or an error if generation
 *                               failed. As of SPRINT4.md, section 4, always preceded by its own
 *                               `rationale_requested` record on the same chain — generation is
 *                               requested by a human from the console, never automatic
 *   approved, rejected          a human approver's verdict; actor is the approver. A second
 *                               approved record with a non-null result marks execution
 *   routed                      the orchestration layer dispatched a request to an agent, after
 *                               triage classified it (SPRINT3.md, 3.1). tool is null; parameters
 *                               carries the request text and the chosen category, result names
 *                               the agent invoked. Written to the orchestrator's own chain, never
 *                               to the invoked agent's
 *   model_usage                 token usage for one model call: an agent's own turn, a rationale
 *                               generation, or a triage classification. Never a decision.
 *                               parameters is null, result = { model, inputTokens, outputTokens }
 *   handoff                     a request was queued for a person to work outside this system
 *                               (SPRINT4.md, section 2). Not a refusal: a real, first-class
 *                               outcome, the same way `routed` is. Written either by the
 *                               orchestrator directly (triage decided `needs_human`, `network` or
 *                               `security`, before any agent or gateway is involved — see
 *                               @helpdesk/handoff-core's own README notes for why that path has no
 *                               policy decision to make) or by a gateway's `hand_off` tool,
 *                               autonomous, called by the model mid-conversation. `parameters`
 *                               carries the reason and `urgent` (true only for triage's
 *                               `security`; records written before the field existed lack it and
 *                               read as not urgent); `result` is null until taken
 *   handoff_taken               an operator started working a handoff. `result` names who and
 *                               when; no note required (SPRINT4.md, section 3: only `resolve`
 *                               requires one)
 *   handoff_resolved            an operator finished working a handoff. `result` carries the
 *                               required resolution note
 */
export const AUDIT_DECISIONS = [
  "request",
  "autonomous",
  "approval",
  "denied",
  "no_tool_called",
  "rationale_requested",
  "rationale",
  "approved",
  "rejected",
  "routed",
  "model_usage",
  "handoff",
  "handoff_taken",
  "handoff_resolved",
] as const;
export type AuditDecision = (typeof AUDIT_DECISIONS)[number];

/** What a caller supplies. Everything else (id, timestamp, hashes) is the log's business. */
export interface AuditInput {
  /** Correlates all records from one user request. Generated once per agent session. */
  requestId: string;
  /** UPN of the requesting user. */
  actor: string;
  /** Which agent made the call. */
  agent: string;
  /** Tool name. Null on `request` and `no_tool_called` records. */
  tool?: string | null;
  /** The validated input, or the request text on `request` records. Stored as JSON. */
  parameters: unknown;
  decision: AuditDecision;
  /** Which rules fired. Empty when no policy decision was made. */
  rules?: readonly string[];
  /** Null until execution. On a `no_tool_called` record, the agent's reply. */
  result?: unknown;
}

/** A record as read back: JSON columns parsed. */
export interface AuditRecord {
  id: number;
  /** ISO 8601, UTC. */
  timestamp: string;
  requestId: string;
  actor: string;
  agent: string;
  tool: string | null;
  parameters: unknown;
  decision: AuditDecision;
  rules: string[];
  result: unknown;
  /** sha256 hex of the previous record, or GENESIS_HASH for the first. */
  prevHash: string;
  /** sha256 hex of this record, prevHash included. */
  hash: string;
}

/**
 * A record exactly as stored: JSON columns are the strings SQLite holds. This is the shape
 * that gets hashed, so verification re-hashes what is on disk, not a re-serialisation of it.
 */
export interface AuditRow {
  id: number;
  timestamp: string;
  requestId: string;
  actor: string;
  agent: string;
  tool: string | null;
  parameters: string;
  decision: AuditDecision;
  rules: string;
  result: string | null;
  prevHash: string;
  hash: string;
}

export type ChainBreakReason = "hash_mismatch" | "prev_hash_mismatch" | "id_gap" | "tail_truncated";

/** The first record at which the chain fails, and why. */
export interface ChainBreak {
  /** 0-based position in id order. For a truncated tail, the position the record should be at. */
  index: number;
  /** The record's id. For a truncated tail, the id the marker says should be there. */
  id: number;
  reason: ChainBreakReason;
}

/** The head marker: what the last record should be. */
export interface AuditHead {
  lastId: number;
  lastHash: string;
}
