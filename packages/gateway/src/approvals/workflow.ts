/**
 * The approver's decision path. SPRINT1.md, Component 4 and Component 6:
 *
 *   - the decision note is required on both approve and reject
 *   - reject any decision where decidedBy equals actor (server side; "one line" that is a real
 *     audit control)
 *
 * Order, same principle as the tool handler: evidence first, then state, then action.
 *
 *   1. validate the input; nothing is written for a malformed request
 *   2. audit the verdict (actor = the approver)
 *   3. record the verdict on the approval (decided at most once, enforced by the store)
 *   4. approved only: call Graph, then audit the result
 *
 * A self-approval attempt is refused at step 1 but still audited, as a denial: someone trying
 * to approve their own request is exactly the kind of thing the log exists to show.
 */
import type { AuditInput, AuditRecord } from "../audit/types.js";
import { GraphError, type AddMemberResult } from "../graph/client.js";
import { userPrincipalName } from "../policy/schemas.js";
import type { ApprovalRecord, ApprovalStore } from "./store.js";

/** The `agent` recorded on audit records written on behalf of a human approver. */
export const APPROVER_AGENT = "approval-workflow";
export const DENY_SELF_APPROVAL = "deny.self_approval";

export type ApprovalErrorCode =
  | "invalid_approver"
  | "invalid_decision"
  | "note_required"
  | "not_found"
  | "not_pending"
  | "self_approval";

export class ApprovalError extends Error {
  override readonly name = "ApprovalError";
  constructor(
    readonly code: ApprovalErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ApprovalDecisionInput {
  approvalId: string;
  /** UPN of the approver. Comes from the web layer's identity field, never from the model. */
  decidedBy: string;
  decision: "approved" | "rejected";
  note: string;
}

export type ExecutionOutcome =
  | { status: "executed"; alreadyMember: boolean }
  | { status: "error"; code: string; message: string; requestId?: string };

export interface ApprovalOutcome {
  approval: ApprovalRecord;
  /** Null for a rejection. */
  execution: ExecutionOutcome | null;
}

export interface ApprovalWorkflowDeps {
  approvals: Pick<ApprovalStore, "get" | "recordVerdict">;
  audit: { append(input: AuditInput): AuditRecord };
  graph: { addUserToGroup(userPrincipalName: string, groupId: string): Promise<AddMemberResult> };
}

const sameUser = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export class ApprovalWorkflow {
  constructor(private readonly deps: ApprovalWorkflowDeps) {}

  async decide(input: ApprovalDecisionInput): Promise<ApprovalOutcome> {
    // 1. Validate. Nothing below runs, and nothing is written, unless the request is well formed.
    const approver = userPrincipalName.safeParse(input.decidedBy);
    if (!approver.success) throw new ApprovalError("invalid_approver", "decidedBy must be the approver's UPN");
    if (input.decision !== "approved" && input.decision !== "rejected") {
      throw new ApprovalError("invalid_decision", 'decision must be "approved" or "rejected"');
    }
    const note = input.note.trim();
    if (note.length === 0) throw new ApprovalError("note_required", "a decision note is required on both approve and reject");

    const approval = this.deps.approvals.get(input.approvalId);
    if (approval === null) throw new ApprovalError("not_found", `approval ${input.approvalId} not found`);
    if (approval.status !== "pending") throw new ApprovalError("not_pending", `approval ${input.approvalId} is already ${approval.status}`);

    const base = {
      requestId: approval.requestId,
      actor: approver.data,
      agent: APPROVER_AGENT,
      tool: approval.tool,
      parameters: approval.params,
      rules: approval.rules,
    };

    if (sameUser(approver.data, approval.actor)) {
      this.deps.audit.append({
        ...base,
        decision: "denied",
        rules: [DENY_SELF_APPROVAL],
        result: { approvalId: approval.id, attempted: input.decision },
      });
      throw new ApprovalError("self_approval", "the requester may not decide their own request");
    }

    // 2. Evidence first.
    this.deps.audit.append({
      ...base,
      decision: input.decision,
      result: { approvalId: approval.id, requestedBy: approval.actor, decisionNote: note },
    });

    // 3. Then state. The store refuses if someone else decided in the meantime.
    let decided: ApprovalRecord;
    try {
      decided = this.deps.approvals.recordVerdict(approval.id, {
        status: input.decision,
        decidedBy: approver.data,
        decisionNote: note,
      });
    } catch (error) {
      throw new ApprovalError("not_pending", error instanceof Error ? error.message : String(error));
    }

    if (input.decision === "rejected") return { approval: decided, execution: null };

    // 4. Then action, and evidence of its outcome.
    const execution = await this.execute(decided);
    this.deps.audit.append({ ...base, decision: "approved", result: { approvalId: approval.id, ...execution } });
    return { approval: decided, execution };
  }

  private async execute(approval: ApprovalRecord): Promise<ExecutionOutcome> {
    const params = approval.params as { userPrincipalName?: unknown; groupId?: unknown };
    if (approval.tool !== "add_user_to_group" || typeof params.userPrincipalName !== "string" || typeof params.groupId !== "string") {
      return { status: "error", code: "unsupported_tool", message: `cannot execute ${approval.tool}` };
    }
    try {
      const { alreadyMember } = await this.deps.graph.addUserToGroup(params.userPrincipalName, params.groupId);
      return { status: "executed", alreadyMember };
    } catch (error) {
      if (error instanceof GraphError) {
        const message = error.message.replace(/^Graph \d+ \S+: /, "");
        return error.requestId === undefined
          ? { status: "error", code: error.code, message }
          : { status: "error", code: error.code, message, requestId: error.requestId };
      }
      return { status: "error", code: "unknown", message: error instanceof Error ? error.message : String(error) };
    }
  }
}
