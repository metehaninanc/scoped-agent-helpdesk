/**
 * The operator console. SPRINT4.md, section 3: "the handoff queue and the approval queue in one
 * place, designed for someone working through them, not for a demo screenshot." Replaces
 * approvals-page.ts entirely (SPRINT4.md: "The existing approvals page folds into this. Do not
 * leave two pages that do overlapping things").
 *
 * A queue row (renderQueueTable): age, requester, a one-line summary, what kind of action it
 * needs — enough to triage without opening it. An opened item (renderApprovalDetail /
 * renderHandoffDetail) reads top to bottom in the order SPRINT4.md specifies: the raw request,
 * what the system did and why, what it could not do, then the actions available. Both opened
 * views share that shape and this file's own trail-rendering helpers, but are not the same
 * function — an approval and a handoff take different actions with different rules (see the
 * README, "Operator console notes", for why that stayed two render paths sharing parts, not one
 * branching on kind).
 *
 * SPRINT4.md, section 4: the rationale block is now the on-request control it was always meant to
 * become. A briefing is only ever generated because an approver, looking at this exact screen,
 * asked for one — never automatically at creation time. Only identity's own two gated tools
 * (add_user_to_group, remove_user_from_group) can produce one at all, the same scope the generator
 * itself has always had (see the README, "Approval store and rationale notes" and "Endpoint
 * gateway notes", for why that was never generalized); a reboot approval says so plainly rather
 * than offering a control that could only ever fail.
 */
import type { ApprovalOutcome, ApprovalRecord } from "@helpdesk/gateway-core";
import { ApprovalError } from "@helpdesk/gateway-core";
import { HandoffError, type HandoffRecord } from "@helpdesk/handoff-core";

import type { QueueRow, TrailRecord } from "./console-data.js";
import { escapeHtml, escapedPre, formatDuration } from "./html.js";

// ---------------------------------------------------------------------------
// Approve/reject and take/resolve: thin wrappers around the workflow, the same shape
// approvals-page.ts's decideApproval() already used — format what was decided, never
// re-implement the rule that decided it.
// ---------------------------------------------------------------------------

export interface DecideApprovalDeps {
  decide: (input: { approvalId: string; decidedBy: string; decision: "approved" | "rejected"; note: string }) => Promise<ApprovalOutcome>;
}

export type DecideResult = { status: "ok"; outcome: ApprovalOutcome } | { status: "error"; code: string; message: string };

export async function decideApproval(
  input: { approvalId: string; decidedBy: string; decision: "approved" | "rejected"; note: string },
  deps: DecideApprovalDeps,
): Promise<DecideResult> {
  try {
    const outcome = await deps.decide(input);
    return { status: "ok", outcome };
  } catch (error) {
    if (error instanceof ApprovalError) return { status: "error", code: error.code, message: error.message };
    return { status: "error", code: "unknown", message: error instanceof Error ? error.message : String(error) };
  }
}

export type HandoffActionResult = { status: "ok"; handoff: HandoffRecord } | { status: "error"; code: string; message: string };

export function takeHandoff(id: string, takenBy: string, deps: { take: (id: string, takenBy: string) => HandoffRecord }): HandoffActionResult {
  try {
    return { status: "ok", handoff: deps.take(id, takenBy) };
  } catch (error) {
    if (error instanceof HandoffError) return { status: "error", code: error.code, message: error.message };
    return { status: "error", code: "unknown", message: error instanceof Error ? error.message : String(error) };
  }
}

export function resolveHandoff(
  id: string,
  resolvedBy: string,
  note: string,
  deps: { resolve: (id: string, resolvedBy: string, note: string) => HandoffRecord },
): HandoffActionResult {
  try {
    return { status: "ok", handoff: deps.resolve(id, resolvedBy, note) };
  } catch (error) {
    if (error instanceof HandoffError) return { status: "error", code: error.code, message: error.message };
    return { status: "error", code: "unknown", message: error instanceof Error ? error.message : String(error) };
  }
}

