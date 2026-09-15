/**
 * One SQLite connection opener for the gateway. Approvals and audit records share a file
 * (SPRINT1.md: "SQLite. Approvals and audit records both live there").
 *
 * node:sqlite is synchronous, which is exactly what the audit log needs: the record for a
 * decision is on disk before the handler moves on to act on it.
 *
 * node:sqlite needs Node 22.13 or newer (unflagged in 22.13.0, nodejs/node#55890). The
 * check below turns "ERR_UNKNOWN_BUILTIN_MODULE" on an old VPS into a message that says so.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const IN_MEMORY = ":memory:";

/** Lowest Node version on which `node:sqlite` loads without a flag. */
export const MIN_NODE_VERSION = "22.13.0";

export function assertNodeSupportsSqlite(version: string = process.versions.node): void {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  const [needMajor = 0, needMinor = 0] = MIN_NODE_VERSION.split(".").map(Number);
  const ok = major > needMajor || (major === needMajor && minor >= needMinor);
  if (!ok) {
    throw new Error(
      `Node ${version} is too old: the gateway needs Node ${MIN_NODE_VERSION} or newer for the built-in node:sqlite module (see README, Prerequisites).`,
    );
  }
}

export function openDatabase(path: string): DatabaseSync {
  assertNodeSupportsSqlite();
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
