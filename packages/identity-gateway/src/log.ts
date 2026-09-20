/**
 * This gateway's own logger. SPRINT3.md, 3.2: the stderr-only mechanics moved to
 * @helpdesk/gateway-core; this is just this gateway's own prefix, so a refusal or an
 * unavailable-gateway error still logs as `[gateway]`, not a generic core label.
 */
import { createLogger } from "@helpdesk/gateway-core";

export const log = createLogger("gateway");