/** The only two tools that can ever carry a briefing — the generator's own scope, unchanged by
 * moving it on-request (see this file's header comment). Checked here, client-side of the HTTP
 * call, so the console never offers a control that could only ever 409 or 502. */
const RATIONALE_CAPABLE_TOOLS = new Set(["add_user_to_group", "remove_user_from_group"]);

export type RationaleActionResult = { status: "ok"; approval: ApprovalRecord } | { status: "error"; code: string; message: string };

export interface RequestRationaleDeps {
  /** Talks to the owning gateway's own /approvals/rationale endpoint; never throws — a network or
   * gateway-side failure is already folded into the returned result by the caller (bin/web.ts). */
  request: (input: { approvalId: string; requestedBy: string }) => Promise<RationaleActionResult>;
}

export async function requestRationale(
  input: { approvalId: string; requestedBy: string },
  deps: RequestRationaleDeps,
): Promise<RationaleActionResult> {
  try {
    return await deps.request(input);
  } catch (error) {
    return { status: "error", code: "unknown", message: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// The queue list: SPRINT4.md, section 3's "one page, two queues."
// ---------------------------------------------------------------------------

function renderQueueTable(rows: readonly QueueRow[], kind: "approval" | "handoff"): string {
  const columns = kind === "approval" ? ["Age", "Requested by", "What's being asked", "Tool"] : ["Age", "Requested by", "Request", "Reason"];
  // Urgent rows sort first (sortQueue), so the longest-waiting row is no longer necessarily the top
  // one: the "oldest" emphasis goes to the first row that is not urgent, and an urgent row carries
  // its own, stronger marker instead.
  const firstOrdinary = rows.findIndex((r) => !r.urgent);
  const body = rows
    .map((row, index) => {
      const href = `/console/${kind === "approval" ? "approvals" : "handoffs"}/${escapeHtml(row.id)}`;
      const ageClass = row.urgent ? "age urgent" : index === firstOrdinary ? "age oldest" : "age";
      const badge = row.urgent ? `<span class="urgent-badge">URGENT</span> ` : "";
      return `
        <tr>
          <td class="${ageClass}">${escapeHtml(formatDuration(row.ageMs))}</td>
          <td>${escapeHtml(row.actor)}</td>
          <td>${badge}<a href="${href}">${escapeHtml(row.summary)}</a></td>
          <td>${escapeHtml(row.action)}</td>
        </tr>`;
    })
    .join("");

  return `
    <table class="queue">
      <thead><tr>${columns.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

export function renderConsole(approvalRows: readonly QueueRow[], handoffRows: readonly QueueRow[]): string {
  return `
    <h1>Operator console</h1>
    <p class="note">Both queues below are read live, from the audit chains, on every render — the
    same discipline the dashboard already holds. Urgent items first, whatever their age; after
    them, oldest first: the top row that is not urgent is the one that has waited longest.</p>

    <h2>Approvals waiting (${approvalRows.length})</h2>
    <p>A decision with a reversible consequence — the facts that led here are in front of it when
    you open one.</p>
    ${
      approvalRows.length === 0
        ? `<p class="queue-empty">No approvals waiting. The queue is clean.</p>`
        : renderQueueTable(approvalRows, "approval")
    }

    <h2>Handoffs waiting (${handoffRows.length})</h2>
    <p>Work to pick up and finish outside this system — take one, do the work, then resolve it
    with a note.</p>
    ${
      handoffRows.length === 0
        ? `<p class="queue-empty">No handoffs waiting. The queue is clean.</p>`
        : renderQueueTable(handoffRows, "handoff")
    }`;
}

// ---------------------------------------------------------------------------
// The shared trail rendering: "what the system did and why" (item 2 of an opened item).
// ---------------------------------------------------------------------------

/** A result long enough to want a preview rather than a raw dump inline — same threshold the old,
 * plain-truncating version of this cell used, kept only as the point past which the full value
 * moves behind a `<details>` disclosure instead of being cut and lost. */
const RESULT_PREVIEW_LENGTH = 80;

/** Never truncates and throws the remainder away — SPRINT4.md's own console fix: "do not leave a
 * value half shown." A short result renders in full, inline. A long one renders a preview in a
 * native `<summary>`, with the complete value, pretty-printed and wrapped, one click away in a
 * `<details>` — plain HTML, no script, the same "shorten the cell and let the operator expand it"
 * shape a disclosure widget already gives for free. */
function trailResultCell(record: TrailRecord): string {
  if (record.result === null) return "—";
  const oneLine = JSON.stringify(record.result);
  if (oneLine.length <= RESULT_PREVIEW_LENGTH) return escapeHtml(oneLine);
  const preview = `${oneLine.slice(0, RESULT_PREVIEW_LENGTH - 1)}…`;
  return `<details><summary>${escapeHtml(preview)}</summary>${escapedPre(record.result)}</details>`;
}

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The same real actor can appear two ways in one trail: an agent process names itself literally
 * ("identity-agent") on the records it writes directly (`request`, `model_usage`, ...), but a
 * record the GATEWAY writes in response to that same process's own authenticated tool call
 * carries the bearer token's own client id instead (`session.agent`, gateway-core/session.ts) — a
 * GUID, not a name. This resolves that for display only; the stored records themselves are
 * untouched, since they are evidence, not something a page may rewrite. Per chain, within this one
 * trail, any literal name already present on that chain stands in for every GUID on it — a chain
 * with no literal name anywhere in this trail (should not happen: every session brackets itself
 * with a literal-named `request` record first) leaves its GUIDs exactly as recorded, rather than
 * guessing.
 */
function agentNamesByChain(trail: readonly TrailRecord[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const r of trail) {
    if (!GUID_PATTERN.test(r.agent) && !names.has(r.chain)) names.set(r.chain, r.agent);
  }
  return names;
}

/** Shows the resolved name; keeps the GUID available rather than discarding it — a native
 * `title` attribute, hover-revealed, not swapped between row to row. */
function renderAgentCell(record: TrailRecord, agentNames: ReadonlyMap<string, string>): string {
  if (!GUID_PATTERN.test(record.agent)) return escapeHtml(record.agent);
  const name = agentNames.get(record.chain);
  if (name === undefined) return escapeHtml(record.agent);
  return `<span title="${escapeHtml(record.agent)}">${escapeHtml(name)}</span>`;
}

function renderTrail(trail: readonly TrailRecord[]): string {
  if (trail.length === 0) {
    return `<p class="note">No audit records found for this request id.</p>`;
  }
  const agentNames = agentNamesByChain(trail);
  const rows = trail
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.chain)}</td>
        <td>${renderAgentCell(r, agentNames)}</td>
        <td>${escapeHtml(r.decision)}</td>
        <td>${escapeHtml(r.tool ?? "—")}</td>
        <td>${escapeHtml(r.rules.join(", ") || "—")}</td>
        <td>${trailResultCell(r)}</td>
      </tr>`,
    )
    .join("");

  return `
    <table class="trail">
      <thead><tr><th>Chain</th><th>Agent</th><th>Decision</th><th>Tool</th><th>Rules</th><th>Result</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRawRequest(requestText: string | null): string {
  return requestText === null
    ? `<p class="note">No raw request text found in this request's own audit trail.</p>`
    : `<p>${escapeHtml(requestText)}</p>`;
}

// ---------------------------------------------------------------------------
// Opened approval.
// ---------------------------------------------------------------------------

function renderApprovalResult(result?: DecideResult): string {
  if (!result) return "";
  if (result.status === "error") return `<p class="error">${escapeHtml(result.message)}</p>`;
  const { execution } = result.outcome;
  const text =
    execution === null
      ? "Rejected. No change was made."
      : execution.status === "executed"
        ? `Executed.${execution.alreadyMember ? " The user was already a member." : ""}`
        : `Approved, but execution failed: ${execution.message}`;
  return `<p class="ok">${escapeHtml(text)}</p>`;
}

/** A single, narrowly-scoped script for a single form on the page — the console's one departure
 * from "no framework, no build pipeline for the UI" (see the README, "Operator console notes", for
 * why). Generation takes several real seconds; nothing server-rendered can acknowledge a click
 * before the response it produced arrives, so this is the only way to close that gap at all. If
 * JavaScript is unavailable the form still posts normally — the answer just arrives with no
 * interim reassurance, the same experience every other form on this page already has. */
const RATIONALE_REQUEST_PENDING_SCRIPT = `
  <script>
    document.getElementById("rationale-request-form").addEventListener("submit", function () {
      var button = document.getElementById("rationale-request-button");
      button.disabled = true;
      button.textContent = "Generating briefing… (a few seconds)";
    });
  </script>`;

function renderRationale(approval: ApprovalRecord, result?: RationaleActionResult): string {
  const resultBanner =
    result === undefined ? "" : result.status === "error" ? `<p class="error">${escapeHtml(result.message)}</p>` : `<p class="ok">Briefing generated.</p>`;

  if (approval.rationale !== null) {
    return `
      ${resultBanner}
      <div class="rationale-label">Rationale — generated by a model, supporting information only, not a decision</div>
      <div class="rationale">${escapedPre(approval.rationale)}</div>`;
  }

  if (!RATIONALE_CAPABLE_TOOLS.has(approval.tool)) {
    return `
      <div class="rationale-label">Rationale</div>
      <p class="rationale-missing">This approval's gateway does not generate a briefing.</p>`;
  }

  if (approval.status !== "pending") {
    return `
      <div class="rationale-label">Rationale</div>
      <p class="rationale-missing">No briefing was requested before this was decided.</p>`;
  }

  return `
    <div class="rationale-label">Rationale</div>
    <p class="rationale-missing">No briefing has been requested.</p>
    ${resultBanner}
    <form method="post" action="/console/approvals/${escapeHtml(approval.id)}/rationale" id="rationale-request-form">
      <label for="requestedBy">Your identity (UPN)</label>
      <input type="text" id="requestedBy" name="requestedBy" placeholder="it.manager@contoso.com" required>
      <button type="submit" id="rationale-request-button">Request briefing</button>
    </form>
    ${RATIONALE_REQUEST_PENDING_SCRIPT}`;
}

function renderApprovalActions(approval: ApprovalRecord, decideResult?: DecideResult, rationaleResult?: RationaleActionResult): string {
  const rationale = renderRationale(approval, rationaleResult);
  if (approval.status !== "pending") {
    return `
      ${rationale}
      <table>
        <tr><th>Status</th><td>${escapeHtml(approval.status)}</td></tr>
        <tr><th>Decided by</th><td>${escapeHtml(approval.decidedBy)}</td></tr>
        <tr><th>Decided at</th><td>${escapeHtml(approval.decidedAt)}</td></tr>
        <tr><th>Decision note</th><td>${escapeHtml(approval.decisionNote)}</td></tr>
      </table>`;
  }
  return `
    ${rationale}
    <form method="post" action="/console/approvals/${escapeHtml(approval.id)}/decide">
      <label for="decidedBy">Your identity (UPN) — must not match the requester</label>
      <input type="text" id="decidedBy" name="decidedBy" placeholder="it.manager@contoso.com" required>

      <label for="note">Decision note (required to approve or reject)</label>
      <textarea id="note" name="note" required></textarea>

      <button type="submit" name="decision" value="approved">Approve</button>
      <button type="submit" name="decision" value="rejected">Reject</button>
    </form>`;
}

export function renderApprovalDetail(
  approval: ApprovalRecord,
  trail: readonly TrailRecord[],
  rawRequestText: string | null,
  decideResult?: DecideResult,
  rationaleResult?: RationaleActionResult,
): string {
  return `
    <h1>Approval ${escapeHtml(approval.id)}</h1>
    ${renderApprovalResult(decideResult)}

    <h2>1. Raw request</h2>
    ${renderRawRequest(rawRequestText)}

    <h2>2. What the system did and why</h2>
    ${renderTrail(trail)}

    <h2>3. What it could not do</h2>
    <p>Nothing on its own — every group and device change in this system needs a human decision
    regardless of the target. This is the normal, gated outcome, not a partial failure.</p>

    <h2>4. Actions</h2>
    ${renderApprovalActions(approval, decideResult, rationaleResult)}`;
}

// ---------------------------------------------------------------------------
// Opened handoff.
// ---------------------------------------------------------------------------

function renderHandoffResult(result?: HandoffActionResult): string {
  if (!result) return "";
  if (result.status === "error") return `<p class="error">${escapeHtml(result.message)}</p>`;
  const text = result.handoff.status === "taken" ? `Taken by ${result.handoff.takenBy}.` : `Resolved by ${result.handoff.resolvedBy}.`;
  return `<p class="ok">${escapeHtml(text)}</p>`;
}

function renderHandoffActions(handoff: HandoffRecord, result?: HandoffActionResult): string {
  if (handoff.status === "open") {
    return `
      <form method="post" action="/console/handoffs/${escapeHtml(handoff.id)}/take">
        <label for="takenBy">Your identity (UPN)</label>
        <input type="text" id="takenBy" name="takenBy" placeholder="it.manager@contoso.com" required>
        <button type="submit">Take</button>
      </form>`;
  }
  if (handoff.status === "taken") {
    return `
      <table>
        <tr><th>Taken by</th><td>${escapeHtml(handoff.takenBy)}</td></tr>
        <tr><th>Taken at</th><td>${escapeHtml(handoff.takenAt)}</td></tr>
      </table>
      <form method="post" action="/console/handoffs/${escapeHtml(handoff.id)}/resolve">
        <label for="resolvedBy">Your identity (UPN)</label>
        <input type="text" id="resolvedBy" name="resolvedBy" placeholder="it.manager@contoso.com" required>

        <label for="note">Resolution note (required)</label>
        <textarea id="note" name="note" required></textarea>

        <button type="submit">Resolve</button>
      </form>`;
  }
  return `
    <table>
      <tr><th>Taken by</th><td>${escapeHtml(handoff.takenBy)}</td></tr>
      <tr><th>Taken at</th><td>${escapeHtml(handoff.takenAt)}</td></tr>
      <tr><th>Resolved by</th><td>${escapeHtml(handoff.resolvedBy)}</td></tr>
      <tr><th>Resolved at</th><td>${escapeHtml(handoff.resolvedAt)}</td></tr>
      <tr><th>Resolution note</th><td>${escapeHtml(handoff.resolutionNote)}</td></tr>
    </table>`;
}

export function renderHandoffDetail(handoff: HandoffRecord, trail: readonly TrailRecord[], result?: HandoffActionResult): string {
  return `
    <h1>Handoff ${escapeHtml(handoff.id)}</h1>
    ${handoff.urgent ? `<p><span class="urgent-badge">URGENT</span> Triage flagged this as a possible security incident.</p>` : ""}
    ${renderHandoffResult(result)}

    <h2>1. Raw request</h2>
    ${renderRawRequest(handoff.requestText)}

    <h2>2. What the system did and why</h2>
    ${renderTrail(trail)}

    <h2>3. What it could not do</h2>
    <p>${escapeHtml(handoff.reason)}</p>

    <h2>4. Actions</h2>
    ${renderHandoffActions(handoff, result)}`;
}
