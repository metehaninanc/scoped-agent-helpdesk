/**
 * All the numbers on the dashboard (SPRINT3.md, 3.5), computed from the five audit chains and
 * nothing else — no separate telemetry, no metrics database, no counters maintained alongside.
 * Pure functions: every read (`.list()`, `.verifyChain()`) happens in bin/web.ts, once per
 * request, and this file only aggregates what it is handed. See README.md, "Dashboard notes", for
 * the full reasoning behind every judgement call below; the short version of each is repeated
 * here as a comment at the point it matters, so a reader does not have to hold both files in
 * their head at once.
 *
 * Two audit-record facts this file leans on throughout, both confirmed by reading
 * gateway-core/src/tool-call.ts rather than assumed:
 *
 *   - An `autonomous` decision is written TWICE per tool call: once before execution (`result`
 *     still null) and once after (`result` set, even on a backend error, since decide() already
 *     decided "autonomous" regardless of whether execute() later throws). `denied` and `approval`
 *     are each written exactly once, always with `result: null`. So counting `autonomous` records
 *     needs the `result === null` filter to avoid double-counting a call as two decisions; the
 *     other two decisions never need it.
 *   - `rationale` records carry their own token usage in `result.usage`, not as a separate
 *     `model_usage` record the way triage's and each agent's own turns do — a failed generation
 *     has no `usage` field at all, which this file treats as "no usage to price," not as usage
 *     priced at zero.
 */
import type { AuditRecord, ChainBreak } from "@helpdesk/audit-core";

import { priceUsage } from "./pricing.js";

export interface ChainSnapshot {
  records: readonly AuditRecord[];
  chainBreak: ChainBreak | null;
}

export interface DashboardInput {
  orchestrator: ChainSnapshot;
  identity: ChainSnapshot;
  mdm: ChainSnapshot;
  knowledge: ChainSnapshot;
  endpoint: ChainSnapshot;
  /** The moment this render is happening. Every chain is verified live, on this same render — see
   * trustSection() — so "when it was last verified" is always this timestamp, never a cached one. */
  now: Date;
}

export type ChainName = "orchestrator" | "identity" | "mdm" | "knowledge" | "endpoint";

/**
 * Heuristic match for a password-reset request's own wording, scoped to the orchestrator's
 * `routed` records where `category === "endpoint"` — triage's own system prompt
 * (packages/agent/src/triage.ts) deterministically classifies "any password reset request, for
 * any user" into that category, so this is matching against the one place the original request
 * text is guaranteed to land under that category, not a novel heuristic invented for this page.
 *
 * Why this exists at all: Phase 3.4's live run showed the endpoint agent's own system prompt
 * makes it decline password-reset requests conversationally, without ever calling
 * `reset_password` — so the policy engine's `deny.password_reset_never_automated` rule almost
 * never fires and cannot be this count's source. See README.md, "Dashboard notes", for why the
 * endpoint agent's own `no_tool_called` reply text was considered and rejected as the source too
 * (it fires for any reason the model didn't call a tool in that category, not only this one).
 * This is a regex over free text, not a policy decision — labelled as an estimate everywhere it
 * is shown.
 *
 * The `reset_password` alternative was added after the Sprint 3, Phase 3.5 live verification
 * run's own manual cross-check (README.md, "Sprint 3, Phase 3.5 verification run") found a real
 * request the three alternatives above all miss: one that names the tool literally, e.g. "call
 * the reset_password tool." `password` there sits inside one underscore-joined token with
 * `reset`, so `\bpassword\b` never matches it — `_` counts as a word character, so there is no
 * boundary between `reset` and `password` for either of the first two alternatives to find.
 * Naming the tool is exactly as strong a signal as the plain-English phrasings above, so it gets
 * its own alternative rather than a workaround folded into the existing ones.
 */
export const PASSWORD_RESET_REQUEST_PATTERN =
  /\bpassword\b[\s\S]*\breset\b|\breset\b[\s\S]*\bpassword\b|\bforgot\b[\s\S]*\bpassword\b|\breset_password\b/i;

/** Rules that name a triage operational failure (a bad reply or a network/API error), not a
 * refusal that maps a protected resource. Excluded from "refusal reasons," reported separately —
 * see README.md, "Dashboard notes". */
const CLASSIFIER_FAILURE_RULES = new Set(["triage.invalid_output", "triage.request_failed"]);

