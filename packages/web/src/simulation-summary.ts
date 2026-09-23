/**
 * Summarizing a completed (or partially completed) simulation run, from the per-ticket results
 * bin/simulate.ts already wrote — no re-reading of the ticket files, and definitely no reading of
 * actualNeed, which never reached a TicketResult in the first place (simulation-tickets.ts).
 *
 * Token usage and cost per component are not computed here: they are read straight from the five
 * sim audit chains via `computeDashboardData()` (dashboard-metrics.ts), the same function the
 * live dashboard uses, rather than re-implemented against the JSONL results — the chains are the
 * source of truth for anything token/cost shaped, exactly as SPRINT3.md 3.5 already argued.
 */
import type { CostSection } from "./dashboard-metrics.js";
import type { SimCategory, TicketResult } from "./simulation-types.js";

export interface RuleFrequency {
  rule: string;
  count: number;
}

export interface SimulationSummary {
  totalTickets: number;
  categoryDistribution: { category: SimCategory; count: number }[];
  /** A routed ticket (identity/mdm/knowledge/endpoint) whose agent called a tool. */
  reachedToolCount: number;
  /** A routed ticket whose agent called no tool at all — no policy decision was ever made. */
  modelDeclinedCount: number;
  /** Subset of modelDeclinedCount whose reply looks like it is asking the requester something —
   * see CLARIFYING_QUESTION_HEURISTIC_NOTE for exactly what "looks like" means and why it is
   * only ever labelled as an estimate. */
  clarifyingQuestionCount: number;
  /** A routed ticket whose last tool call was denied by a named policy rule. */
  refusedCount: number;
  refusedByRule: RuleFrequency[];
  errorCount: number;
}

/**
 * The same kind of labelled, regex-shaped approximation as PASSWORD_RESET_REQUEST_PATTERN
 * (dashboard-metrics.ts): a no-tool-called reply is counted as a clarifying question when it
 * contains a "?" character, nothing more sophisticated. This will occasionally miscount a
 * question phrased without one, or count a rhetorical "?" that was not actually asking the
 * requester anything — the raw modelDeclinedCount is reported alongside it for exactly that
 * reason, so a reader can see the heuristic's own ceiling.
 */
export const CLARIFYING_QUESTION_HEURISTIC_NOTE =
  'A no-tool-called reply counts as a clarifying question when it contains "?" — a heuristic over ' +
  "free text, not a classification the system itself makes.";

const ROUTED_CATEGORIES: ReadonlySet<SimCategory> = new Set(["identity", "mdm", "knowledge", "endpoint"]);

export function computeSimulationSummary(results: readonly TicketResult[]): SimulationSummary {
  const categoryCounts = new Map<SimCategory, number>();
  const refusedRuleCounts = new Map<string, number>();
  let reachedToolCount = 0;
  let modelDeclinedCount = 0;
  let clarifyingQuestionCount = 0;
  let refusedCount = 0;
  let errorCount = 0;

  for (const result of results) {
    categoryCounts.set(result.category, (categoryCounts.get(result.category) ?? 0) + 1);
    if (result.category === "error") errorCount++;
    if (!ROUTED_CATEGORIES.has(result.category)) continue;

    if (result.toolCalled) {
      reachedToolCount++;
    } else {
      modelDeclinedCount++;
      if (result.reply.includes("?")) clarifyingQuestionCount++;
    }

    if (result.policyDecision === "denied") {
      refusedCount++;
      for (const rule of result.policyRules) refusedRuleCounts.set(rule, (refusedRuleCounts.get(rule) ?? 0) + 1);
    }
  }

  return {
    totalTickets: results.length,
    categoryDistribution: [...categoryCounts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    reachedToolCount,
    modelDeclinedCount,
    clarifyingQuestionCount,
    refusedCount,
    refusedByRule: [...refusedRuleCounts.entries()].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count),
    errorCount,
  };
}

function usd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

export function renderSimulationSummaryMarkdown(summary: SimulationSummary, cost: CostSection): string {
  const categoryRows = summary.categoryDistribution.map((c) => `| ${c.category} | ${c.count} |`).join("\n");
  const ruleRows =
    summary.refusedByRule.length > 0
      ? summary.refusedByRule.map((r) => `| ${r.rule} | ${r.count} |`).join("\n")
      : "| _(none)_ | 0 |";
  const costRows = cost.components.map((c) => `| ${c.component} | ${c.inputTokens.toLocaleString()} | ${c.outputTokens.toLocaleString()} | ${usd(c.costUsd)} |`).join("\n");

  return `# Simulation summary

${summary.totalTickets} ticket(s) processed. Read from \`evidence/simulation-results.jsonl\`; token
usage and cost read live from the five \`sim-*.db\` chains via the same \`computeDashboardData()\`
the live dashboard uses.

## Category distribution

| Category | Count |
|---|---|
${categoryRows}

## Outcomes

| Outcome | Count |
|---|---|
| Reached a tool | ${summary.reachedToolCount} |
| Model declined (no tool called) | ${summary.modelDeclinedCount} |
| ...of which, looks like a clarifying question | ${summary.clarifyingQuestionCount} |
| Refused by a named policy rule | ${summary.refusedCount} |
| Runner error (not a system outcome) | ${summary.errorCount} |

${CLARIFYING_QUESTION_HEURISTIC_NOTE}

## Refused, by rule

| Rule | Count |
|---|---|
${ruleRows}

## Cost, by component

| Component | Input tokens | Output tokens | Cost (priced usage) |
|---|---|---|---|
${costRows}

Total priced cost: ${usd(cost.totalCostUsd)} across ${cost.totalRequests} orchestrator request(s)
(${cost.averageCostPerRequestUsd === null ? "—" : usd(cost.averageCostPerRequestUsd)} average per request).
`;
}
