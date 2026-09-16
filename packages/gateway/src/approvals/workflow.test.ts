import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditLog } from "@helpdesk/audit-core";
import { openDatabase } from "../db.js";
import { GraphError, type AddMemberResult } from "../graph/client.js";
import { ApprovalStore, type ApprovalRecord } from "./store.js";
import { APPROVER_AGENT, ApprovalError, ApprovalWorkflow, DENY_SELF_APPROVAL } from "./workflow.js";

const MARKETING = "20a26e53-1cbd-48e3-8cc4-8d86cece7a6a";
const ALICE = "alice@contoso.com";
const REQUESTER = "helpdesk.operator@contoso.com";
const APPROVER = "it.manager@contoso.com";

describe("ApprovalWorkflow", () => {
  let audit: AuditLog;
  let approvals: ApprovalStore;
  let addUserToGroup: ReturnType<typeof vi.fn<(upn: string, groupId: string) => Promise<AddMemberResult>>>;
  let workflow: ApprovalWorkflow;
  let pending: ApprovalRecord;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    let t = Date.UTC(2026, 8, 15, 12, 0, 0);
    const now = () => new Date((t += 1000));
    audit = new AuditLog(db, { now });
    approvals = new ApprovalStore(db, { now });
    addUserToGroup = vi.fn<(upn: string, groupId: string) => Promise<AddMemberResult>>(async () => ({ alreadyMember: false }));
    workflow = new ApprovalWorkflow({ approvals, audit, graph: { addUserToGroup } });

    pending = approvals.create({
      requestId: "req-1",
      actor: REQUESTER,
      tool: "add_user_to_group",
      params: { userPrincipalName: ALICE, groupId: MARKETING },
      rules: ["approval.add_user_to_group"],
      rationale: "What is being requested ...",
    });
  });

  afterEach(() => {
    audit.close();
  });

  // -------------------------------------------------------------------------

  describe("approve", () => {
    it("audits the verdict, records it, executes the change, and audits the result, in that order", async () => {
      const seen: { auditKinds: string[]; status: string | undefined }[] = [];
      addUserToGroup.mockImplementation(async () => {
        seen.push({ auditKinds: audit.list().map((r) => r.decision), status: approvals.get(pending.id)?.status });
        return { alreadyMember: false };
      });

      const outcome = await workflow.decide({
        approvalId: pending.id,
        decidedBy: APPROVER,
        decision: "approved",
        note: "Confirmed with the team lead.",
      });

      // When Graph ran, the verdict was already on disk in both places.
      expect(seen).toEqual([{ auditKinds: ["approved"], status: "approved" }]);
      expect(addUserToGroup).toHaveBeenCalledWith(ALICE, MARKETING);

      expect(outcome.approval).toMatchObject({ status: "approved", decidedBy: APPROVER, decisionNote: "Confirmed with the team lead." });
      expect(outcome.execution).toEqual({ status: "executed", alreadyMember: false });

      const records = audit.list();
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        requestId: "req-1",
        actor: APPROVER,
        agent: APPROVER_AGENT,
        tool: "add_user_to_group",
        parameters: { userPrincipalName: ALICE, groupId: MARKETING },
        decision: "approved",
        rules: ["approval.add_user_to_group"],
        result: { approvalId: pending.id, requestedBy: REQUESTER, decisionNote: "Confirmed with the team lead." },
      });
      expect(records[1]).toMatchObject({
        requestId: "req-1",
        actor: APPROVER,
        decision: "approved",
        result: { approvalId: pending.id, status: "executed", alreadyMember: false },
      });
    });

    it("keeps the approval approved and records the failure when Graph fails", async () => {
      addUserToGroup.mockRejectedValue(new GraphError(404, "Request_ResourceNotFound", "Resource does not exist.", "req-x"));

      const outcome = await workflow.decide({ approvalId: pending.id, decidedBy: APPROVER, decision: "approved", note: "ok" });

      expect(outcome.approval.status).toBe("approved");
      expect(outcome.execution).toMatchObject({ status: "error", code: "Request_ResourceNotFound" });
      expect(audit.list()[1]).toMatchObject({
        decision: "approved",
        result: { approvalId: pending.id, status: "error", code: "Request_ResourceNotFound", requestId: "req-x" },
      });
    });

    it("reports an already-member outcome as executed", async () => {
      addUserToGroup.mockResolvedValue({ alreadyMember: true });
      const outcome = await workflow.decide({ approvalId: pending.id, decidedBy: APPROVER, decision: "approved", note: "ok" });
      expect(outcome.execution).toEqual({ status: "executed", alreadyMember: true });
    });
  });

  describe("reject", () => {
    it("audits and records the verdict and calls nothing", async () => {
      const outcome = await workflow.decide({
        approvalId: pending.id,
        decidedBy: APPROVER,
        decision: "rejected",
        note: "Not justified by role.",
      });

      expect(outcome.approval).toMatchObject({ status: "rejected", decidedBy: APPROVER, decisionNote: "Not justified by role." });
      expect(outcome.execution).toBeNull();
      expect(addUserToGroup).not.toHaveBeenCalled();
      expect(audit.list()).toHaveLength(1);
      expect(audit.list()[0]).toMatchObject({ decision: "rejected", actor: APPROVER, result: { approvalId: pending.id } });
    });
  });

  // -------------------------------------------------------------------------

  describe("requester may not approve their own request", () => {
    it.each([REQUESTER, REQUESTER.toUpperCase(), "Helpdesk.Operator@Contoso.com"])("refuses %s", async (decidedBy) => {
      const failure = await workflow
        .decide({ approvalId: pending.id, decidedBy, decision: "approved", note: "I approve myself." })
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(ApprovalError);
      expect((failure as ApprovalError).code).toBe("self_approval");
      expect(approvals.get(pending.id)?.status).toBe("pending");
      expect(addUserToGroup).not.toHaveBeenCalled();
    });

    it("leaves evidence of the attempt", async () => {
      await workflow.decide({ approvalId: pending.id, decidedBy: REQUESTER, decision: "approved", note: "x" }).catch(() => undefined);

      expect(audit.list()).toHaveLength(1);
      expect(audit.list()[0]).toMatchObject({
        requestId: "req-1",
        actor: REQUESTER,
        agent: APPROVER_AGENT,
        tool: "add_user_to_group",
        decision: "denied",
        rules: [DENY_SELF_APPROVAL],
        result: { approvalId: pending.id, attempted: "approved" },
      });
    });

    it("applies to rejections too; the requester does not get to close their own request either", async () => {
      await expect(
        workflow.decide({ approvalId: pending.id, decidedBy: REQUESTER, decision: "rejected", note: "never mind" }),
      ).rejects.toMatchObject({ code: "self_approval" });
      expect(approvals.get(pending.id)?.status).toBe("pending");
    });
  });

  describe("the decision note is required", () => {
    it.each([
      ["approved", ""],
      ["approved", "   \n\t"],
      ["rejected", ""],
    ] as const)("refuses %s with note %j and writes nothing", async (decision, note) => {
      const failure = await workflow.decide({ approvalId: pending.id, decidedBy: APPROVER, decision, note }).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(ApprovalError);
      expect((failure as ApprovalError).code).toBe("note_required");
      expect(approvals.get(pending.id)?.status).toBe("pending");
      expect(audit.list()).toEqual([]);
      expect(addUserToGroup).not.toHaveBeenCalled();
    });

    it("stores the note trimmed", async () => {
      const outcome = await workflow.decide({ approvalId: pending.id, decidedBy: APPROVER, decision: "rejected", note: "  no  \n" });
      expect(outcome.approval.decisionNote).toBe("no");
    });
  });

  describe("other refusals", () => {
    it("rejects an approver that is not a UPN", async () => {
      await expect(
        workflow.decide({ approvalId: pending.id, decidedBy: "manager", decision: "approved", note: "ok" }),
      ).rejects.toMatchObject({ code: "invalid_approver" });
      expect(audit.list()).toEqual([]);
    });

    it("rejects an unknown approval id", async () => {
      await expect(
        workflow.decide({ approvalId: "00000000-0000-4000-8000-000000000000", decidedBy: APPROVER, decision: "approved", note: "ok" }),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("rejects a second verdict on a decided record, and writes nothing more", async () => {
      await workflow.decide({ approvalId: pending.id, decidedBy: APPROVER, decision: "rejected", note: "no" });
      const before = audit.list().length;

      await expect(
        workflow.decide({ approvalId: pending.id, decidedBy: "other@contoso.com", decision: "approved", note: "yes" }),
      ).rejects.toMatchObject({ code: "not_pending" });
      expect(audit.list()).toHaveLength(before);
      expect(addUserToGroup).not.toHaveBeenCalled();
    });

    it("rejects a decision value that is neither approved nor rejected", async () => {
      await expect(
        workflow.decide({ approvalId: pending.id, decidedBy: APPROVER, decision: "maybe" as "approved", note: "ok" }),
      ).rejects.toMatchObject({ code: "invalid_decision" });
    });
  });

  it("does not touch the record or Graph if the audit record cannot be written", async () => {
    const broken = new ApprovalWorkflow({
      approvals,
      audit: {
        append: () => {
          throw new Error("disk full");
        },
      },
      graph: { addUserToGroup },
    });

    await expect(broken.decide({ approvalId: pending.id, decidedBy: APPROVER, decision: "approved", note: "ok" })).rejects.toThrow(
      "disk full",
    );
    expect(approvals.get(pending.id)?.status).toBe("pending");
    expect(addUserToGroup).not.toHaveBeenCalled();
  });
});