function dayOf(timestamp: string): string {
  // UTC calendar day. A day boundary in another timezone will occasionally split what a viewer
  // thinks of as one day's traffic; not worth a timezone parameter for a five-second glance page.
  return timestamp.slice(0, 10);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function routedParams(record: AuditRecord): { requestText: string; category: string } | null {
  const p = record.parameters;
  if (typeof p !== "object" || p === null) return null;
  const { requestText, category } = p as Record<string, unknown>;
  if (typeof requestText !== "string" || typeof category !== "string") return null;
  return { requestText, category };
}

// ---------------------------------------------------------------------------
// Is the record trustworthy

export interface ChainTrust {
  name: ChainName;
  totalRecords: number;
  intact: boolean;
  break: ChainBreak | null;
}

export interface TrustSection {
  chains: ChainTrust[];
  /** This render's own timestamp — see DashboardInput.now's comment. */
  verifiedAt: string;
}

function trustSection(input: DashboardInput): TrustSection {
  const entries: [ChainName, ChainSnapshot][] = [
    ["orchestrator", input.orchestrator],
    ["identity", input.identity],
    ["mdm", input.mdm],
    ["knowledge", input.knowledge],
    ["endpoint", input.endpoint],
  ];
  return {
    chains: entries.map(([name, snapshot]) => ({
      name,
      totalRecords: snapshot.records.length,
      intact: snapshot.chainBreak === null,
      break: snapshot.chainBreak,
    })),
    verifiedAt: input.now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// How much the system handles

export interface VolumeSection {
  requestsByDay: { day: string; count: number }[];
}

function volumeSection(input: DashboardInput): VolumeSection {
  const byDay = new Map<string, number>();
  for (const r of input.orchestrator.records) {
    // "handoff" is triage's own needs_human, network or security outcome (orchestrator.ts, section 2: no policy engine
    // sits in front of it, so it never produces a "denied" record) — an incoming request the
    // system handled by routing to a human, counted here the same as "routed"/"denied" are. Left
    // out until this fix, the same gap that made rejectPathSection() miss every needs_human ticket.
    if (r.decision === "routed" || r.decision === "denied" || r.decision === "handoff") {
      const day = dayOf(r.timestamp);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
  }
  const requestsByDay = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }));
  return { requestsByDay };
}

// ---------------------------------------------------------------------------
// SPRINT4.md, section 5: five outcomes, not tool-call-equals-success.
//
// Triage's own two-decision split (SPRINT4.md, section 1) is the seam this whole section is built
// on: "not_it"/"needs_human" is the reject path — the system declining to fully own the request
// itself — and "routable" is the accept path — the system attempting it, via an agent. The two are
// reported as separate figures throughout, never blended into one percentage: a single number
// hides which half is actually broken, exactly what SPRINT4.md's own two simulation passes showed.
//
// Three successes, computed straight from the chains:
//   - Redirected: a `triage.not_it` denial. Always fully achieved the instant it fires — the
//     orchestrator's own fixed-sentence reply is unconditional, so there is no separate "did the
//     redirect actually happen" question the way there is for a handoff.
//   - Resolved: an autonomous tool call that returned a non-error result, or an approval-gated one
//     that was approved AND executed without error. A pending or rejected approval has not
//     produced a real change yet and is not counted here — see "approvalPending"/"approvalRejected"
//     below, shown separately rather than folded into either a success or a failure.
//   - Handed off: correctly identified as needing a human, and RESOLVED by one. SPRINT4.md, the
//     console fix this same phase made explicit for the operator console itself: an open or taken
//     handoff is work in progress, not an outcome, so it is its own figure
//     ("handedOffInProgress"), not folded into either success or failure. A handoff can originate
//     two ways — triage's own `needs_human` decision (reject path, before any agent is reached) or
//     an agent calling `hand_off` mid-conversation (accept path, after being routed) — and both are
//     counted on whichever path they actually happened on, not merged into one total.
//
// One computable failure:
//   - Routed but unresolved: reached the right agent, which had nothing that bore on it — the
//     model declined without calling any tool, a gateway-level policy denial, an autonomous call
//     whose backend execution itself failed, or an approved-but-execution-failed change. All four
//     share the same practical shape from the requester's side (reached the right place, nothing
//     useful came of it) even though the first is a model choice and the rest are backend or
//     policy failures; SPRINT4.md's own two-bucket design has no slot finer than this one for that
//     distinction, so it is not invented here.
//
// One NOT computed, named as a gap rather than approximated (SPRINT4.md's own rule, applied to
// this section the same as every other number on the page):
//   - Misrouted: "reached an agent that could not help with it" requires knowing which agent
//     *should* have handled it — a ground truth this system has no way to derive from its own
//     decisions after the fact. Only a labelled evaluation set (the pass-three simulation,
//     SPRINT4.md section 6) can measure this; a live audit trail records what happened, never what
//     should have. No heuristic is attempted here.

export interface RejectPathOutcomes {
  /** `triage.not_it` denials plus `triage.needs_human` handoffs on the orchestrator chain. */
  total: number;
  redirected: number;
  handedOffResolved: number;
  handedOffInProgress: number;
}

export interface AcceptPathOutcomes {
  /** `routed` records on the orchestrator chain. */
  total: number;
  resolved: number;
  handedOffResolved: number;
  handedOffInProgress: number;
  routedButUnresolved: number;
  /** An approval-gated change created, not yet decided. Not counted as resolved (nothing has
   * changed yet) and not counted as a failure (nothing has gone wrong) — work in progress, the
   * same treatment an open handoff gets. */
  approvalPending: number;
  /** An approval-gated change a human explicitly declined. The system reached the right agent and
   * correctly identified the exact gated action — this is not a routing or coverage failure, a
   * human simply chose not to proceed — so it is named for what it is rather than forced into
   * "resolved" (nothing changed) or "routed but unresolved" (the agent did have something that
   * bore on it; that is precisely why it was gated). */
  approvalRejected: number;
}

export interface OutcomesSection {
  rejectPath: RejectPathOutcomes;
  acceptPath: AcceptPathOutcomes;
  /** Triage itself failed (a bad reply or a network/API error) — excluded from both paths above,
   * since it is an operational fault, not a routing or coverage outcome. */
  classifierFailures: number;
  /** An orchestrator `denied` record whose rules match neither the reject path (`triage.not_it` /
   * `triage.needs_human`) nor a known classifier failure — found, not invented: this database
   * carries real history from before SPRINT4.md, section 1 split `triage.unsupported` into those
   * two rules, and an old record naming a rule the current model no longer recognizes must be
   * counted honestly rather than silently vanishing from every total on this page. Zero on a
   * database with no such history. */
  otherDenied: number;
  /** Why "misrouted" carries no count — see this section's own header comment above. */
  misroutedNote: string;
}

export const MISROUTED_NOTE =
  "Not computable from the chains. Knowing a request was misrouted requires knowing which agent " +
  "should have handled it, and nothing in a live audit trail records that — it records what the " +
  "system decided and did, never what would have been correct. Only a ground-truth-labelled " +
  "evaluation (the pass-three simulation, SPRINT4.md section 6) can measure this.";

/** Maps a chain's own `requestId` to whether the handoff it produced (if any) has been resolved.
 * A requestId absent from the result created no handoff on this chain at all. Shared by the reject
 * path (triage's own `needs_human`, always on the orchestrator chain) and the accept path (an
 * agent's own `hand_off` tool call, on whichever gateway chain the agent runs on). */
function handoffResolutionByRequestId(chain: ChainSnapshot): ReadonlyMap<string, boolean> {
  const handoffIdByRequestId = new Map<string, string>();
  const resolvedHandoffIds = new Set<string>();
  for (const r of chain.records) {
    if (r.decision === "handoff") {
      const id = resultString(r.result, "handoffId");
      if (id !== undefined) handoffIdByRequestId.set(r.requestId, id);
    } else if (r.decision === "handoff_resolved") {
      const id = resultString(r.result, "handoffId");
      if (id !== undefined) resolvedHandoffIds.add(id);
    }
  }
  const resolution = new Map<string, boolean>();
  for (const [requestId, handoffId] of handoffIdByRequestId) {
    resolution.set(requestId, resolvedHandoffIds.has(handoffId));
  }
  return resolution;
}

function resultString(result: unknown, key: string): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const value = (result as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function rejectPathSection(input: DashboardInput): RejectPathOutcomes {
  // needs_human never produces a "denied" record (orchestrator.ts, SPRINT4.md section 2: no
  // gateway sits in front of it, so there is no policy decision to deny — it calls HandoffStore
  // directly). Every "handoff" record on this chain is therefore a triage handoff outcome — needs_human,
  // network or security, which differ in reason and urgency but not in how they are counted — counted
  // the same way the accept path counts its own handoffs, and a "denied" + triage.needs_human
  // record — this database's own pre-section-2 history — is stale by shape, not by rule name, and
  // falls to otherDenied in outcomesSection() rather than being matched here.
  const handoffResolution = handoffResolutionByRequestId(input.orchestrator);
  let redirected = 0;
  for (const r of input.orchestrator.records) {
    if (r.decision === "denied" && r.rules.includes("triage.not_it")) redirected++;
  }

  let handedOffResolved = 0;
  let handedOffInProgress = 0;
  for (const resolved of handoffResolution.values()) {
    if (resolved) handedOffResolved++;
    else handedOffInProgress++;
  }

  return { total: redirected + handedOffResolved + handedOffInProgress, redirected, handedOffResolved, handedOffInProgress };
}

type AcceptOutcome = "resolved" | "handedOffResolved" | "handedOffInProgress" | "routedButUnresolved" | "approvalPending" | "approvalRejected";

/**
 * Priority among what a single routed request's own gateway chain may carry, all under the same
 * requestId, since more than one can genuinely coexist (an informational autonomous lookup before
 * an approval-gated write; an autonomous lookup right before the agent itself calls `hand_off`,
 * both observed in this project's own live verification runs). Handoff outranks everything else —
 * it is the agent's own final judgment that a human is needed, made *after* whatever else it tried.
 * Approval outranks a plain autonomous success next: when both a lookup and a gated write happened
 * in the same turn, the gated write is the consequential action the requester actually came for.
 */
function classifyAcceptPathRequest(
  requestId: string,
  chainRecords: readonly AuditRecord[],
  handoffResolution: ReadonlyMap<string, boolean>,
): AcceptOutcome {
  if (handoffResolution.has(requestId)) {
    return handoffResolution.get(requestId) === true ? "handedOffResolved" : "handedOffInProgress";
  }

  const approvalRecord = chainRecords.find((r) => r.requestId === requestId && r.decision === "approval");
  if (approvalRecord) {
    const verdict = chainRecords.find((r) => r.requestId === requestId && (r.decision === "approved" || r.decision === "rejected"));
    if (verdict === undefined) return "approvalPending";
    if (verdict.decision === "rejected") return "approvalRejected";
    // Approved: the execution outcome is a second "approved" record, distinguished from the
    // decision record itself by carrying a `status` field (ApprovalWorkflow.decide()'s own shape).
    const executed = chainRecords.find(
      (r) => r.requestId === requestId && r.decision === "approved" && resultString(r.result, "status") !== undefined,
    );
    return resultString(executed?.result, "status") === "executed" ? "resolved" : "routedButUnresolved";
  }

  const autonomousDone = chainRecords.find((r) => r.requestId === requestId && r.decision === "autonomous" && r.result !== null);
  if (autonomousDone) {
    return resultString(autonomousDone.result, "status") === "error" ? "routedButUnresolved" : "resolved";
  }

  // Nothing that bore on it: the model declined without calling any tool, or the gateway's own
  // policy refused the one it tried (or, for an incomplete session, nothing was recorded at all).
  return "routedButUnresolved";
}

function acceptPathSection(input: DashboardInput): AcceptPathOutcomes {
  const chainsByCategory: Record<string, ChainSnapshot> = {
    identity: input.identity,
    mdm: input.mdm,
    knowledge: input.knowledge,
    endpoint: input.endpoint,
  };
  const handoffResolutionByCategory: Record<string, ReadonlyMap<string, boolean>> = {
    identity: handoffResolutionByRequestId(input.identity),
    mdm: handoffResolutionByRequestId(input.mdm),
    knowledge: handoffResolutionByRequestId(input.knowledge),
    endpoint: handoffResolutionByRequestId(input.endpoint),
  };

  const counts: Record<AcceptOutcome, number> = {
    resolved: 0,
    handedOffResolved: 0,
    handedOffInProgress: 0,
    routedButUnresolved: 0,
    approvalPending: 0,
    approvalRejected: 0,
  };
  let total = 0;

  for (const r of input.orchestrator.records) {
    if (r.decision !== "routed") continue;
    const params = routedParams(r);
    const chain = params ? chainsByCategory[params.category] : undefined;
    if (!params || !chain) continue; // Every real category matches one of the four chains above.
    total++;
    const outcome = classifyAcceptPathRequest(r.requestId, chain.records, handoffResolutionByCategory[params.category]!);
    counts[outcome]++;
  }

  return { total, ...counts };
}

function outcomesSection(input: DashboardInput): OutcomesSection {
  let classifierFailures = 0;
  let otherDenied = 0;
  for (const r of input.orchestrator.records) {
    if (r.decision !== "denied") continue;
    if (r.rules.includes("triage.not_it")) continue; // counted in rejectPathSection
    if (r.rules.some((rule) => CLASSIFIER_FAILURE_RULES.has(rule))) classifierFailures++;
    else otherDenied++;
  }

  return {
    rejectPath: rejectPathSection(input),
    acceptPath: acceptPathSection(input),
    classifierFailures,
    otherDenied,
    misroutedNote: MISROUTED_NOTE,
  };
}

// ---------------------------------------------------------------------------
// How busy the humans are

export type ApprovalGateway = "identity" | "endpoint";

export interface GatewayApprovalStats {
  gateway: ApprovalGateway;
  pendingCount: number;
  oldestPendingAgeMs: number | null;
  resolvedCount: number;
  medianTimeToDecisionMs: number | null;
}

export interface HumansSection {
  gateways: GatewayApprovalStats[];
  totalPending: number;
  oldestPendingAgeMs: number | null;
  medianTimeToDecisionMs: number | null;
}

interface ApprovalTimings {
  pendingAgesMs: number[];
  decisionDurationsMs: number[];
}

/**
 * Correlates by `requestId`, not approval id — the initial `approval` decision record (written by
 * tool-call.ts before the approval even exists) never carries one; only the identity gateway's
 * optional `rationale` record and the final `approved`/`rejected` record do. A single request that
 * produced two separate approval-worthy tool calls would be mis-attributed here; the current
 * agents make at most one write attempt per session, so this does not happen today. See README.md.
 */
function approvalTimingsFor(chain: ChainSnapshot, now: Date): ApprovalTimings {
  const approvalAt = new Map<string, string>();
  for (const r of chain.records) {
    if (r.decision === "approval") approvalAt.set(r.requestId, r.timestamp);
  }
  const decidedAt = new Map<string, string>();
  for (const r of chain.records) {
    if ((r.decision === "approved" || r.decision === "rejected") && !decidedAt.has(r.requestId)) {
      decidedAt.set(r.requestId, r.timestamp);
    }
  }

  const pendingAgesMs: number[] = [];
  const decisionDurationsMs: number[] = [];
  for (const [requestId, approvedAtTimestamp] of approvalAt) {
    const decided = decidedAt.get(requestId);
    if (decided === undefined) {
      pendingAgesMs.push(now.getTime() - Date.parse(approvedAtTimestamp));
    } else {
      decisionDurationsMs.push(Date.parse(decided) - Date.parse(approvedAtTimestamp));
    }
  }
  return { pendingAgesMs, decisionDurationsMs };
}

function summarizeApprovals(gateway: ApprovalGateway, t: ApprovalTimings): GatewayApprovalStats {
  return {
    gateway,
    pendingCount: t.pendingAgesMs.length,
    oldestPendingAgeMs: t.pendingAgesMs.length > 0 ? Math.max(...t.pendingAgesMs) : null,
    resolvedCount: t.decisionDurationsMs.length,
    medianTimeToDecisionMs: median(t.decisionDurationsMs),
  };
}

function humansSection(input: DashboardInput): HumansSection {
  // Only identity and endpoint ever produce an "approval" decision — mdm and knowledge never do
  // (confirmed: neither package's policy/types.ts declares an approval.* rule id).
  const identityTimings = approvalTimingsFor(input.identity, input.now);
  const endpointTimings = approvalTimingsFor(input.endpoint, input.now);
  const gateways = [summarizeApprovals("identity", identityTimings), summarizeApprovals("endpoint", endpointTimings)];

  const allPendingAgesMs = [...identityTimings.pendingAgesMs, ...endpointTimings.pendingAgesMs];
  const allDecisionDurationsMs = [...identityTimings.decisionDurationsMs, ...endpointTimings.decisionDurationsMs];

  return {
    gateways,
    totalPending: allPendingAgesMs.length,
    oldestPendingAgeMs: allPendingAgesMs.length > 0 ? Math.max(...allPendingAgesMs) : null,
    medianTimeToDecisionMs: median(allDecisionDurationsMs),
  };
}

// ---------------------------------------------------------------------------
// What was stopped

export interface RuleFrequency {
  rule: string;
  count: number;
}

export interface PasswordResetEstimate {
  count: number;
  note: string;
}

export interface StoppedSection {
  refusalReasons: RuleFrequency[];
  classifierFailures: RuleFrequency[];
  passwordReset: PasswordResetEstimate;
}

function sortedFrequencies(counts: Map<string, number>): RuleFrequency[] {
  return [...counts.entries()].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count);
}

function stoppedSection(input: DashboardInput): StoppedSection {
  const refusalCounts = new Map<string, number>();
  const classifierCounts = new Map<string, number>();

  for (const chain of [input.orchestrator, input.identity, input.mdm, input.knowledge, input.endpoint]) {
    for (const r of chain.records) {
      if (r.decision !== "denied") continue;
      for (const rule of r.rules) {
        const counts = CLASSIFIER_FAILURE_RULES.has(rule) ? classifierCounts : refusalCounts;
        counts.set(rule, (counts.get(rule) ?? 0) + 1);
      }
    }
  }

  let passwordResetCount = 0;
  for (const r of input.orchestrator.records) {
    if (r.decision !== "routed") continue;
    const params = routedParams(r);
    if (params && params.category === "endpoint" && PASSWORD_RESET_REQUEST_PATTERN.test(params.requestText)) {
      passwordResetCount++;
    }
  }

  return {
    refusalReasons: sortedFrequencies(refusalCounts),
    classifierFailures: sortedFrequencies(classifierCounts),
    passwordReset: {
      count: passwordResetCount,
      note:
        "Estimated from triage's routed request text (category \"endpoint\"), matched against " +
        "PASSWORD_RESET_REQUEST_PATTERN — not from deny.password_reset_never_automated, the policy " +
        "engine's own rule for this, which almost never fires because the model declines before " +
        "calling the tool. See README.md, \"Dashboard notes\".",
    },
  };
}

// ---------------------------------------------------------------------------
// What it costs

export type CostComponent = "triage" | "identity-agent" | "mdm-agent" | "knowledge-agent" | "endpoint-agent" | "rationale";

export interface UnpricedUsage {
  model: string;
  count: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ComponentCost {
  component: CostComponent;
  inputTokens: number;
  outputTokens: number;
  /** Priced usage only — see `unpriced` for what this excludes. */
  costUsd: number;
  unpriced: UnpricedUsage[];
}

export interface CostSection {
  components: ComponentCost[];
  totalCostUsd: number;
  totalRequests: number;
  averageCostPerRequestUsd: number | null;
  /** Span between the earliest and latest record across all five chains. */
  observedDays: number;
  /** Linear extrapolation of totalCostUsd over observedDays to a 30-day month. Null when there is
   * not enough history (under a day) for that extrapolation to mean anything. */
  estimatedMonthlyCostUsd: number | null;
  /** Share of gateway decisions (autonomous/approval/denied) whose requestId has zero
   * model_usage records anywhere in that same chain — a request that never involved a model at
   * all, such as an unauthenticated or malformed call straight to the gateway's HTTP endpoint.
   * Null when there are no decisions to divide by. */
  noModelCallShare: number | null;
}

interface UsageSample {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

function isUsageResult(value: unknown): value is { model: string; inputTokens: number; outputTokens: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { model?: unknown }).model === "string" &&
    typeof (value as { inputTokens?: unknown }).inputTokens === "number" &&
    typeof (value as { outputTokens?: unknown }).outputTokens === "number"
  );
}

function agentUsageSamples(chain: ChainSnapshot, agent: string): UsageSample[] {
  const samples: UsageSample[] = [];
  for (const r of chain.records) {
    if (r.decision === "model_usage" && r.agent === agent && isUsageResult(r.result)) {
      samples.push({ model: r.result.model, inputTokens: r.result.inputTokens, outputTokens: r.result.outputTokens });
    }
  }
  return samples;
}

function rationaleUsageSamples(chain: ChainSnapshot): UsageSample[] {
  const samples: UsageSample[] = [];
  for (const r of chain.records) {
    if (r.decision !== "rationale") continue;
    const result = r.result as { model?: unknown; usage?: unknown } | null;
    const usage = result?.usage as { inputTokens?: unknown; outputTokens?: unknown } | undefined;
    if (typeof result?.model === "string" && typeof usage?.inputTokens === "number" && typeof usage.outputTokens === "number") {
      samples.push({ model: result.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    }
  }
  return samples;
}

function summarizeComponent(component: CostComponent, samples: readonly UsageSample[]): ComponentCost {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  const unpricedByModel = new Map<string, UnpricedUsage>();

  for (const sample of samples) {
    inputTokens += sample.inputTokens;
    outputTokens += sample.outputTokens;
    const price = priceUsage(sample.model, sample.inputTokens, sample.outputTokens);
    if (price === null) {
      const existing = unpricedByModel.get(sample.model) ?? { model: sample.model, count: 0, inputTokens: 0, outputTokens: 0 };
      existing.count += 1;
      existing.inputTokens += sample.inputTokens;
      existing.outputTokens += sample.outputTokens;
      unpricedByModel.set(sample.model, existing);
    } else {
      costUsd += price;
    }
  }

  return { component, inputTokens, outputTokens, costUsd, unpriced: [...unpricedByModel.values()] };
}

function isGatewayDecision(r: AuditRecord): boolean {
  return r.decision === "denied" || r.decision === "approval" || (r.decision === "autonomous" && r.result === null);
}

function costSection(input: DashboardInput): CostSection {
  const components: ComponentCost[] = [
    summarizeComponent("triage", agentUsageSamples(input.orchestrator, "orchestrator")),
    summarizeComponent("identity-agent", agentUsageSamples(input.identity, "identity-agent")),
    summarizeComponent("mdm-agent", agentUsageSamples(input.mdm, "mdm-agent")),
    summarizeComponent("knowledge-agent", agentUsageSamples(input.knowledge, "knowledge-agent")),
    summarizeComponent("endpoint-agent", agentUsageSamples(input.endpoint, "endpoint-agent")),
    summarizeComponent("rationale", rationaleUsageSamples(input.identity)),
  ];

  const totalCostUsd = components.reduce((sum, c) => sum + c.costUsd, 0);
  const totalRequests = input.orchestrator.records.filter((r) => r.decision === "routed" || r.decision === "denied").length;
  const averageCostPerRequestUsd = totalRequests > 0 ? totalCostUsd / totalRequests : null;

  const allTimestamps = [input.orchestrator, input.identity, input.mdm, input.knowledge, input.endpoint]
    .flatMap((chain) => chain.records.map((r) => Date.parse(r.timestamp)))
    .filter((t) => !Number.isNaN(t));
  const observedMs = allTimestamps.length > 0 ? Math.max(...allTimestamps) - Math.min(...allTimestamps) : 0;
  const observedDays = observedMs / (1000 * 60 * 60 * 24);
  const estimatedMonthlyCostUsd = observedDays >= 1 ? (totalCostUsd / observedDays) * 30 : null;

  let decisionsTotal = 0;
  let decisionsWithNoModelCall = 0;
  for (const chain of [input.identity, input.mdm, input.knowledge, input.endpoint]) {
    const requestIdsWithModelUsage = new Set(
      chain.records.filter((r) => r.decision === "model_usage").map((r) => r.requestId),
    );
    for (const r of chain.records) {
      if (!isGatewayDecision(r)) continue;
      decisionsTotal++;
      if (!requestIdsWithModelUsage.has(r.requestId)) decisionsWithNoModelCall++;
    }
  }
  const noModelCallShare = decisionsTotal > 0 ? decisionsWithNoModelCall / decisionsTotal : null;

  return { components, totalCostUsd, totalRequests, averageCostPerRequestUsd, observedDays, estimatedMonthlyCostUsd, noModelCallShare };
}

// ---------------------------------------------------------------------------

export interface DashboardData {
  trust: TrustSection;
  volume: VolumeSection;
  outcomes: OutcomesSection;
  humans: HumansSection;
  stopped: StoppedSection;
  cost: CostSection;
}

export function computeDashboardData(input: DashboardInput): DashboardData {
  return {
    trust: trustSection(input),
    volume: volumeSection(input),
    outcomes: outcomesSection(input),
    humans: humansSection(input),
    stopped: stoppedSection(input),
    cost: costSection(input),
  };
}
