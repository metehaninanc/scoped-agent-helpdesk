/**
 * This gateway's own logger. Same convention as the other two gateways' log.ts: the stderr-only
 * mechanics live in @helpdesk/gateway-core, this file supplies only the prefix.
 */
import { createLogger } from "@helpdesk/gateway-core";

export const log = createLogger("knowledge-gateway");
