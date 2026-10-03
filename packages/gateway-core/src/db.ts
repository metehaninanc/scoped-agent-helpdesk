/**
 * One SQLite connection opener, shared by every gateway (SPRINT3.md, 3.2 — moved here from the
 * identity gateway, which the MDM gateway imported it from before this phase; see log.ts's
 * header comment for why that asymmetry is exactly what this package exists to remove).
 * Approvals and audit records share a file where a gateway has approvals at all (SPRINT1.md:
 * "SQLite. Approvals and audit records both live there").
 *
 * node:sqlite is synchronous, which is exactly what the audit log needs: the record for a
 * decision is on disk before the handler moves on to act on it.
 *
 * node:sqlite needs Node 22.13 or newer (unflagged in 22.13.0, nodejs/node#55890). The
 * check below turns "ERR_UNKNOWN_BUILTIN_MODULE" on an old VPS into a message that says so.
 */
import { existsSync, mkdirSync } from "node:fs";
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
      `Node ${version} is too old: a gateway needs Node ${MIN_NODE_VERSION} or newer for the built-in node:sqlite module (see README, Prerequisites).`,
    );
  }
}

/**
 * `create` defaults to false: a path that does not exist yet is refused loudly rather than handed
 * back as a new, empty chain. `new DatabaseSync(path)` on its own cannot tell a real chain from a
 * typo'd path — both look like "file not found" — so the check has to happen here, before that
 * call, where the difference between "start a chain" and "open one" is still known. Pass
 * `{ create: true }` only at the one place that legitimately starts a new chain (a gateway's own
 * `bin/gateway.ts`, or the orchestrator chain's own writer, which has no dedicated gateway of its
 * own) — every reader (the dashboard, `verify-audit`, the simulation tools) leaves it unset, so a
 * wrong path fails the same way a wrong path anywhere else in this project does.
 */
export function openDatabase(path: string, options: { create?: boolean } = {}): DatabaseSync {
  assertNodeSupportsSqlite();
  const create = options.create ?? false;
  if (path !== IN_MEMORY) {
    const exists = existsSync(path);
    if (!exists && !create) {
      throw new Error(
        `No audit database at ${path}. openDatabase() does not create one unless { create: true } ` +
          "is passed explicitly — check the path for a typo before assuming this chain doesn't exist yet.",
      );
    }
    if (!exists) mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  // WAL keeps readers (the web app) from blocking the writer (the gateway). Harmless in memory.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // Wait for a concurrent writer rather than failing immediately with SQLITE_BUSY.
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export type { DatabaseSync };
