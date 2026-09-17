/**
 * Walk the audit log and report whether the hash chain is intact.
 *
 *   pnpm verify-audit [path/to/helpdesk.db]
 *
 * Exit code 0 when intact, 1 when broken, 2 when the file does not exist.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { AuditLog } from "@helpdesk/audit-core";

import { openDatabase } from "../db.js";

const path = resolve(process.argv[2] ?? "data/helpdesk.db");

if (!existsSync(path)) {
  console.error(`No audit database at ${path}`);
  process.exit(2);
}

const log = new AuditLog(openDatabase(path));
const records = log.list();
const outcome = log.verifyChain();
log.close();

for (const r of records) {
  const tool = r.tool ?? "-";
  const rules = r.rules.length > 0 ? ` [${r.rules.join(", ")}]` : "";
  const result = r.result === null ? "" : " => result";
  const marker = outcome && r.id === outcome.id ? "  <-- " + outcome.reason : "";
  console.log(
    `${String(r.id).padStart(4)}  ${r.timestamp}  ${r.requestId}  ${r.actor}  ${r.decision.padEnd(14)} ${tool}${rules}${result}${marker}`,
  );
}

console.log("");
if (outcome === null) {
  console.log(`Chain intact: ${records.length} record(s), ${path}`);
  process.exit(0);
}

console.log(`CHAIN BROKEN at record id ${outcome.id} (index ${outcome.index}): ${outcome.reason}`);
process.exit(1);
