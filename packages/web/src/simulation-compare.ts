/**
 * Comparing two simulation passes run against the same 150 tickets and the same actor mapping
 * (bin/simulate.ts's --tag) — the measurement the fixes between them exist to produce. Every
 * number here is derived from the two runs' own recorded TicketResults and, for cost, the two
 * runs' own five sim chains — nothing recomputed differently between the passes, so a difference
 * in the numbers is a difference between the runs, not between two ways of counting the same run.
 */
import type { CostSection } from "./dashboard-metrics.js";
import type { SimCategory, TicketResult } from "./simulation-types.js";

export interface ComparisonRow {
  label: string;
  pass1: number;
  pass2: number;
  delta: number;
}

function row(label: string, pass1: number, pass2: number): ComparisonRow {
  return { label, pass1, pass2, delta: pass2 - pass1 };
}

/**
 * The hostnames the endpoint stub service actually seeds (packages/endpoint-gateway/src/stub/
 * endpoint-service.ts) — matched against reply text as the "still names a stub device" signal
 * fix 2 was meant to reduce. Note on the baseline: fix 2's own commit reported "list_endpoints
 * called 30 times" in pass one — the number of *calls*, not of replies naming a device. Counting
 * replies (the metric this comparison actually asks for) gives 28 for pass one, not 30; both are
 * real, correct numbers, they just measure two different things, and this file measures the one
 * the reader is looking at right now.
 */
export const STUB_DEVICE_HOSTNAMES = ["front-desk-01", "warehouse-printer-02", "conf-room-b-03"] as const;

const ROUTED_CATEGORIES: ReadonlySet<SimCategory> = new Set(["identity", "mdm", "knowledge", "endpoint"]);

export interface HeadlineNumbers {
  /** Identity-category tickets whose turn reached add_user_to_group (any policy decision —
   * reaching the tool at all is the point, not whether it was then approved or denied). */
  identityReachedAddUserToGroup: number;
  /** Endpoint-category tickets whose reply text names at least one managed hostname. */
  endpointNamedStubDevice: number;
}

export function computeHeadlineNumbers(results: readonly TicketResult[]): HeadlineNumbers {
  let identityReachedAddUserToGroup = 0;
  let endpointNamedStubDevice = 0;

  for (const r of results) {
    if (r.category === "identity" && r.toolCalls.some((t) => t.tool === "add_user_to_group")) {
      identityReachedAddUserToGroup++;
    }
    if (r.category === "endpoint" && STUB_DEVICE_HOSTNAMES.some((h) => r.reply.includes(h))) {
      endpointNamedStubDevice++;
    }
  }

  return { identityReachedAddUserToGroup, endpointNamedStubDevice };
}

