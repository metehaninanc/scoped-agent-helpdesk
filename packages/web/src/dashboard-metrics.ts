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
 */
export const PASSWORD_RESET_REQUEST_PATTERN = /\bpassword\b[\s\S]*\breset\b|\breset\b[\s\S]*\bpassword\b|\bforgot\b[\s\S]*\bpassword\b/i;

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

export interface OutcomeSplit {
  autonomous: number;
  approvalGated: number;
  refused: number;
  /** The model declined without calling any tool — no policy decision was ever made. Not folded
   * into "refused": that word is reserved for a named rule firing. See README.md. */
  modelDeclined: number;
}

export interface VolumeSection {
  requestsByDay: { day: string; count: number }[];
  split: OutcomeSplit;
  /** Triage itself failed (a bad reply or a network/API error) — excluded from `split` entirely,
   * since it is an operational fault, not a system outcome. */
  classifierFailures: number;
}

function volumeSection(input: DashboardInput): VolumeSection {
  const byDay = new Map<string, number>();
  let triageUnsupported = 0;
  let classifierFailures = 0;

  for (const r of input.orchestrator.records) {
    if (r.decision === "routed" || r.decision === "denied") {
      const day = dayOf(r.timestamp);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    if (r.decision === "denied") {
      if (r.rules.includes("triage.unsupported")) triageUnsupported++;
      else if (r.rules.some((rule) => CLASSIFIER_FAILURE_RULES.has(rule))) classifierFailures++;
    }
  }
  const requestsByDay = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }));

  let autonomous = 0;
  let approvalGated = 0;
  let gatewayRefused = 0;
  let modelDeclined = 0;
  for (const chain of [input.identity, input.mdm, input.knowledge, input.endpoint]) {
    for (const r of chain.records) {
      if (r.decision === "autonomous" && r.result === null) autonomous++;
      else if (r.decision === "approval") approvalGated++;
      else if (r.decision === "denied") gatewayRefused++;
      else if (r.decision === "no_tool_called") modelDeclined++;
    }
  }

  return {
    requestsByDay,
    split: { autonomous, approvalGated, refused: triageUnsupported + gatewayRefused, modelDeclined },
    classifierFailures,
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
  humans: HumansSection;
  stopped: StoppedSection;
  cost: CostSection;
}

export function computeDashboardData(input: DashboardInput): DashboardData {
  return {
    trust: trustSection(input),
    volume: volumeSection(input),
    humans: humansSection(input),
    stopped: stoppedSection(input),
    cost: costSection(input),
  };
}
