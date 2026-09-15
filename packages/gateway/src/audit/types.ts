/**
 * Audit log records. See SPRINT1.md, "Component 3: audit log".
 *
 * `decision` doubles as the record kind. Policy decisions come from decide(); `request` and
 * `no_tool_called` bracket an agent session so a request the model declined on its own,
 * without touching a tool, still leaves a trail.
 */
export const AUDIT_DECISIONS = ["request", "autonomous", "approval", "denied", "no_tool_called"] as const;
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
