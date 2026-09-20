/**
 * SPRINT3.md, 3.4 policy configuration. Deliberately empty: nothing here needs to be
 * tenant-specific — the deny rule that matters most (password reset) reads only the tool name,
 * and the stub endpoint service has no allowlist to configure. Kept as a real module rather than
 * skipped so this gateway's import shape stays parallel with the others, and so a future rule
 * (say, an endpoint allowlist) has an obvious, already-reviewed place to land.
 */
import type { PolicyConfig } from "./types.js";

export const policyConfig: PolicyConfig = {};
