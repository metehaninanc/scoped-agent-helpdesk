/**
 * Comparing two simulation passes run against the same 150 tickets and the same actor mapping
 * (bin/simulate.ts's --tag) — the measurement the fixes between them exist to produce. Every
 * number here is derived from the two runs' own recorded TicketResults and, for cost, the two
 * runs' own five sim chains — nothing recomputed differently between the passes, so a difference
 * in the numbers is a difference between the runs, not between two ways of counting the same run.
 *
 * SPRINT4.md, section 6: which two passes are "before" and "after" is now a parameter, not always
 * pass one — comparing pass two against pass three needs the identical machinery below, just
 * pointed at a different baseline. renderComparisonMarkdown() takes each side's own label for
 * exactly this reason, rather than the fixed "pass one"/"pass two" strings it used when only one
 * comparison had ever been run.
 */
import type { AuditRecord } from "@helpdesk/audit-core";

import type { ChainSnapshot, CostSection, OutcomesSection } from "./dashboard-metrics.js";
import type { SimCategory, TicketResult } from "./simulation-types.js";

/**
 * A sim chain can carry more history than the pass's own recorded results does — not from
 * corruption, but from an interrupted attempt: triage completing (a real `routed`/`denied`
 * decision, on the record) followed by the agent's own call failing before anything closes it
 * out, orphaning that requestId. bin/simulate.ts's own resumability then reprocesses that same
 * ticket fresh under a new requestId once it is no longer in the results file, leaving the first,
 * incomplete attempt's records sitting in the chain alongside the second, complete one. SPRINT4.md,
 * section 6's own live run produced exactly this — 73 orphaned requestIds, real records of a real
 * failed attempt, still worth having for what they show about that failure, but not part of "the
 * 150 tickets this pass answers" and not something cost or outcome figures should double-count.
 *
 * This restricts a chain snapshot to only the requestIds a pass's own results.jsonl actually
 * carries — every reader of a pass's sim chains (bin/simulate-summary.ts, bin/simulate-compare.ts,
 * bin/simulate-score.ts) applies it before handing a snapshot to computeDashboardData(), so "how
 * many requests this pass cost" and "how this pass scored" both mean the same 150 requests the
 * results file itself claims, on every pass, not only the one that happened to need it.
 * `chainBreak` is left untouched: chain integrity is a property of the whole, real, on-disk
 * sequence, never of a filtered view of it.
 */
export function filterChainToRequestIds(snapshot: ChainSnapshot, requestIds: ReadonlySet<string>): ChainSnapshot {
  return { records: snapshot.records.filter((r: AuditRecord) => requestIds.has(r.requestId)), chainBreak: snapshot.chainBreak };
}

/** Every requestId a pass's own results actually claim — null (a runner-level error, no request
 * ever completed) is never included, since there is nothing on any chain to keep for it. */
export function requestIdsOf(results: readonly TicketResult[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const r of results) if (r.requestId !== null) ids.add(r.requestId);
  return ids;
}

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
 * A per-ticket bucket in dashboard-metrics.ts's own outcome model (OutcomesSection), computed
 * from a single TicketResult's signature rather than a live chain — this file compares two
 * one-shot runner passes, neither of which has a human behind it yet (SPRINT4.md section 6: no
 * second turn, approvals and handoffs left unresolved), so "resolved via an approval" never
 * applies here the way it can on the live dashboard; "approvalPending" is the ceiling for a
 * gated write in this context, and "handedOff" always means "in progress," never "resolved."
 */
export type SimOutcomeBucket = "resolved" | "redirected" | "handedOff" | "approvalPending" | "routedButUnresolved" | "classifierFailed" | "runnerError";

function outcomeBucketOf(sig: OutcomeSignature): SimOutcomeBucket {
  if (sig.category === "error") return "runnerError";
  if (sig.category === "triage_failed") return "classifierFailed";
  // "unsupported" is the old, single-category predecessor of "not_it" (SPRINT4.md, section 1) —
  // treated the same way here, since both are the same outcome under whichever scheme was live.
  if (sig.category === "not_it" || sig.category === "unsupported") return "redirected";
  // network and security are handoffs exactly as needs_human is, for a different reason.
  if (sig.category === "needs_human" || sig.category === "network" || sig.category === "security") return "handedOff";
  // Routable: identity | mdm | knowledge | endpoint.
  if (sig.toolCalled && sig.toolName === "hand_off") return "handedOff";
  if (sig.toolCalled && sig.policyDecision === "approval") return "approvalPending";
  if (sig.toolCalled && sig.policyDecision === "autonomous") return "resolved";
  // No tool called, or a gateway denial: reached the right agent, nothing came of it.
  return "routedButUnresolved";
}

