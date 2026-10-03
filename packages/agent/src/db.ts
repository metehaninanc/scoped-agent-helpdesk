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
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * `create` defaults to false: a path that does not exist yet is refused loudly rather than handed
 * back as a new, empty chain — see @helpdesk/gateway-core's own db.ts for the full reasoning, kept
 * in sync here by hand the same way the rest of this file already is. `OrchestratorAudit` is the
 * one place in this package that legitimately passes `{ create: true }`, since the orchestrator
 * chain has no dedicated gateway process of its own to create it first.
 */
export function openDatabase(path: string, options: { create?: boolean } = {}): DatabaseSync {
  const create = options.create ?? false;
  if (path !== ":memory:") {
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
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
