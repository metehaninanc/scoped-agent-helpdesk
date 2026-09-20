/**
 * This gateway's own `execute` callback for `@helpdesk/gateway-core`'s generic ApprovalWorkflow
 * (SPRINT3.md, 3.4) — the approved-decision half of the one gated write. `tools/handler.ts`'s own
 * `onApproval` only creates the pending record; this is what runs once a human approves it,
 * reached from `bin/gateway.ts`'s own decision endpoint. There is exactly one approval-gated
 * tool in this package, unlike the identity gateway's two, so there is only one case here.
 */
import type { ApprovalRecord, ExecutionOutcome } from "@helpdesk/gateway-core";
import type { EndpointService } from "../stub/endpoint-service.js";

export function createApprovalExecute(stub: EndpointService): (approval: ApprovalRecord) => Promise<ExecutionOutcome> {
  return async (approval) => {
    const params = approval.params as { endpointId?: unknown };
    if (approval.tool !== "reboot_endpoint" || typeof params.endpointId !== "string") {
      return { status: "error", code: "unsupported_tool", message: `cannot execute ${approval.tool}` };
    }
    await stub.rebootEndpoint(params.endpointId);
    return { status: "executed" };
  };
}
