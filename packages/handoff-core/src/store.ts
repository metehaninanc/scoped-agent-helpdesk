/**
 * The handoff queue item lifecycle. SPRINT4.md, section 2: "A handoff is an outcome, not a
 * refusal. It gets its own audit decision kind and its own record... States are open, taken, and
 * resolved."
 *
 * This is the generic core two different writers share: a gateway's own `hand_off` tool
 * (@helpdesk/gateway-core wires the schema and description every gateway exposes verbatim) and
 * the orchestrator, which creates a handoff directly when triage decides `needs_human`, before
 * any gateway or agent is ever involved. Neither writer should import the other's runtime — the
 * orchestrator has no gateway, by design (SPRINT3.md, 3.1), and a gateway has no reason to know
 * about the orchestrator — so this package exists standalone, the same reasoning that already
 * produced @helpdesk/audit-core when a second real writer needed the same record format and
 * hash chain. See the root README, "Handoff core notes", for the fuller argument and for what
 * this package deliberately does not carry: no credential, no policy, no tool schema, no
 * transport, no database connection management (a caller passes in an already-open connection,
 * the same rule @helpdesk/audit-core and @helpdesk/gateway-core's ApprovalStore both already
 * follow).
 *
 * Deliberately not built on ApprovalStore/ApprovalWorkflow's shape. Approvals have execution
 * semantics a handoff does not: approving calls a gateway's own backend and audits the result;
 * resolving a handoff is a human doing work entirely outside this system, and there is nothing
 * here to execute or describe a failure of. Bending the approval abstraction to also cover that
 * would leave every call site squinting at fields that mean nothing for its own case, which is a
 * worse trade than two thin, honest specializations sharing only what is genuinely identical
 * (evidence-before-state ordering, a required note on the one truly consequential transition).
 *
 * Call order, the same principle as every other write in this project: evidence first, then
 * state. `create()`, `take()` and `resolve()` each append the audit record for what just
 * happened before the corresponding row is written or updated, so a crash between the two still
 * leaves a decision on the record even if the queue table itself never reflects it.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { AuditInput, AuditRecord } from "@helpdesk/audit-core";

export type HandoffStatus = "open" | "taken" | "resolved";

export interface HandoffCreateInput {
  /** Links back to the audit records of the request this handoff came from. */
  requestId: string;
  /** Who asked — the original requester, never the operator. */
  actor: string;
  /** The request exactly as the person typed it (SPRINT4.md, section 3: "the raw request, exactly
   * as the person typed it" is the first thing an opened item shows). */
  requestText: string;
  /** Which process created this: "orchestrator", or a gateway name for one created by its own
   * `hand_off` tool. The same value the audit record's own `agent` field carries. */
  createdBy: string;
  /** A short reason a person should read before working this. Displayed to an operator; nothing
   * in this system acts on it — the same standing as the approval rationale generator's text.
   * Written by a model that called `hand_off`, or a fixed string when the orchestrator creates
   * one directly from a closed-set triage decision (see @helpdesk/gateway-core and the
   * orchestrator's own comments for where each reason string actually comes from). */
  reason: string;
  /** Marks the handoff as one that must not wait its turn: it sorts above every non-urgent item in
   * listOpen()/listActive() whatever its age. Set by the orchestrator for triage's `security`
   * outcome — a phishing report where a password has already been entered should not sit behind a
   * broken dock. Default false. Never set from request text; a closed-set triage decision (or a
   * caller's own code) is the only thing that decides it. */
  urgent?: boolean;
}

export interface HandoffRecord {
  id: string;
  createdAt: string;
  requestId: string;
  actor: string;
  requestText: string;
  createdBy: string;
  reason: string;
  /** See HandoffCreateInput.urgent. Records created before this field existed read as false. */
  urgent: boolean;
  status: HandoffStatus;
  takenBy: string | null;
  takenAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  /** Required to resolve (SPRINT4.md, section 3: "resolve requiring a note"); never required to
   * take — an operator starting work has nothing yet worth writing down. */
  resolutionNote: string | null;
}

export type HandoffErrorCode = "not_found" | "not_open" | "not_taken" | "note_required";

