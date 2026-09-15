/**
 * Append-only audit log with a sha256 hash chain. See SPRINT1.md, "Component 3: audit log".
 *
 * append() is synchronous and transactional: when it returns, the record is committed. The
 * gateway relies on that ordering (audit record first, then act), so do not make it async.
 */
import type { DatabaseSync } from "node:sqlite";

import { openDatabase } from "../db.js";
import { GENESIS_HASH, computeHash } from "./hash.js";
import { ensureAuditSchema } from "./schema.js";
import type { AuditHead, AuditInput, AuditRecord, AuditRow, ChainBreak } from "./types.js";

export interface AuditLogOptions {
  /** Clock, injectable for tests. Defaults to the system clock. */
  now?: () => Date;
}

const SELECT_ROWS = "SELECT * FROM audit";

const INSERT_ROW = `
INSERT INTO audit (id, timestamp, requestId, actor, agent, tool, parameters, decision, rules, result, prevHash, hash)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPSERT_HEAD = `
INSERT INTO audit_head (id, lastId, lastHash) VALUES (1, ?, ?)
ON CONFLICT (id) DO UPDATE SET lastId = excluded.lastId, lastHash = excluded.lastHash`;

function readHead(db: DatabaseSync): AuditHead | null {
  const row = db.prepare("SELECT lastId, lastHash FROM audit_head WHERE id = 1").get() as
    | { lastId: number; lastHash: string }
    | undefined;
  return row ? { lastId: row.lastId, lastHash: row.lastHash } : null;
}

function toRecord(row: AuditRow): AuditRecord {
  return {
    ...row,
    parameters: JSON.parse(row.parameters) as unknown,
    rules: JSON.parse(row.rules) as string[],
    result: row.result === null ? null : (JSON.parse(row.result) as unknown),
  };
}

export class AuditLog {
  readonly db: DatabaseSync;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, options: AuditLogOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => new Date());
    ensureAuditSchema(db);
  }

  static open(path: string, options: AuditLogOptions = {}): AuditLog {
    return new AuditLog(openDatabase(path), options);
  }

  /** Commit one record. Returns it as stored, hash included. */
  append(input: AuditInput): AuditRecord {
    const timestamp = this.now().toISOString();

    // BEGIN IMMEDIATE takes the write lock up front, so "read the tail, then insert after it"
    // cannot interleave with another writer and fork the chain.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const tail = this.db.prepare("SELECT id, hash FROM audit ORDER BY id DESC LIMIT 1").get() as
        | { id: number; hash: string }
        | undefined;
      // sqlite_sequence remembers the highest id ever issued, even after deletions, which is
      // what makes a deleted tail visible as a gap once anything is appended after it.
      const sequence = this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'audit'").get() as
        | { seq: number }
        | undefined;

      const row: Omit<AuditRow, "hash"> = {
        id: Math.max(tail?.id ?? 0, sequence?.seq ?? 0) + 1,
        timestamp,
        requestId: input.requestId,
        actor: input.actor,
        agent: input.agent,
        tool: input.tool ?? null,
        parameters: JSON.stringify(input.parameters ?? null),
        decision: input.decision,
        rules: JSON.stringify(input.rules ?? []),
        result: input.result === undefined || input.result === null ? null : JSON.stringify(input.result),
        prevHash: tail?.hash ?? GENESIS_HASH,
      };
      const hash = computeHash(row);

      this.db
        .prepare(INSERT_ROW)
        .run(
          row.id,
          row.timestamp,
          row.requestId,
          row.actor,
          row.agent,
          row.tool,
          row.parameters,
          row.decision,
          row.rules,
          row.result,
          row.prevHash,
          hash,
        );
      this.db.prepare(UPSERT_HEAD).run(row.id, hash);
      this.db.exec("COMMIT");
      return toRecord({ ...row, hash });
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Every record, oldest first. */
  list(): AuditRecord[] {
    return this.rows().map(toRecord);
  }

  /** Every record from one user request, oldest first. */
  byRequest(requestId: string): AuditRecord[] {
    const rows = this.db
      .prepare(`${SELECT_ROWS} WHERE requestId = ? ORDER BY id`)
      .all(requestId) as unknown as AuditRow[];
    return rows.map(toRecord);
  }

  /** Every record exactly as stored, oldest first. This is what the chain is computed over. */
  rows(): AuditRow[] {
    return this.db.prepare(`${SELECT_ROWS} ORDER BY id`).all() as unknown as AuditRow[];
  }

  /** The head marker, or null if nothing has ever been appended. */
  head(): AuditHead | null {
    return readHead(this.db);
  }

  verifyChain(): ChainBreak | null {
    return verifyChain(this.db);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Walk the whole log and return the first record that breaks the chain, or null if it is
 * intact. Checks, per record and in this order: its own hash, its link to the predecessor,
 * and that no id was skipped. Then compares the tail against the head marker.
 *
 * Detects any modification and any deletion, including of the tail, as long as the head
 * marker was not rewritten to match. Against an attacker who rewrites the marker too, only
 * an external anchor helps, and that is deliberately not Sprint 1.
 */
export function verifyChain(db: DatabaseSync): ChainBreak | null {
  const rows = db.prepare(`${SELECT_ROWS} ORDER BY id`).all() as unknown as AuditRow[];

  let expectedPrevHash = GENESIS_HASH;
  let expectedId = 1;

  for (const [index, row] of rows.entries()) {
    const { hash, ...rest } = row;
    if (computeHash(rest) !== hash) return { index, id: row.id, reason: "hash_mismatch" };
    if (row.prevHash !== expectedPrevHash) return { index, id: row.id, reason: "prev_hash_mismatch" };
    if (row.id !== expectedId) return { index, id: row.id, reason: "id_gap" };

    expectedPrevHash = hash;
    expectedId = row.id + 1;
  }

  const head = readHead(db);
  const tail = rows.at(-1);

  if (tail === undefined) {
    return head === null ? null : { index: 0, id: head.lastId, reason: "tail_truncated" };
  }
  if (head === null || head.lastId <= tail.id) {
    // Marker missing, or it names the current tail (or earlier) but with a different hash.
    if (head !== null && head.lastId === tail.id && head.lastHash === tail.hash) return null;
    return { index: rows.length - 1, id: tail.id, reason: "tail_truncated" };
  }
  // Marker is ahead of the tail: records were removed from the end.
  return { index: rows.length, id: head.lastId, reason: "tail_truncated" };
}
