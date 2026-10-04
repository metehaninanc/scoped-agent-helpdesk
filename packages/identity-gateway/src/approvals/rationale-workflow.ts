/**
 * Rationale, on request. SPRINT4.md, section 4: "Move the briefing from automatic generation at
 * approval creation to a control on the opened approval in the console." Before this phase,
 * tools/handler.ts's own `onApproval` called the generator inline, as the last step of creating
 * the approval; now creation and generation are two separate, independently-audited events, and
 * generation only ever happens because an approver on the console's own opened-approval screen
 * asked for one.
 *
 * What stays exactly as it was (SPRINT4.md's own words, three things "to keep as they are"):
 *
 *   - The generator still receives raw facts only, never the agent's conversation.
 *     rationaleFactsFromApproval() rebuilds the same RationaleFacts shape tools/handler.ts used to
 *     build inline, now read back from the stored ApprovalRecord instead of the live tool call —
 *     the record already holds exactly those facts (tool, params, rules, actor), since that is
 *     what ApprovalStore.create() was given at creation time. Nothing new reaches the generator.
 *   - The request is audited: who asked, for which approval, when. `rationale_requested` commits
 *     before the model is ever called (evidence before action, the same ordering every other write
 *     in this project follows), naming the approver as `actor` — not the original requester, who
 *     `rationale`'s own `parameters.requestingUser` still names, unchanged.
 *   - A missing briefing is a normal state, not a failure. This file never blocks a decision on
 *     whether a briefing exists or succeeded; ApprovalWorkflow.decide() does not call anything
 *     here and does not know this file exists.
 *
 * A briefing can be requested at most once per approval: `already_generated` refuses a second
 * request once `rationale` is non-null, the same "settle once" discipline ApprovalStore.recordVerdict
 * already applies to a decision. It can only be requested while the approval is still pending —
 * asking for help deciding something already decided has nothing left to inform.
 */
import type { AuditInput, AuditRecord } from "@helpdesk/audit-core";
import type { ApprovalRecord, ApprovalStore } from "@helpdesk/gateway-core";
import { userPrincipalName } from "@helpdesk/gateway-core";

import type { PolicyConfig } from "../policy/types.js";
import { type RationaleFacts, type RationaleGenerator } from "./rationale.js";

/** The `agent` recorded on both records a request produces — named for the mechanism, the same
 * way `APPROVER_AGENT` ("approval-workflow") names ApprovalWorkflow's own writes rather than
 * reusing whichever agent originally created the approval. */
export const RATIONALE_REQUESTER_AGENT = "rationale-workflow";

export type RationaleRequestErrorCode = "invalid_requester" | "not_found" | "not_pending" | "already_generated" | "generation_failed";

export class RationaleRequestError extends Error {
  override readonly name = "RationaleRequestError";
  constructor(
    readonly code: RationaleRequestErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface RationaleRequestInput {
  approvalId: string;
  /** UPN of the approver asking for the briefing. Comes from the console's own identity field,
   * never from a model — the same trust class as ApprovalDecisionInput's `decidedBy`. */
  requestedBy: string;
}

/** Rebuilds the exact facts tools/handler.ts used to build inline before this phase, from the
 * stored record rather than a live tool call. Identical logic, moved: an ApprovalRecord's own
 * tool/params/rules/actor are exactly what ApprovalStore.create() was given at creation time. */
export function rationaleFactsFromApproval(approval: ApprovalRecord, config: PolicyConfig): RationaleFacts {
  const params = approval.params as Record<string, unknown>;
  const targetUser = typeof params.userPrincipalName === "string" ? params.userPrincipalName : null;
  let targetGroup: RationaleFacts["targetGroup"] = null;
  if (typeof params.groupId === "string") {
    const wanted = params.groupId.toLowerCase();
    const managed = config.managedGroups.find((g) => g.id.toLowerCase() === wanted);
    targetGroup = managed ? { id: managed.id, displayName: managed.displayName } : { id: params.groupId, displayName: null };
  }
  return { tool: approval.tool, params, rules: approval.rules, targetUser, targetGroup, requestingUser: approval.actor };
}

export interface RationaleWorkflowDeps {
  approvals: Pick<ApprovalStore, "get" | "setRationale">;
  audit: { append(input: AuditInput): AuditRecord };
  generator: RationaleGenerator;
  config: PolicyConfig;
}

export class RationaleWorkflow {
  constructor(private readonly deps: RationaleWorkflowDeps) {}

  async request(input: RationaleRequestInput): Promise<ApprovalRecord> {
    const requester = userPrincipalName.safeParse(input.requestedBy);
    if (!requester.success) throw new RationaleRequestError("invalid_requester", "requestedBy must be the approver's UPN");

    const approval = this.deps.approvals.get(input.approvalId);
    if (approval === null) throw new RationaleRequestError("not_found", `approval ${input.approvalId} not found`);
    if (approval.status !== "pending") throw new RationaleRequestError("not_pending", `approval ${input.approvalId} is already ${approval.status}`);
    if (approval.rationale !== null) throw new RationaleRequestError("already_generated", `approval ${input.approvalId} already has a briefing`);

    const base = {
      requestId: approval.requestId,
      actor: requester.data,
      agent: RATIONALE_REQUESTER_AGENT,
      tool: approval.tool,
    };

    // Evidence first: the ask itself, before the model is ever called. An approver reaching for
    // help before deciding is signal worth keeping regardless of what generation produces.
    this.deps.audit.append({ ...base, decision: "rationale_requested", parameters: { approvalId: approval.id }, rules: [], result: null });

    const facts = rationaleFactsFromApproval(approval, this.deps.config);
    let generated: Awaited<ReturnType<RationaleGenerator["generate"]>>;
    try {
      generated = await this.deps.generator.generate(facts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.audit.append({ ...base, decision: "rationale", parameters: facts, rules: [], result: { approvalId: approval.id, error: message } });
      throw new RationaleRequestError("generation_failed", message);
    }

    this.deps.approvals.setRationale(approval.id, generated.text);
    this.deps.audit.append({
      ...base,
      decision: "rationale",
      parameters: facts,
      rules: [],
      result: { approvalId: approval.id, model: generated.model, rationale: generated.text, usage: generated.usage },
    });

    const updated = this.deps.approvals.get(approval.id);
    if (updated === null) throw new Error(`approval ${approval.id} vanished after its briefing was generated`);
    return updated;
  }
}
