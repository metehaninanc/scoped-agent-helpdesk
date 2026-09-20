/**
 * Sprint 2 MDM policy configuration. Deliberately empty: SPRINT2.md, Component 1 gives this
 * gateway two read tools, no write actions, and no device allowlist. Kept as a real module
 * rather than skipped so the two gateways' import shape stays parallel, and so a future device
 * rule has an obvious, already-reviewed place to land instead of a new file appearing with it.
 */
import type { PolicyConfig } from "./types.js";

export const policyConfig: PolicyConfig = {};
