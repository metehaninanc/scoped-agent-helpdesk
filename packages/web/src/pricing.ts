/**
 * Static per-model pricing for the dashboard's cost estimate (SPRINT3.md, 3.5: "Label the totals
 * as estimates, since model pricing changes"). This is config, not telemetry — read at render
 * time, never written to, the same kind of thing as the managed-group allowlist
 * (packages/identity-gateway/src/policy/config.ts): a value someone maintains in a commit, not
 * state the system accumulates.
 *
 * Base input/output rates only (no prompt-cache multiplier): nothing in this codebase sets
 * `cache_control` on any of the three model calls (triage, the four agents, the rationale
 * generator), so base pricing is what actually applies. Source: platform.claude.com/docs/en/
 * about-claude/pricing, "Model pricing" table, read 2026-09-20. Re-check that page before trusting
 * these numbers for anything beyond a rough estimate — pricing changes, which is exactly why
 * SPRINT3.md says to label the total as one.
 *
 * Keyed by the exact model name string a `model_usage` record's `result.model` carries — the
 * three pinned defaults (packages/agent/src/models.ts: DEFAULT_TRIAGE_MODEL, DEFAULT_AGENT_MODEL;
 * packages/identity-gateway/src/approvals/rationale.ts: DEFAULT_RATIONALE_MODEL). The first two
 * are imported from @helpdesk/agent, which already exports them; DEFAULT_RATIONALE_MODEL's value
 * is duplicated here as a literal rather than imported, because identity-gateway's public surface
 * (its own index.ts) deliberately exposes no runtime value to this package beyond
 * CertificateCredential and loadGatewayEnv — a model name string is not worth widening that
 * boundary for. Nothing here can typecheck that literal against the real export, so a drift
 * (identity-gateway changing its default without this file following) is not a compile error —
 * but it is not silent either: dashboard-metrics.ts treats an unrecognised model name the same
 * way regardless of why it is unrecognised, and reports it as unpriced usage by name, which is
 * exactly the visible failure mode this file's own header asks for, not a $0 that hides the gap.
 *
 * Any HELPDESK_TRIAGE_MODEL / HELPDESK_AGENT_MODEL / HELPDESK_RATIONALE_MODEL override that names
 * a model not listed here is exactly the gap this file exists to surface, never to paper over:
 * priceUsage() returns null for an unknown model, and dashboard-metrics.ts reports that usage as
 * unpriced, by model name, rather than silently costing it at zero.
 */
export interface ModelPrice {
  /** USD per 1,000,000 input tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
}

export const PRICING_PER_MILLION_TOKENS: Readonly<Record<string, ModelPrice>> = {
  "claude-haiku-4-5-20251001": { inputPerMillion: 1, outputPerMillion: 5 },
  "claude-sonnet-5": { inputPerMillion: 2, outputPerMillion: 10 },
  "claude-opus-5": { inputPerMillion: 5, outputPerMillion: 25 },
};

/** USD for one usage sample, or null if this model has no price on file. Never rounds — the
 * caller sums first, then formats for display. */
export function priceUsage(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = PRICING_PER_MILLION_TOKENS[model];
  if (!price) return null;
  return (inputTokens / 1_000_000) * price.inputPerMillion + (outputTokens / 1_000_000) * price.outputPerMillion;
}
