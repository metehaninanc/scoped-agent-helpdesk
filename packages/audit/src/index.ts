/**
 * Public surface of @helpdesk/audit-core. The whole package, deliberately: this is the record
 * format and the hash chain, and nothing else. See the root README, "Audit core notes", for
 * what that boundary buys and what it costs.
 */
export { AuditLog, verifyChain, type AuditLogOptions } from "./audit-log.js";
export { GENESIS_HASH, computeHash } from "./hash.js";
export { AUDIT_SCHEMA, ensureAuditSchema } from "./schema.js";
export {
  AUDIT_DECISIONS,
  type AuditDecision,
  type AuditHead,
  type AuditInput,
  type AuditRecord,
  type AuditRow,
  type ChainBreak,
  type ChainBreakReason,
} from "./types.js";
