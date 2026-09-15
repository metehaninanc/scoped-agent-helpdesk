/**
 * One SQLite connection opener for the gateway. Approvals and audit records share a file
 * (SPRINT1.md: "SQLite. Approvals and audit records both live there").
 *
 * node:sqlite is synchronous, which is exactly what the audit log needs: the record for a
 * decision is on disk before the handler moves on to act on it.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const IN_MEMORY = ":memory:";

export function openDatabase(path: string): DatabaseSync {
  if (path !== IN_MEMORY) mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  // WAL keeps readers (the web app) from blocking the writer (the gateway). Harmless in memory.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // Wait for a concurrent writer rather than failing immediately with SQLITE_BUSY.
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export type { DatabaseSync };
