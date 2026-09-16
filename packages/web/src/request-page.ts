/**
 * The request page. SPRINT1.md, Component 6: "A text box, a user identity field, a submit
 * button. The identity field is a plain input in Sprint 1 ... carry the identity as a
 * parameter through every layer from day one."
 *
 * submitRequest() is the whole business logic, independent of HTTP: given an identity and a
 * request, it runs the identity agent and reports what happened. The actor is never taken
 * from anything but this explicit field.
 */
import { escapeHtml } from "./html.js";

export interface SubmitRequestInput {
  actor: string;
  requestText: string;
}

export interface AgentRunResult {
  requestId: string;
  toolWasCalled: boolean;
  reply: string;
}

export interface SubmitRequestDeps {
  runIdentityAgent: (input: SubmitRequestInput) => Promise<AgentRunResult>;
}

export type SubmitRequestResult =
  | ({ status: "ok" } & AgentRunResult)
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

export async function submitRequest(input: SubmitRequestInput, deps: SubmitRequestDeps): Promise<SubmitRequestResult> {
  const actor = input.actor.trim();
  const requestText = input.requestText.trim();

  if (actor.length === 0) return { status: "invalid", message: "Your identity is required." };
  if (requestText.length === 0) return { status: "invalid", message: "Enter a request." };

  try {
    const result = await deps.runIdentityAgent({ actor, requestText });
    return { status: "ok", ...result };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

function renderResult(result: SubmitRequestResult): string {
  switch (result.status) {
    case "invalid":
    case "error":
      return `<p class="error">${escapeHtml(result.message)}</p>`;
    case "ok":
      return `
        <div class="ok">
          <p><strong>Request id:</strong> <span class="status">${escapeHtml(result.requestId)}</span></p>
          <p><strong>A tool was called:</strong> ${result.toolWasCalled ? "yes" : "no"}</p>
          <p>${escapeHtml(result.reply)}</p>
        </div>`;
  }
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
