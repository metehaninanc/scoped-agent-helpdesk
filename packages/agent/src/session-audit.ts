/**
 * The two audit records the identity agent is responsible for. SPRINT1.md, Component 5:
 *
 *   "Every agent session writes a request record at start under its requestId, and a
 *    no_tool_called record if it ends without calling a tool."
 *
 * Why this file exists instead of importing the gateway's AuditLog: SPRINT1.md is explicit
 * that "the agent package must not import anything from the gateway package other than type
 * definitions." The gateway is the only package that holds credentials, and the audit log is
 * gateway machinery; the agent is meant to stay swappable and independently reviewable, even
 * at the cost of a small amount of duplication. That is a real tradeoff, not a free lunch — a
 * shared @helpdesk/audit-core package would remove it, and is worth doing in a later sprint if
 * a second writer of this table ever appears.
 *
 * So this is a second, independent implementation of the append-one-row-with-a-hash-chain
 * logic in packages/gateway/src/audit/{schema,hash,audit-log}.ts — schema, hash algorithm and
 * transaction shape kept identical on purpose, so a chain with records from both writers still
 * validates under the gateway's own verifyChain(). session-audit.test.ts proves that directly.
 *
 * Only `type` imports come from @helpdesk/gateway; everything executable here is local.
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AuditDecision } from "@helpdesk/gateway";

const GENESIS_HASH = "0".repeat(64);

/** Identical to gateway's AUDIT_SCHEMA. Safe to run against a file the gateway already uses:
 * every statement is idempotent (CREATE ... IF NOT EXISTS, or a trigger that is dropped and
 * recreated) so it never conflicts with the schema the gateway itself ensures. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT    NOT NULL,
  requestId   TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  agent       TEXT    NOT NULL,
  tool        TEXT,
  parameters  TEXT    NOT NULL,
  decision    TEXT    NOT NULL,
  rules       TEXT    NOT NULL,
  result      TEXT,
  prevHash    TEXT    NOT NULL,
  hash        TEXT    NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS audit_requestId ON audit (requestId);
CREATE TABLE IF NOT EXISTS audit_head (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  lastId      INTEGER NOT NULL,
  lastHash    TEXT    NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT, 'audit log is append only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
BEGIN SELECT RAISE(ABORT, 'audit log is append only'); END;
`;

interface Row {
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
}

/** Byte-identical to gateway's computeHash(): same columns, same order, same JSON encoding. */
function computeHash(row: Row): string {
  const canonical = JSON.stringify([
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
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface SessionAuditInput {
  requestId: string;
  actor: string;
  agent: string;
  decision: "request" | "no_tool_called";
  /** The request text on a `request` record; the agent's final reply on `no_tool_called`. */
  content: unknown;
}

export class SessionAudit {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(SCHEMA);
  }

  /** Append one record. Synchronous and transactional, same guarantee as the gateway's. */
  append(input: SessionAuditInput): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const tail = this.db.prepare("SELECT id, hash FROM audit ORDER BY id DESC LIMIT 1").get() as
        | { id: number; hash: string }
        | undefined;
      const sequence = this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'audit'").get() as
        | { seq: number }
        | undefined;

      const row: Row = {
        id: Math.max(tail?.id ?? 0, sequence?.seq ?? 0) + 1,
        timestamp: new Date().toISOString(),
        requestId: input.requestId,
        actor: input.actor,
        agent: input.agent,
        tool: null,
        parameters: JSON.stringify(input.decision === "request" ? input.content : null),
        decision: input.decision,
        rules: "[]",
        result: input.decision === "no_tool_called" ? JSON.stringify(input.content) : null,
        prevHash: tail?.hash ?? GENESIS_HASH,
      };
      const hash = computeHash(row);

      this.db
        .prepare(
          `INSERT INTO audit (id, timestamp, requestId, actor, agent, tool, parameters, decision, rules, result, prevHash, hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(row.id, row.timestamp, row.requestId, row.actor, row.agent, row.tool, row.parameters, row.decision, row.rules, row.result, row.prevHash, hash);
      this.db
        .prepare(
          `INSERT INTO audit_head (id, lastId, lastHash) VALUES (1, ?, ?)
           ON CONFLICT (id) DO UPDATE SET lastId = excluded.lastId, lastHash = excluded.lastHash`,
        )
        .run(row.id, hash);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
