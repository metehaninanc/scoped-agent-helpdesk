/**
 * The dashboard. SPRINT3.md, 3.5: "an operations console, not a marketing page. Dense, calm,
 * monospaced figures, clear units, no gradients, no drop shadowed cards, no decorative icons."
 * Reuses html.ts's existing `.ok`/`.error` classes for the chain-status line rather than adding
 * new styling — green or red, no ambiguity, the same two classes the approval screen already
 * uses for a clean decision versus a refusal.
 *
 * Renders a DashboardData (dashboard-metrics.ts) computed just before this call. There is no
 * cached "last verified" state anywhere: this page's own render *is* the verification, which is
 * why every number here traces back to the five chains and nothing else.
 */
import type {
  AcceptPathOutcomes,
  ComponentCost,
  DashboardData,
  GatewayApprovalStats,
  RejectPathOutcomes,
  RuleFrequency,
} from "./dashboard-metrics.js";
import { escapeHtml, formatDuration } from "./html.js";

function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------

function renderTrust(data: DashboardData["trust"]): string {
  const rows = data.chains
    .map((c) => {
      const status = c.intact
        ? `<span class="ok">OK</span>`
        : `<span class="error">BROKEN — record ${c.break!.id}: ${escapeHtml(c.break!.reason)}</span>`;
      return `<tr><td>${escapeHtml(c.name)}</td><td>${c.totalRecords}</td><td>${status}</td></tr>`;
    })
    .join("");

  return `
    <h2>Is the record trustworthy</h2>
    <p>Every other number on this page depends on this one. Verified live, on this render — not a
    cached status from an earlier check.</p>
    <table>
      <thead><tr><th>Chain</th><th>Total records</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="note">Verified just now: ${escapeHtml(data.verifiedAt)}</p>`;
}

function renderVolume(data: DashboardData["volume"]): string {
  const dayRows = data.requestsByDay.map((d) => `<tr><td>${escapeHtml(d.day)}</td><td>${d.count}</td></tr>`).join("");

  return `
    <h2>How much the system handles</h2>
    <table>
      <thead><tr><th>Day</th><th>Requests</th></tr></thead>
      <tbody>${dayRows || `<tr><td colspan="2">No requests recorded.</td></tr>`}</tbody>
    </table>`;
}

/** SPRINT4.md, section 5: five outcomes, not tool-call-equals-success, and the reject and accept
 * paths reported as separate figures rather than one blended percentage — see
 * dashboard-metrics.ts's own header comment on this section for the full reasoning behind every
 * row here. */
function renderRejectPath(data: RejectPathOutcomes): string {
  return `
    <h3>Reject path — triage said not IT or needs a human (${data.total})</h3>
    <table>
      <thead><tr><th>Outcome</th><th>Count</th></tr></thead>
      <tbody>
        <tr><td>Redirected</td><td>${data.redirected}</td></tr>
        <tr><td>Handed off, resolved</td><td>${data.handedOffResolved}</td></tr>
        <tr><td>Handed off, still in progress</td><td>${data.handedOffInProgress}</td></tr>
      </tbody>
    </table>`;
}

function renderAcceptPath(data: AcceptPathOutcomes): string {
  return `
    <h3>Accept path — triage routed it to an agent (${data.total})</h3>
    <table>
      <thead><tr><th>Outcome</th><th>Count</th></tr></thead>
      <tbody>
        <tr><td>Resolved</td><td>${data.resolved}</td></tr>
        <tr><td>Handed off, resolved</td><td>${data.handedOffResolved}</td></tr>
        <tr><td>Handed off, still in progress</td><td>${data.handedOffInProgress}</td></tr>
        <tr><td>Routed but unresolved</td><td>${data.routedButUnresolved}</td></tr>
        <tr><td>Approval pending</td><td>${data.approvalPending}</td></tr>
        <tr><td>Approval rejected by an approver</td><td>${data.approvalRejected}</td></tr>
      </tbody>
    </table>
    <p class="note">"Routed but unresolved" — reached the right agent, which had nothing that bore
    on it: no tool called, a gateway policy denial, or a backend execution failure. Coverage's
    problem, not triage's.</p>
    <p class="note">Approval pending and approval rejected are shown on their own, not folded into
    resolved (nothing has changed yet, or the human said no) or into routed-but-unresolved (the
    agent had exactly the right action — that is precisely why it was gated).</p>`;
}

function renderOutcomes(data: DashboardData["outcomes"]): string {
  const classifierNote =
    data.classifierFailures > 0
      ? `<p class="note">${data.classifierFailures} request(s) could not be classified at all (a
         triage network or output error) — excluded from both paths below; an operational fault,
         not a routing outcome.</p>`
      : "";
  const otherDeniedNote =
    data.otherDenied > 0
      ? `<p class="note">${data.otherDenied} older denial(s) name a rule this scoring model does
         not recognize (a rule retired since the chain was created) — excluded from both paths
         below rather than misclassified, not silently dropped from this page's own count.</p>`
      : "";

  return `
    <h2>Did the system resolve things</h2>
    <p class="note">Reject path and accept path, reported separately — a single blended percentage
    hides which half is actually broken, the same mistake this project's own first two simulation
    passes exposed.</p>
    ${renderRejectPath(data.rejectPath)}
    ${renderAcceptPath(data.acceptPath)}
    <h3>Misrouted</h3>
    <p class="info">${escapeHtml(data.misroutedNote)}</p>
    ${classifierNote}
    ${otherDeniedNote}`;
}

