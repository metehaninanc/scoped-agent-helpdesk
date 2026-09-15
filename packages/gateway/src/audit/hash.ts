/**
 * The hash chain. "Two lines of code" that turn a table into evidence.
 *
 * Each record's hash covers every stored column, including its id and the previous record's
 * hash. Change any byte of any record and its hash no longer matches; remove a record and its
 * successor's prevHash points at nothing. The JSON columns are hashed as the exact strings
 * SQLite stores, so verification does not depend on serialisation being canonical.
 */
import { createHash } from "node:crypto";

import type { AuditRow } from "./types.js";

/** prevHash of the first record. */
export const GENESIS_HASH = "0".repeat(64);

export function computeHash(row: Omit<AuditRow, "hash">): string {
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
