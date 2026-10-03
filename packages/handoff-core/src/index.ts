/**
 * Public surface of @helpdesk/handoff-core. The generic handoff queue-item lifecycle, and
 * nothing else: no credential, no policy, no tool schema, no transport, no database connection
 * management. See the root README, "Handoff core notes".
 */
export {
  HandoffError,
  HandoffStore,
  HANDOFF_SCHEMA,
  type HandoffAudit,
  type HandoffCreateInput,
  type HandoffErrorCode,
  type HandoffRecord,
  type HandoffStatus,
  type HandoffStoreOptions,
} from "./store.js";
