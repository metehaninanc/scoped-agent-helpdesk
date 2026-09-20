/**
 * The request page. SPRINT1.md, Component 6: "A text box, a user identity field, a submit
 * button. The identity field is a plain input in Sprint 1 ... carry the identity as a
 * parameter through every layer from day one."
 *
 * submitRequest() is the whole business logic, independent of HTTP: given an identity and a
 * request, it routes the request (SPRINT3.md, 3.1: triage decides which agent, if any, handles
 * it) and reports what happened. The actor is never taken from anything but this explicit field.
 *
 * RouteResult mirrors @helpdesk/agent's RouteRequestResult structurally rather than importing
 * it, the same deliberate decoupling this file already used for the single-agent result before
 * triage existed: this file needs a duck-typed shape, not a compile-time dependency on the
 * orchestrator's own types.
 */
import { escapeHtml } from "./html.js";

export interface SubmitRequestInput {
  actor: string;
  requestText: string;
}

export type RouteResult =
  | {
      status: "routed";
      category: "identity" | "mdm" | "knowledge" | "endpoint";
      agent: string;
      requestId: string;
      toolWasCalled: boolean;
      reply: string;
      note?: string;
    }
  | { status: "unsupported"; requestId: string; message: string; note?: string }
  | { status: "triage_failed"; requestId: string; message: string };

export interface SubmitRequestDeps {
  routeRequest: (input: SubmitRequestInput) => Promise<RouteResult>;
}

export type SubmitRequestResult = RouteResult | { status: "invalid"; message: string } | { status: "error"; message: string };

export async function submitRequest(input: SubmitRequestInput, deps: SubmitRequestDeps): Promise<SubmitRequestResult> {
  const actor = input.actor.trim();
  const requestText = input.requestText.trim();

  if (actor.length === 0) return { status: "invalid", message: "Your identity is required." };
  if (requestText.length === 0) return { status: "invalid", message: "Enter a request." };

  try {
    return await deps.routeRequest({ actor, requestText });
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

function renderResult(result: SubmitRequestResult): string {
  switch (result.status) {
    case "invalid":
    case "error":
      return `<p class="error">${escapeHtml(result.message)}</p>`;
    case "triage_failed":
      return `
        <div class="error">
          <p><strong>Request id:</strong> <span class="status">${escapeHtml(result.requestId)}</span></p>
          <p>${escapeHtml(result.message)}</p>
        </div>`;
    case "unsupported":
      return `
        <div class="info">
          <p><strong>Request id:</strong> <span class="status">${escapeHtml(result.requestId)}</span></p>
          <p>${escapeHtml(result.message)}</p>
          ${renderNote(result.note)}
        </div>`;
    case "routed":
      return `
        <div class="ok">
          <p><strong>Request id:</strong> <span class="status">${escapeHtml(result.requestId)}</span></p>
          <p><strong>Handled by:</strong> ${escapeHtml(result.agent)}</p>
          <p><strong>A tool was called:</strong> ${result.toolWasCalled ? "yes" : "no"}</p>
          <p>${escapeHtml(result.reply)}</p>
          ${renderNote(result.note)}
        </div>`;
  }
}

/** SPRINT3.md, follow-up to 3.1: rendered whenever triage flagged part of the request as outside
 * whatever category it chose — see @helpdesk/agent's orchestrator.ts for the one place the note
 * text itself is owned. Never derived from anything but that fixed string; this file makes no
 * judgment of its own about what "part of the request" means. */
function renderNote(note: string | undefined): string {
  return note ? `<p class="note">${escapeHtml(note)}</p>` : "";
}

export function renderRequestForm(
  result?: SubmitRequestResult,
  formValues?: { actor: string; requestText: string },
): string {
  const actor = escapeHtml(formValues?.actor ?? "");
  const requestText = escapeHtml(formValues?.requestText ?? "");

  return `
    <h1>Request</h1>
    ${result ? renderResult(result) : ""}
    <form method="post" action="/">
      <label for="actor">Your identity (UPN)</label>
      <input type="text" id="actor" name="actor" value="${actor}" placeholder="alice@contoso.com" required>

      <label for="requestText">What do you need?</label>
      <textarea id="requestText" name="requestText" placeholder="which groups is alice@contoso.com in" required>${requestText}</textarea>

      <button type="submit">Submit</button>
    </form>`;
}