function tally<T extends string>(results: readonly TicketResult[], key: (r: TicketResult) => T | null): Map<T, number> {
  const counts = new Map<T, number>();
  for (const r of results) {
    const k = key(r);
    if (k === null) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function buildCategoryComparison(pass1: readonly TicketResult[], pass2: readonly TicketResult[]): ComparisonRow[] {
  const c1 = tally(pass1, (r) => r.category);
  const c2 = tally(pass2, (r) => r.category);
  const categories = new Set([...c1.keys(), ...c2.keys()]);
  return [...categories].sort().map((category) => row(category, c1.get(category) ?? 0, c2.get(category) ?? 0));
}

export interface RuleComparisonRow {
  rule: string;
  pass1: number;
  pass2: number;
  delta: number;
}

export interface OutcomeComparison {
  reachedTool: ComparisonRow;
  modelDeclined: ComparisonRow;
  refused: ComparisonRow;
  refusedByRule: RuleComparisonRow[];
}

function outcomeCounts(results: readonly TicketResult[]): { reachedTool: number; modelDeclined: number; refused: number; byRule: Map<string, number> } {
  let reachedTool = 0;
  let modelDeclined = 0;
  let refused = 0;
  const byRule = new Map<string, number>();
  for (const r of results) {
    if (!ROUTED_CATEGORIES.has(r.category)) continue;
    if (r.toolCalled) reachedTool++;
    else modelDeclined++;
    if (r.policyDecision === "denied") {
      refused++;
      for (const rule of r.policyRules) byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
    }
  }
  return { reachedTool, modelDeclined, refused, byRule };
}

export function buildOutcomeComparison(pass1: readonly TicketResult[], pass2: readonly TicketResult[]): OutcomeComparison {
  const o1 = outcomeCounts(pass1);
  const o2 = outcomeCounts(pass2);
  const rules = new Set([...o1.byRule.keys(), ...o2.byRule.keys()]);
  return {
    reachedTool: row("Reached a tool", o1.reachedTool, o2.reachedTool),
    modelDeclined: row("Model declined", o1.modelDeclined, o2.modelDeclined),
    refused: row("Refused by rule", o1.refused, o2.refused),
    refusedByRule: [...rules]
      .sort()
      .map((rule) => ({ rule, pass1: o1.byRule.get(rule) ?? 0, pass2: o2.byRule.get(rule) ?? 0, delta: (o2.byRule.get(rule) ?? 0) - (o1.byRule.get(rule) ?? 0) })),
  };
}

export interface CostComparison {
  totalCostUsd: { pass1: number; pass2: number; delta: number };
  byComponent: { component: string; pass1: number; pass2: number; delta: number }[];
}

export function buildCostComparison(pass1: CostSection, pass2: CostSection): CostComparison {
  const components = new Set([...pass1.components.map((c) => c.component), ...pass2.components.map((c) => c.component)]);
  const costOf = (section: CostSection, component: string): number => section.components.find((c) => c.component === component)?.costUsd ?? 0;
  return {
    totalCostUsd: { pass1: pass1.totalCostUsd, pass2: pass2.totalCostUsd, delta: pass2.totalCostUsd - pass1.totalCostUsd },
    byComponent: [...components]
      .sort()
      .map((component) => ({ component, pass1: costOf(pass1, component), pass2: costOf(pass2, component), delta: costOf(pass2, component) - costOf(pass1, component) })),
  };
}

// ---------------------------------------------------------------------------

interface OutcomeSignature {
  category: SimCategory;
  toolCalled: boolean;
  toolName: string | null;
  policyDecision: string | null;
}

function signatureOf(r: TicketResult): OutcomeSignature {
  return { category: r.category, toolCalled: r.toolCalled, toolName: r.toolName, policyDecision: r.policyDecision };
}

function sameSignature(a: OutcomeSignature, b: OutcomeSignature): boolean {
  return a.category === b.category && a.toolCalled === b.toolCalled && a.toolName === b.toolName && a.policyDecision === b.policyDecision;
}

export type OutcomeClassification = "improved" | "regressed" | "changed";

/**
 * A deliberately simple, explainable classification — not a claim that every "improved" ticket
 * is now fully resolved, or that every "regressed" one is now broken. It answers one narrower
 * question: did this ticket move toward engagement (a stalled or silently-dropped request now
 * reaching a tool, or a real category) or away from it (the reverse)? Anything that changed
 * without matching either pattern — a different category between two real ones, a different tool
 * or policy decision at the same category/toolCalled state — is reported as "changed" with no
 * direction asserted, since that judgment needs the reply text, not just the four-field signature
 * this function looks at.
 */
export function classifyChange(before: OutcomeSignature, after: OutcomeSignature): OutcomeClassification {
  const wasDropped = before.category === "unsupported" || before.category === "error";
  const isDropped = after.category === "unsupported" || after.category === "error";

  if (before.toolCalled && !after.toolCalled) return "regressed";
  if (!wasDropped && isDropped) return "regressed";
  if (!before.toolCalled && after.toolCalled) return "improved";
  if (wasDropped && !isDropped) return "improved";
  return "changed";
}

export interface TicketOutcomeChange {
  sourceFile: string;
  id: string;
  pass1: OutcomeSignature;
  pass2: OutcomeSignature;
  classification: OutcomeClassification;
}

/** Only tickets present in both passes are compared — a ticket missing from one (an incomplete
 * run) is not silently treated as any particular outcome. */
export function computeOutcomeChanges(pass1: readonly TicketResult[], pass2: readonly TicketResult[]): TicketOutcomeChange[] {
  const key = (r: TicketResult): string => `${r.sourceFile}#${r.id}`;
  const pass2ByKey = new Map(pass2.map((r) => [key(r), r]));

  const changes: TicketOutcomeChange[] = [];
  for (const r1 of pass1) {
    const r2 = pass2ByKey.get(key(r1));
    if (!r2) continue;
    const sig1 = signatureOf(r1);
    const sig2 = signatureOf(r2);
    if (sameSignature(sig1, sig2)) continue;
    changes.push({ sourceFile: r1.sourceFile, id: r1.id, pass1: sig1, pass2: sig2, classification: classifyChange(sig1, sig2) });
  }
  return changes;
}

// ---------------------------------------------------------------------------

function usd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

function fmtDelta(delta: number): string {
  return delta === 0 ? "0" : delta > 0 ? `+${delta}` : `${delta}`;
}

function fmtSignature(sig: OutcomeSignature): string {
  const tool = sig.toolCalled ? (sig.toolName ?? "tool") : "no tool";
  const decision = sig.policyDecision ? `, ${sig.policyDecision}` : "";
  return `${sig.category} / ${tool}${decision}`;
}

export function renderComparisonMarkdown(
  categoryComparison: readonly ComparisonRow[],
  outcomeComparison: OutcomeComparison,
  headline1: HeadlineNumbers,
  headline2: HeadlineNumbers,
  costComparison: CostComparison,
  outcomeChanges: readonly TicketOutcomeChange[],
): string {
  const categoryRows = categoryComparison.map((r) => `| ${r.label} | ${r.pass1} | ${r.pass2} | ${fmtDelta(r.delta)} |`).join("\n");

  const outcomeRows = [outcomeComparison.reachedTool, outcomeComparison.modelDeclined, outcomeComparison.refused]
    .map((r) => `| ${r.label} | ${r.pass1} | ${r.pass2} | ${fmtDelta(r.delta)} |`)
    .join("\n");

  const ruleRows =
    outcomeComparison.refusedByRule.length > 0
      ? outcomeComparison.refusedByRule.map((r) => `| ${r.rule} | ${r.pass1} | ${r.pass2} | ${fmtDelta(r.delta)} |`).join("\n")
      : "| _(none in either pass)_ | 0 | 0 | 0 |";

  const costRows = costComparison.byComponent
    .map((c) => `| ${c.component} | ${usd(c.pass1)} | ${usd(c.pass2)} | ${c.delta >= 0 ? "+" : ""}${usd(c.delta)} |`)
    .join("\n");

  const regressed = outcomeChanges.filter((c) => c.classification === "regressed");
  const improved = outcomeChanges.filter((c) => c.classification === "improved");
  const changed = outcomeChanges.filter((c) => c.classification === "changed");

  const changeRow = (c: TicketOutcomeChange): string =>
    `| ${c.sourceFile.replace("test/", "")}#${c.id} | ${fmtSignature(c.pass1)} | ${fmtSignature(c.pass2)} |`;

  const changeSection = (title: string, note: string, rows: readonly TicketOutcomeChange[]): string =>
    rows.length === 0
      ? `### ${title}\n\n_(none)_\n`
      : `### ${title}\n\n${note}\n\n| Ticket | Pass one | Pass two |\n|---|---|---|\n${rows.map(changeRow).join("\n")}\n`;

  return `# Simulation comparison: pass one vs pass two

Same 150 tickets, same committed actor mapping (\`test/actor-mapping.json\`), same single-turn
rule. Pass one's databases and evidence files are untouched; every number below comes from pass
two's own, independent set (\`data/sim2-*.db\`, \`evidence/simulation-results-2.jsonl\`) compared
against pass one's.

## Two numbers that matter most

| Metric | Pass one | Pass two | Delta |
|---|---|---|---|
| Identity requests reaching \`add_user_to_group\` (not stalling on a clarifying question) | ${headline1.identityReachedAddUserToGroup} | ${headline2.identityReachedAddUserToGroup} | ${fmtDelta(headline2.identityReachedAddUserToGroup - headline1.identityReachedAddUserToGroup)} |
| Endpoint replies still naming a stub device | ${headline1.endpointNamedStubDevice} | ${headline2.endpointNamedStubDevice} | ${fmtDelta(headline2.endpointNamedStubDevice - headline1.endpointNamedStubDevice)} |

## Category distribution

| Category | Pass one | Pass two | Delta |
|---|---|---|---|
${categoryRows}

## Outcomes

| Outcome | Pass one | Pass two | Delta |
|---|---|---|---|
${outcomeRows}

### Refused, by rule

| Rule | Pass one | Pass two | Delta |
|---|---|---|---|
${ruleRows}

## Cost

| Component | Pass one | Pass two | Delta |
|---|---|---|---|
${costRows}
| **Total** | **${usd(costComparison.totalCostUsd.pass1)}** | **${usd(costComparison.totalCostUsd.pass2)}** | **${costComparison.totalCostUsd.delta >= 0 ? "+" : ""}${usd(costComparison.totalCostUsd.delta)}** |

## Every ticket whose outcome changed

${outcomeChanges.length} of 150 tickets changed outcome between the two passes. Format is
\`category / tool called (or "no tool") [, policy decision]\` for each pass. Regressions are listed
first and are not summarized away, per instruction — a ticket that got worse matters more than one
that got better.

${changeSection("Regressed", "A ticket that reached a tool or a real category in pass one and did not in pass two.", regressed)}

${changeSection("Improved", "A ticket that stalled or was silently dropped in pass one and reached a tool or a real category in pass two.", improved)}

${changeSection("Changed, direction not asserted", "The outcome signature differs but does not match a clear improve/regress pattern — read the reply text in both results files to judge.", changed)}
`;
}