/** Three tiers, matching dashboard-metrics.ts's own OutcomesSection philosophy, not a five-way
 * ranking within it: an operational fault (triage or the runner itself failed, not a system
 * decision) is worse than a dead end (reached an agent or a redirect decision, nothing useful
 * came of it), which is worse than any of the four named, working outcomes — resolved, redirected,
 * handed off, or approval pending, none ranked against each other, the same reason SPRINT4.md,
 * section 5 reports the reject and accept paths as separate figures rather than one blended
 * number: this file has no basis for saying a redirect is better or worse than a resolution. */
function tierOf(bucket: SimOutcomeBucket): 0 | 1 | 2 {
  if (bucket === "classifierFailed" || bucket === "runnerError") return 0;
  if (bucket === "routedButUnresolved") return 1;
  return 2;
}

/**
 * Fixed after SPRINT4.md, section 6's own pass-two-vs-pass-three comparison shipped a version of
 * this function that assumed reaching a tool is always better than not — the exact fallacy
 * section 5 exists to correct, left standing in this file even after the dashboard itself was
 * rewritten to stop making it. Under the old rule, a ticket that reached `list_devices` against
 * this tenant's permanently empty device directory (a dead end no different from declining
 * outright) counted as a regression the moment triage correctly re-routed it to `needs_human`
 * instead — nineteen of pass three's twenty mechanically-flagged "regressions" turned out to be
 * this, confirmed by reading both passes' own reply text (see the root README's own account).
 * `outcomeBucketOf()`/`tierOf()` above replace "did it call a tool" with the same three-tier
 * shape the dashboard already uses — an operational fault is worse than a dead end, which is
 * worse than any working outcome — so a graceful `hand_off` or a `needs_human` redirect no longer
 * reads as worse than a tool call that resolved nothing. A change within one tier (redirected to
 * resolved, say) still reports as "changed, direction not asserted": this file has no basis for
 * ranking those against each other, deliberately, the same restraint section 5's own reject/accept
 * split already applies to the live dashboard.
 */
export function classifyChange(before: OutcomeSignature, after: OutcomeSignature): OutcomeClassification {
  const t1 = tierOf(outcomeBucketOf(before));
  const t2 = tierOf(outcomeBucketOf(after));
  if (t2 > t1) return "improved";
  if (t2 < t1) return "regressed";
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
  beforeLabel = "pass one",
  afterLabel = "pass two",
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
      : `### ${title}\n\n${note}\n\n| Ticket | ${beforeLabel[0]!.toUpperCase()}${beforeLabel.slice(1)} | ${afterLabel[0]!.toUpperCase()}${afterLabel.slice(1)} |\n|---|---|---|\n${rows.map(changeRow).join("\n")}\n`;

  const Before = `${beforeLabel[0]!.toUpperCase()}${beforeLabel.slice(1)}`;
  const After = `${afterLabel[0]!.toUpperCase()}${afterLabel.slice(1)}`;

  return `# Simulation comparison: ${beforeLabel} vs ${afterLabel}

Same 150 tickets, same committed actor mapping (\`test/actor-mapping.json\`), same single-turn
rule. ${Before}'s databases and evidence files are untouched; every number below comes from
${afterLabel}'s own, independent set compared against ${beforeLabel}'s.

## Two numbers that matter most

| Metric | ${Before} | ${After} | Delta |
|---|---|---|---|
| Identity requests reaching \`add_user_to_group\` (not stalling on a clarifying question) | ${headline1.identityReachedAddUserToGroup} | ${headline2.identityReachedAddUserToGroup} | ${fmtDelta(headline2.identityReachedAddUserToGroup - headline1.identityReachedAddUserToGroup)} |
| Endpoint replies still naming a stub device | ${headline1.endpointNamedStubDevice} | ${headline2.endpointNamedStubDevice} | ${fmtDelta(headline2.endpointNamedStubDevice - headline1.endpointNamedStubDevice)} |

## Category distribution

| Category | ${Before} | ${After} | Delta |
|---|---|---|---|
${categoryRows}

## Outcomes

| Outcome | ${Before} | ${After} | Delta |
|---|---|---|---|
${outcomeRows}

### Refused, by rule

| Rule | ${Before} | ${After} | Delta |
|---|---|---|---|
${ruleRows}

## Cost

| Component | ${Before} | ${After} | Delta |
|---|---|---|---|
${costRows}
| **Total** | **${usd(costComparison.totalCostUsd.pass1)}** | **${usd(costComparison.totalCostUsd.pass2)}** | **${costComparison.totalCostUsd.delta >= 0 ? "+" : ""}${usd(costComparison.totalCostUsd.delta)}** |

## Every ticket whose outcome changed

${outcomeChanges.length} of 150 tickets changed outcome between the two passes. Format is
\`category / tool called (or "no tool") [, policy decision]\` for each pass. Regressions are listed
first and are not summarized away, per instruction — a ticket that got worse matters more than one
that got better.

${changeSection("Regressed", `A ticket that reached a tool or a real category in ${beforeLabel} and did not in ${afterLabel}.`, regressed)}

${changeSection("Improved", `A ticket that stalled or was silently dropped in ${beforeLabel} and reached a tool or a real category in ${afterLabel}.`, improved)}

${changeSection("Changed, direction not asserted", "The outcome signature differs but does not match a clear improve/regress pattern — read the reply text in both results files to judge.", changed)}
`;
}

