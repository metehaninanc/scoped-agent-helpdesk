/**
 * Open the sqlite file the agent writes its own audit records into — the same file, and the
 * same table, the gateway subprocess for this session uses (see identity-agent.ts).
 *
 * @helpdesk/audit-core deliberately does not open databases for you (see its README): that
 * is a caller concern. This is this package's version of it, independent of the gateway's own
 * db.ts, matching SPRINT1.md's rule that the agent package imports no gateway runtime code.
 * It is a handful of lines with no identity, policy or credential content of its own, so the
 * duplication costs little — unlike the record format and hash chain, which is why *those*
 * moved to a shared package and this did not.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
