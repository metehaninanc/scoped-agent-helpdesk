/**
 * Approval records. See SPRINT1.md, "Component 4: approval store and rationale".
 *
 * Plain persistence. The rules of the approval flow (a required note, requester may not
 * approve their own request, audit before action) live in workflow.ts; this file only makes
 * sure a record is decided at most once.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalCreateInput {
  /** Links back to the audit records of the request that needs approval. */
  requestId: string;
  /** Who asked. */
  actor: string;
  tool: string;
  params: unknown;
  /** Why it needs approval: the rules that fired. */
  rules: readonly string[];
  /** Generated supporting text. Stored verbatim; never a decision. */
  rationale?: string | null;
}

export interface ApprovalRecord {
  id: string;
  createdAt: string;
  requestId: string;
  actor: string;
  tool: string;
  params: unknown;
  rules: string[];
  rationale: string | null;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface ApprovalStoreOptions {
  now?: () => Date;
}

export interface ApprovalVerdict {
  status: "approved" | "rejected";
  decidedBy: string;
  decisionNote: string;
}

export const APPROVALS_SCHEMA = `
CREATE TABLE IF NOT EXISTS approvals (
  id            TEXT PRIMARY KEY,
  createdAt     TEXT NOT NULL,
  requestId     TEXT NOT NULL,
  actor         TEXT NOT NULL,
  tool          TEXT NOT NULL,
  params        TEXT NOT NULL,
  rules         TEXT NOT NULL,
  rationale     TEXT,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  decidedBy     TEXT,
  decidedAt     TEXT,
  decisionNote  TEXT
);

CREATE INDEX IF NOT EXISTS approvals_status ON approvals (status, createdAt);
`;

interface Row {
  id: string;
  createdAt: string;
  requestId: string;
  actor: string;
  tool: string;
  params: string;
  rules: string;
  rationale: string | null;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

const toRecord = (row: Row): ApprovalRecord => ({
  ...row,
  params: JSON.parse(row.params) as unknown,
  rules: JSON.parse(row.rules) as string[],
});

export class ApprovalStore {
  readonly db: DatabaseSync;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, options: ApprovalStoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => new Date());
    db.exec(APPROVALS_SCHEMA);
  }

  create(input: ApprovalCreateInput): ApprovalRecord {
    const record: ApprovalRecord = {
      id: randomUUID(),
      createdAt: this.now().toISOString(),
      requestId: input.requestId,
      actor: input.actor,
      tool: input.tool,
      params: input.params,
      rules: [...input.rules],
      rationale: input.rationale ?? null,
      status: "pending",
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
    };
    this.db
      .prepare(
        `INSERT INTO approvals (id, createdAt, requestId, actor, tool, params, rules, rationale, status, decidedBy, decidedAt, decisionNote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      )
      .run(
        record.id,
        record.createdAt,
        record.requestId,
        record.actor,
        record.tool,
        JSON.stringify(record.params ?? null),
        JSON.stringify(record.rules),
        record.rationale,
        record.status,
      );
    return record;
  }

  get(id: string): ApprovalRecord | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as unknown as Row | undefined;
    return row ? toRecord(row) : null;
  }

  /** Attach the generated rationale, verbatim. Supporting information only. */
  setRationale(id: string, rationale: string): void {
    const { changes } = this.db.prepare("UPDATE approvals SET rationale = ? WHERE id = ?").run(rationale, id);
    if (changes !== 1) throw new Error(`approval ${id} not found`);
  }

  /**
   * Persist a human verdict. The WHERE clause is what makes "decided at most once" hold even
   * if two approvers act at the same instant: only one UPDATE can see status = 'pending'.
   */
  recordVerdict(id: string, verdict: ApprovalVerdict): ApprovalRecord {
    const { changes } = this.db
      .prepare(
        "UPDATE approvals SET status = ?, decidedBy = ?, decidedAt = ?, decisionNote = ? WHERE id = ? AND status = 'pending'",
      )
      .run(verdict.status, verdict.decidedBy, this.now().toISOString(), verdict.decisionNote, id);
    if (changes !== 1) throw new Error(`approval ${id} is not pending`);
    const record = this.get(id);
    if (record === null) throw new Error(`approval ${id} not found`);
    return record;
  }

  listPending(): ApprovalRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY createdAt, id")
      .all() as unknown as Row[];
    return rows.map(toRecord);
  }

  close(): void {
    this.db.close();
  }
}
