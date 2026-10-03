/**
 * `hand_off`: one tool, identical on every gateway (SPRINT4.md, section 2). "Any agent can reach
 * a point where a person is needed, and one uniform action is better than a special case." This
 * file is the single source of the schema, the description, and the execute() callback every
 * gateway's own tools/handler.ts wires in — the same "reviewed as a unit" discipline tool
 * descriptions already get per gateway, now extended to the one tool that is genuinely identical
 * across all four rather than risking four descriptions that quietly drift apart.
 *
 * Autonomous, unconditionally: creating a handoff touches nothing external and is reversible (an
 * operator can always resolve one as a mistake with a note saying so), so there is nothing here
 * for a policy engine to gate behind approval. Each gateway still adds its own
 * `Rule.AutonomousHandOff` entry to its own decide.ts — this file supplies the schema and the
 * execution, never a gateway's policy decision, the same boundary every other shared piece in
 * this package already respects ("shared code, not shared configuration", SPRINT2.md).
 *
 * The model supplies exactly one thing: `reason`, a short account of what a person needs to do.
 * That text is displayed to an operator and nothing in this system acts on it — the same standing
 * as the approval rationale generator's own text (SPRINT1.md, Component 4). It is not a decision,
 * and no downstream code branches on its content. Everything else a handoff record needs — the
 * actor, the requestId, the request text — comes from `SessionContext`, never from a tool
 * parameter: the model cannot restate who is asking or what they originally typed any more than
 * it can supply `userPrincipalName` for an identity it wasn't told, the same reasoning that keeps
 * `actor` a header rather than a parameter everywhere else in this project.
 *
 * The orchestrator creates a handoff the same shape, directly, without this tool: see its own
 * comments for why that path has no gateway and no policy decision to make.
 */
import { z } from "zod";

import type { HandoffStore } from "@helpdesk/handoff-core";

import type { SessionContext } from "./session.js";

export const HAND_OFF_TOOL_NAME = "hand_off";

export const HAND_OFF_PARAMS_SCHEMA = z.strictObject({
  reason: z.string().min(1).max(500),
});

export const HAND_OFF_TOOL_DESCRIPTION = [
  "Hands this request off to a person, for anything none of your other tools can do: it needs",
  "physical hands, procurement or logistics, an account or system this gateway does not",
  "administer, or any other case where a human has to take over. Call this instead of just",
  "explaining that you cannot help — a handoff is a real, recorded outcome, not a dead end.",
  "",
  "reason: a short account, in your own words, of what a person needs to do. This is shown to",
  "the operator who picks it up and to nobody else; do not restate the requester's identity or",
  "the original wording, only what remains to be done.",
  "",
  "Result:",
  '- { status: "handed_off", handoffId }: recorded and queued for an operator. Tell the requester',
  "plainly that this has been handed off to a person, and stop — do not retry this or any other",
  "tool for the same need.",
  '- { status: "denied", rules, message }: policy refused this. Report it as given.',
  '- { status: "error", code, message }: the gateway failed. Report the message as given.',
].join("\n");

export type HandOffOk = { status: "handed_off"; handoffId: string };

/** Built by each gateway's own tools/handler.ts and wired into its local `execute()` switch for
 * `case "hand_off"`. `createdBy` is `session.agent` — the same calling-agent identity already
 * recorded on every other audit record this gateway's own chain carries for this session, not a
 * separate "gateway name" concept. */
export function createHandOffExecute(
  handoffs: Pick<HandoffStore, "create">,
): (request: { tool: "hand_off"; params: { reason: string } }, session: SessionContext) => Promise<HandOffOk> {
  return async (request, session) => {
    const record = handoffs.create({
      requestId: session.requestId,
      actor: session.actor,
      requestText: session.requestText,
      createdBy: session.agent,
      reason: request.params.reason,
    });
    return { status: "handed_off", handoffId: record.id };
  };
}
