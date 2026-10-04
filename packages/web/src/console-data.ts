/**
 * The operator console's own data shaping — everything that is not HTML. SPRINT4.md, section 3:
 * "One page, two queues... A queue row shows enough to triage it without opening it: when it
 * arrived, who asked, a one line summary of the request, and what kind of action it needs."
 *
 * The two queues are read the same way the dashboard already reads all five chains: live, on
 * every render, never cached (SPRINT3.md, 3.5's own discipline, carried over rather than
 * reinvented). An approval and a handoff are deliberately not forced into one row shape beyond
 * what they genuinely share (id, when, who, a summary, and what it needs) — see the README,
 * "Operator console notes", for why: they are different kinds of work with different actions.
 */
import type { AuditRecord } from "@helpdesk/audit-core";
import type { ApprovalRecord } from "@helpdesk/gateway-core";
import type { HandoffRecord } from "@helpdesk/handoff-core";

export type QueueKind = "approval" | "handoff";

export interface QueueRow {
  kind: QueueKind;
  id: string;
  requestId: string;
  createdAt: string;
  ageMs: number;
  actor: string;
  /** One line: the request itself for a handoff, the change being asked for an approval —
   * built from the tool and its own parameters, since an ApprovalRecord carries no raw request
   * text of its own (see summarizeApproval()). */
  summary: string;
  /** What kind of action this needs: the tool name for an approval, the reason for a handoff. */
  action: string;
  /** Sorts above every non-urgent row whatever its age (sortQueue). Only a handoff can be urgent:
   * triage's `security` outcome creates one that way. Always false for an approval. */
  urgent: boolean;
}

const TRUNCATE_LENGTH = 90;

function truncate(text: string): string {
  return text.length > TRUNCATE_LENGTH ? `${text.slice(0, TRUNCATE_LENGTH - 1)}…` : text;
}

/** An ApprovalRecord's params shape is tool-specific and untyped past `unknown` — this only ever
 * reads fields that already went through the owning gateway's own schema validation before the
 * approval was created, so a missing field here means the tool itself has no such parameter, not
 * that validation was skipped. */
function summarizeApproval(approval: ApprovalRecord): string {
  const params = approval.params as Record<string, unknown>;
  switch (approval.tool) {
    case "add_user_to_group":
      return `Add ${String(params.userPrincipalName)} to group ${String(params.groupId)}`;
    case "remove_user_from_group":
      return `Remove ${String(params.userPrincipalName)} from group ${String(params.groupId)}`;
    case "reboot_endpoint":
      return `Reboot endpoint ${String(params.endpointId)}`;
    default:
      // Every approval-gated tool this project has is named above; a new one falling through to
      // this default is a real gap worth seeing plainly on the page, not hidden behind a guess.
      return `${approval.tool} (no summary written for this tool yet)`;
  }
}

export function approvalRow(approval: ApprovalRecord, now: Date): QueueRow {
  return {
    kind: "approval",
    id: approval.id,
    requestId: approval.requestId,
    createdAt: approval.createdAt,
    ageMs: now.getTime() - new Date(approval.createdAt).getTime(),
    actor: approval.actor,
    summary: summarizeApproval(approval),
    action: approval.tool,
    urgent: false,
  };
}

export function handoffRow(handoff: HandoffRecord, now: Date): QueueRow {
  return {
    kind: "handoff",
    id: handoff.id,
    requestId: handoff.requestId,
    createdAt: handoff.createdAt,
    ageMs: now.getTime() - new Date(handoff.createdAt).getTime(),
    actor: handoff.actor,
    summary: truncate(handoff.requestText),
    action: truncate(handoff.reason),
    urgent: handoff.urgent,
  };
}

/** Urgent first, then oldest first. SPRINT4.md, section 3: "Oldest first by default, since age is
 * the thing that hurts" — and an urgent row (a possible security incident) hurts more than any age
 * can: it sorts above every non-urgent row whatever its age, and the rest keep oldest-first order.
 * Ties broken by id for a stable order across renders. */
export function sortQueue(rows: readonly QueueRow[]): QueueRow[] {
  return [...rows].sort(
    (a, b) => Number(b.urgent) - Number(a.urgent) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------
// The opened-item trail: "what the system did and why" (SPRINT4.md, section 3, item 2), built
// the same way the dashboard already correlates across chains — by requestId, never a merged
// table (SPRINT2.md, Component 6's own reasoning, applied here one more time).
// ---------------------------------------------------------------------------

export interface TrailRecord extends AuditRecord {
  /** Which chain this record came from — orchestrator, identity, mdm, knowledge, or endpoint. */
  chain: string;
}

export interface AuditReader {
  list(): AuditRecord[];
}

/** Every record carrying this requestId, across every chain given, oldest first. A handoff or an
 * approval's own record sits inside this trail like any other — this function does not treat
 * either specially, it just returns what happened, in order. */
export function getRequestTrail(requestId: string, chains: Record<string, AuditReader>): TrailRecord[] {
  const records: TrailRecord[] = [];
  for (const [chain, log] of Object.entries(chains)) {
    for (const record of log.list()) {
      if (record.requestId === requestId) records.push({ ...record, chain });
    }
  }
  return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id - b.id);
}

/** The raw request, exactly as the person typed it (SPRINT4.md, section 3, item 1) — read back
 * from whichever record in the trail actually carries it, never re-typed or reconstructed. A
 * `request` record's own `parameters` is the text itself; a `routed`/`denied`/`handoff` record on
 * the orchestrator's chain carries it inside `parameters.requestText`. Returns null if the trail
 * genuinely has none, which the page must say plainly rather than showing a blank line for. */
export function rawRequestText(trail: readonly TrailRecord[]): string | null {
  for (const record of trail) {
    if (record.decision === "request" && typeof record.parameters === "string") return record.parameters;
    if (record.parameters !== null && typeof record.parameters === "object" && "requestText" in record.parameters) {
      const text = (record.parameters as { requestText: unknown }).requestText;
      if (typeof text === "string") return text;
    }
  }
  return null;
}