// ---------------------------------------------------------------------------
// SPRINT4.md, section 6: the outcomes model (dashboard-metrics.ts's OutcomesSection) applied to a
// simulation pass's own sim chains, rather than the live `data/` ones — the exact same function,
// computeDashboardData(), the dashboard itself calls; nothing here recomputes an outcome
// differently for a simulation pass than it would for real traffic.

export interface PassOutcomes {
  label: string;
  outcomes: OutcomesSection;
  /** Misrouted is never mechanically computable (see dashboard-metrics.ts's own note) — null for a
   * pass this was not hand-scored against the ticket set's ground truth for. */
  misrouted: number | null;
}

function outcomeLine(label: string, values: readonly (number | string)[]): string {
  return `| ${label} | ${values.join(" | ")} |`;
}

/** Renders the reject path and accept path as two separate tables, across as many passes as are
 * given — SPRINT4.md, section 5's own rule ("a single blended percentage hides which half is
 * actually broken") applied again here, now across passes rather than within one render. */
export function renderOutcomesComparisonMarkdown(passes: readonly PassOutcomes[]): string {
  const header = `| Outcome | ${passes.map((p) => p.label).join(" | ")} |`;
  const divider = `|---${passes.map(() => "|---").join("")}|`;

  const rejectRows = [
    outcomeLine("Total", passes.map((p) => p.outcomes.rejectPath.total)),
    outcomeLine("Redirected", passes.map((p) => p.outcomes.rejectPath.redirected)),
    outcomeLine("Handed off, resolved", passes.map((p) => p.outcomes.rejectPath.handedOffResolved)),
    outcomeLine("Handed off, still in progress", passes.map((p) => p.outcomes.rejectPath.handedOffInProgress)),
  ].join("\n");

  const acceptRows = [
    outcomeLine("Total", passes.map((p) => p.outcomes.acceptPath.total)),
    outcomeLine("Resolved", passes.map((p) => p.outcomes.acceptPath.resolved)),
    outcomeLine("Handed off, resolved", passes.map((p) => p.outcomes.acceptPath.handedOffResolved)),
    outcomeLine("Handed off, still in progress", passes.map((p) => p.outcomes.acceptPath.handedOffInProgress)),
    outcomeLine("Routed but unresolved", passes.map((p) => p.outcomes.acceptPath.routedButUnresolved)),
    outcomeLine("Approval pending", passes.map((p) => p.outcomes.acceptPath.approvalPending)),
    outcomeLine("Approval rejected by an approver", passes.map((p) => p.outcomes.acceptPath.approvalRejected)),
  ].join("\n");

  const otherRows = [
    outcomeLine("Classifier failures (excluded from both paths)", passes.map((p) => p.outcomes.classifierFailures)),
    outcomeLine("Other denied, rule not recognized (excluded from both paths)", passes.map((p) => p.outcomes.otherDenied)),
    outcomeLine("Misrouted", passes.map((p) => (p.misrouted === null ? "not scored" : p.misrouted))),
  ].join("\n");

  return `# Simulation outcomes, by pass — SPRINT4.md, section 5's model

Every figure below except "Misrouted" is computed the same way the live dashboard computes it —
\`computeDashboardData()\`, pointed at each pass's own five sim chains instead of \`data/\`'s real
ones. "Misrouted" is never mechanical (see dashboard-metrics.ts's own \`MISROUTED_NOTE\`): a pass
shows a real count only once it has been scored by hand against the ticket set's own \`actualNeed\`
ground truth, and "not scored" otherwise, rather than a zero that would misreport an absence of
data as an absence of misrouting.

## Reject path — triage said not IT or needs a human

${header}
${divider}
${rejectRows}

## Accept path — triage routed it to an agent

${header}
${divider}
${acceptRows}

## Excluded from both paths

${header}
${divider}
${otherRows}
`;
}
