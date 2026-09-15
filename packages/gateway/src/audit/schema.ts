import type { DatabaseSync } from "node:sqlite";

import { AUDIT_DECISIONS } from "./types.js";

const decisionList = AUDIT_DECISIONS.map((d) => `'${d}'`).join(", ");

/**
 * Append only, enforced twice: the triggers stop an honest bug from ever issuing UPDATE or
 * DELETE through the application, and the hash chain catches anyone who drops the triggers.
 *
 * AUTOINCREMENT matters: SQLite then never reuses an id, so deleting the tail and appending
 * again leaves a visible gap instead of a seamless replacement.
 */
export const AUDIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT    NOT NULL,
  requestId   TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  agent       TEXT    NOT NULL,
  tool        TEXT,
  parameters  TEXT    NOT NULL,
  decision    TEXT    NOT NULL CHECK (decision IN (${decisionList})),
  rules       TEXT    NOT NULL,
  result      TEXT,
  prevHash    TEXT    NOT NULL,
  hash        TEXT    NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS audit_requestId ON audit (requestId);

-- Head marker: the id and hash of the last record, kept outside the audit table and updated
-- in the same transaction as every append. verifyChain() compares the chain tail against it,
-- so deleting the tail (which the chain alone cannot see) becomes visible. This raises the
-- bar; an attacker who rewrites the marker too is not caught. External anchoring is the fix.
CREATE TABLE IF NOT EXISTS audit_head (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  lastId      INTEGER NOT NULL,
  lastHash    TEXT    NOT NULL
);

CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
BEGIN
  SELECT RAISE(ABORT, 'audit log is append only');
END;

CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
BEGIN
  SELECT RAISE(ABORT, 'audit log is append only');
END;
`;

export function ensureAuditSchema(db: DatabaseSync): void {
  db.exec(AUDIT_SCHEMA);
}