export class HandoffError extends Error {
  override readonly name = "HandoffError";
  constructor(
    readonly code: HandoffErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface HandoffStoreOptions {
  now?: () => Date;
}

export const HANDOFF_SCHEMA = `
CREATE TABLE IF NOT EXISTS handoffs (
  id             TEXT PRIMARY KEY,
  createdAt      TEXT NOT NULL,
  requestId      TEXT NOT NULL,
  actor          TEXT NOT NULL,
  requestText    TEXT NOT NULL,
  createdBy      TEXT NOT NULL,
  reason         TEXT NOT NULL,
  urgent         INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL CHECK (status IN ('open', 'taken', 'resolved')),
  takenBy        TEXT,
  takenAt        TEXT,
  resolvedBy     TEXT,
  resolvedAt     TEXT,
  resolutionNote TEXT
);

CREATE INDEX IF NOT EXISTS handoffs_status ON handoffs (status, createdAt);
`;

interface Row {
  id: string;
  createdAt: string;
  requestId: string;
  actor: string;
  requestText: string;
  createdBy: string;
  reason: string;
  urgent: number;
  status: HandoffStatus;
  takenBy: string | null;
  takenAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

function toRecord(row: Row): HandoffRecord {
  return { ...row, urgent: row.urgent === 1 };
}

/** A caller that only needs to append records — the same narrow shape ApprovalWorkflow's own
 * `audit` dependency uses, so a real AuditLog satisfies it without adapting anything. */
export interface HandoffAudit {
  append(input: AuditInput): AuditRecord;
}

export class HandoffStore {
  private readonly now: () => Date;

  constructor(
    private readonly db: DatabaseSync,
    private readonly audit: HandoffAudit,
    options: HandoffStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    db.exec(HANDOFF_SCHEMA);
    // CREATE TABLE IF NOT EXISTS leaves a table made before `urgent` existed exactly as it was, so
    // a database this project already has (every chain's own, the simulation's) needs the column
    // added in place. Existing rows take the default, false: nothing before this was urgent.
    const columns = db.prepare("PRAGMA table_info(handoffs)").all() as unknown as { name: string }[];
    if (!columns.some((c) => c.name === "urgent")) {
      db.exec("ALTER TABLE handoffs ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0");
    }
  }

  /** Evidence first: the `handoff` audit record commits before the queue row exists at all. */
  create(input: HandoffCreateInput): HandoffRecord {
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    const urgent = input.urgent === true;

    this.audit.append({
      requestId: input.requestId,
      actor: input.actor,
      agent: input.createdBy,
      tool: null,
      decision: "handoff",
      parameters: { requestText: input.requestText, reason: input.reason, urgent },
      rules: [],
      result: { handoffId: id },
    });

    this.db
      .prepare(
        `INSERT INTO handoffs (id, createdAt, requestId, actor, requestText, createdBy, reason, urgent, status, takenBy, takenAt, resolvedBy, resolvedAt, resolutionNote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, NULL, NULL, NULL)`,
      )
      .run(id, createdAt, input.requestId, input.actor, input.requestText, input.createdBy, input.reason, urgent ? 1 : 0);

    const record = this.get(id);
    if (record === null) throw new Error(`handoff ${id} was just created but cannot be read back`);
    return record;
  }

  get(id: string): HandoffRecord | null {
    const row = this.db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id) as unknown as Row | undefined;
    return row ? toRecord(row) : null;
  }

  /** No note required — an operator starting work has nothing yet to say. Refuses anything but
   * open -> taken, the same "decided/moved at most once" discipline ApprovalStore's
   * `recordVerdict` uses, via the same conditional-UPDATE trick. */
  take(id: string, takenBy: string): HandoffRecord {
    const existing = this.get(id);
    if (existing === null) throw new HandoffError("not_found", `handoff ${id} not found`);
    if (existing.status !== "open") throw new HandoffError("not_open", `handoff ${id} is already ${existing.status}`);

    this.audit.append({
      requestId: existing.requestId,
      actor: takenBy,
      agent: "handoff-queue",
      tool: null,
      decision: "handoff_taken",
      parameters: null,
      rules: [],
      result: { handoffId: id },
    });

    const takenAt = this.now().toISOString();
    const { changes } = this.db
      .prepare("UPDATE handoffs SET status = 'taken', takenBy = ?, takenAt = ? WHERE id = ? AND status = 'open'")
      .run(takenBy, takenAt, id);
    if (changes !== 1) throw new HandoffError("not_open", `handoff ${id} is already ${this.get(id)?.status ?? "unknown"}`);

    const record = this.get(id);
    if (record === null) throw new Error(`handoff ${id} vanished after being taken`);
    return record;
  }

  /** Note required (SPRINT4.md, section 3). Refuses anything but taken -> resolved: an open
   * handoff must be taken first, so there is always someone the audit trail names as having done
   * the work before it can be marked done. */
  resolve(id: string, resolvedBy: string, note: string): HandoffRecord {
    const trimmed = note.trim();
    if (trimmed.length === 0) throw new HandoffError("note_required", "a resolution note is required");

    const existing = this.get(id);
    if (existing === null) throw new HandoffError("not_found", `handoff ${id} not found`);
    if (existing.status !== "taken") throw new HandoffError("not_taken", `handoff ${id} is ${existing.status}, not taken`);

    this.audit.append({
      requestId: existing.requestId,
      actor: resolvedBy,
      agent: "handoff-queue",
      tool: null,
      decision: "handoff_resolved",
      parameters: null,
      rules: [],
      result: { handoffId: id, resolutionNote: trimmed },
    });

    const resolvedAt = this.now().toISOString();
    const { changes } = this.db
      .prepare("UPDATE handoffs SET status = 'resolved', resolvedBy = ?, resolvedAt = ?, resolutionNote = ? WHERE id = ? AND status = 'taken'")
      .run(resolvedBy, resolvedAt, trimmed, id);
    if (changes !== 1) throw new HandoffError("not_taken", `handoff ${id} is ${this.get(id)?.status ?? "unknown"}, not taken`);

    const record = this.get(id);
    if (record === null) throw new Error(`handoff ${id} vanished after being resolved`);
    return record;
  }

  /** Urgent first, then oldest first — see HandoffCreateInput.urgent. */
  listOpen(): HandoffRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM handoffs WHERE status = 'open' ORDER BY urgent DESC, createdAt, id")
      .all() as unknown as Row[];
    return rows.map(toRecord);
  }

  /** Open and taken together — everything still on an operator's plate, urgent first and then
   * oldest first, the shape an operator console's own queue listing needs (SPRINT4.md, section 3).
   * Resolved items are history, not queue, so they are deliberately left out here. */
  listActive(): HandoffRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM handoffs WHERE status IN ('open', 'taken') ORDER BY urgent DESC, createdAt, id")
      .all() as unknown as Row[];
    return rows.map(toRecord);
  }

  close(): void {
    this.db.close();
  }
}