function renderGatewayApprovalRow(g: GatewayApprovalStats): string {
  return `<tr>
    <td>${escapeHtml(g.gateway)}</td>
    <td>${g.pendingCount}</td>
    <td>${g.oldestPendingAgeMs === null ? "—" : formatDuration(g.oldestPendingAgeMs)}</td>
    <td>${g.resolvedCount}</td>
    <td>${g.medianTimeToDecisionMs === null ? "—" : formatDuration(g.medianTimeToDecisionMs)}</td>
  </tr>`;
}

function renderHumans(data: DashboardData["humans"]): string {
  const rows = data.gateways.map(renderGatewayApprovalRow).join("");

  return `
    <h2>How busy the humans are</h2>
    <table>
      <thead><tr><th>Gateway</th><th>Pending</th><th>Oldest pending</th><th>Resolved</th><th>Median time to decision</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p>Total pending across both gateways: <strong>${data.totalPending}</strong>,
    oldest ${data.oldestPendingAgeMs === null ? "—" : formatDuration(data.oldestPendingAgeMs)},
    combined median time to decision ${data.medianTimeToDecisionMs === null ? "—" : formatDuration(data.medianTimeToDecisionMs)}.</p>
    <p class="note">Correlated by request id, not approval id — see README.md, "Dashboard notes",
    for what that assumes.</p>`;
}

function renderRuleTable(title: string, rows: readonly RuleFrequency[], emptyText: string): string {
  const body = rows.map((r) => `<tr><td>${escapeHtml(r.rule)}</td><td>${r.count}</td></tr>`).join("");
  return `
    <h3>${escapeHtml(title)}</h3>
    <table>
      <thead><tr><th>Rule</th><th>Count</th></tr></thead>
      <tbody>${body || `<tr><td colspan="2">${escapeHtml(emptyText)}</td></tr>`}</tbody>
    </table>`;
}

function renderStopped(data: DashboardData["stopped"]): string {
  return `
    <h2>What was stopped</h2>
    ${renderRuleTable("Refusal reasons", data.refusalReasons, "No refusals recorded.")}
    ${renderRuleTable("Triage operational failures (not a refusal reason)", data.classifierFailures, "None.")}
    <h3>Password reset requests</h3>
    <p><strong>${data.passwordReset.count}</strong> estimated.</p>
    <p class="note">${escapeHtml(data.passwordReset.note)}</p>`;
}

function renderUnpriced(cost: ComponentCost): string {
  if (cost.unpriced.length === 0) return "";
  const items = cost.unpriced.map((u) => `${escapeHtml(u.model)} (${u.count} call(s), ${u.inputTokens + u.outputTokens} tokens)`).join(", ");
  return `<div class="note">No pricing on file for: ${items} — excluded from this row's cost, not priced at $0.</div>`;
}

function renderCost(data: DashboardData["cost"]): string {
  const rows = data.components
    .map(
      (c) => `
      <tr>
        <td>${escapeHtml(c.component)}</td>
        <td>${c.inputTokens.toLocaleString()}</td>
        <td>${c.outputTokens.toLocaleString()}</td>
        <td>${formatUsd(c.costUsd)}</td>
      </tr>
      ${c.unpriced.length > 0 ? `<tr><td colspan="4">${renderUnpriced(c)}</td></tr>` : ""}`,
    )
    .join("");

  const monthly =
    data.estimatedMonthlyCostUsd === null
      ? `<span class="note">not enough history yet (under a day observed) for a monthly estimate</span>`
      : `${formatUsd(data.estimatedMonthlyCostUsd)} <span class="note">(extrapolated from ${data.observedDays.toFixed(1)} observed day(s) — an estimate, not a bill)</span>`;

  return `
    <h2>What it costs</h2>
    <table>
      <thead><tr><th>Component</th><th>Input tokens</th><th>Output tokens</th><th>Cost (priced usage)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p>Total priced cost: <strong>${formatUsd(data.totalCostUsd)}</strong> across ${data.totalRequests} request(s)
    (${data.averageCostPerRequestUsd === null ? "—" : formatUsd(data.averageCostPerRequestUsd)} average per request).</p>
    <p>Estimated monthly total: ${monthly}</p>
    <p>Decisions reached with <strong>no model call at all</strong> (an unauthenticated or malformed
    call straight to a gateway, never touching an agent): ${data.noModelCallShare === null ? "—" : formatPercent(data.noModelCallShare)}.
    Most decisions in this system are made by deterministic code and cost nothing — a consequence
    of the architecture, not an optimisation.</p>
    <p class="note">Pricing is a hardcoded, published-rate table (packages/web/src/pricing.ts), not
    telemetry — it changes only when someone edits that file, never at runtime.</p>`;
}

export function renderDashboard(data: DashboardData): string {
  return `
    <h1>Dashboard</h1>
    <p class="note">Everything on this page is computed live from the five audit chains
    (orchestrator, identity, mdm, knowledge, endpoint) — no separate metrics store, no counter
    maintained alongside. This page is not linked from the request form and carries no
    authentication of its own, the same level of protection the approval screen already has.</p>
    ${renderTrust(data.trust)}
    ${renderVolume(data.volume)}
    ${renderOutcomes(data.outcomes)}
    ${renderHumans(data.humans)}
    ${renderStopped(data.stopped)}
    ${renderCost(data.cost)}`;
}
