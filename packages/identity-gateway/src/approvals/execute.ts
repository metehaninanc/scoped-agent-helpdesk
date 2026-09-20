/**
 * The identity gateway's own `execute` callback for `@helpdesk/gateway-core`'s generic
 * ApprovalWorkflow (SPRINT3.md, 3.4). Before this phase this dispatch lived as a private method
 * on the gateway's own ApprovalWorkflow subclass; moving the class itself to gateway-core meant
 * the Graph-specific half of it needed a home here instead. Behavior is unchanged from
 * SPRINT1.md/SPRINT2.md — only where the dispatch lives moved, mirroring how `execute` on
 * `RunToolCallDeps` already separates the generic call order from a gateway's own backend.
 */
import type { ApprovalRecord, ExecutionOutcome } from "@helpdesk/gateway-core";
import type { AddMemberResult } from "../graph/client.js";

export interface ApprovalExecuteGraphDeps {
  addUserToGroup(userPrincipalName: string, groupId: string): Promise<AddMemberResult>;
  removeUserFromGroup(userPrincipalName: string, groupId: string): Promise<void>;
}

/** Only the two writes this gateway ever puts behind approval can reach here; anything else is
 * a defensive, should-never-happen guard, not a real branch this gateway's own policy can take. */
export function createApprovalExecute(graph: ApprovalExecuteGraphDeps): (approval: ApprovalRecord) => Promise<ExecutionOutcome> {
  return async (approval) => {
    const params = approval.params as { userPrincipalName?: unknown; groupId?: unknown };
    if (
      (approval.tool !== "add_user_to_group" && approval.tool !== "remove_user_from_group") ||
      typeof params.userPrincipalName !== "string" ||
      typeof params.groupId !== "string"
    ) {
      return { status: "error", code: "unsupported_tool", message: `cannot execute ${approval.tool}` };
    }
    if (approval.tool === "add_user_to_group") {
      const { alreadyMember } = await graph.addUserToGroup(params.userPrincipalName, params.groupId);
      return { status: "executed", alreadyMember };
    }
    await graph.removeUserFromGroup(params.userPrincipalName, params.groupId);
    return { status: "executed" };
  };
}
