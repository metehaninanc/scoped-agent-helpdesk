/**
 * This gateway's own logger. SPRINT3.md, 3.2: the stderr-only mechanics moved to
 * @helpdesk/gateway-core; this is just this gateway's own prefix. Before this phase this file
 * was a deliberate fourteen-line duplicate of the identity gateway's, to avoid one gateway
 * importing something as trivial as logging from the other's internals; now that a neutral core
 * package holds the mechanics, that asymmetry is gone and only the prefix is left to supply.
 */
import { createLogger } from "@helpdesk/gateway-core";

export const log = createLogger("mdm-gateway");
