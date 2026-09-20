import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditLog } from "@helpdesk/audit-core";

import { openDatabase } from "../db.js";
import { ApprovalStore, type ApprovalRecord } from "./store.js";
import { APPROVER_AGENT, ApprovalError, ApprovalWorkflow, DENY_SELF_APPROVAL, type ExecutionOutcome } from "./workflow.js";

const MARKETING = "20a26e53-1cbd-48e3-8cc4-8d86cece7a6a";
const ALICE = "alice@contoso.com";
const REQUESTER = "helpdesk.operator@contoso.com";
const APPROVER = "it.manager@contoso.com";

describe("ApprovalWorkflow", () => {
  let audit: AuditLog;
  let approvals: ApprovalStore;
  let execute: ReturnType<typeof vi.fn<(approval: ApprovalRecord) => Promise<ExecutionOutcome>>>;
  let workflow: ApprovalWorkflow;
  let pending: ApprovalRecord;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    let t = Date.UTC(2026, 8, 15, 12, 0, 0);
    const now = () => new Date((t += 1000));
    audit = new AuditLog(db, { now });
    approvals = new ApprovalStore(db, { now });
    execute = vi.fn<(approval: ApprovalRecord) => Promise<ExecutionOutcome>>(async () => ({ status: "executed" }));
    workflow = new ApprovalWorkflow({ approvals, audit, execute });

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
    it("audits the verdict, records it, calls execute() with the decided record, and audits the result, in that order", async () => {
      const seen: { auditKinds: string[]; status: string | undefined }[] = [];
      execute.mockImplementation(async (approval) => {
        seen.push({ auditKinds: audit.list().map((r) => r.decision), status: approvals.get(approval.id)?.status });
        return { status: "executed" };
      });

      const outcome = await workflow.decide({
        approvalId: pending.id,
        decidedBy: APPROVER,
        decision: "approved",
        note: "Confirmed with the team lead.",
      });

      // When execute() ran, the verdict was already on disk in both places.
      expect(seen).toEqual([{ auditKinds: ["approved"], status: "approved" }]);
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ id: pending.id, status: "approved" }));

      expect(outcome.approval).toMatchObject({ status: "approved", decidedBy: APPROVER, decisionNote: "Confirmed with the team lead." });
      expect(outcome.execution).toEqual({ status: "executed" });

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
        result: { approvalId: pending.id, status: "executed" },
      });
    });

    it("reports whatever execute() returns, unchanged", async () => {
      execute.mockResolvedValue({ status: "executed", alreadyMember: true });
      const outcome = await workflow.decide({ approvalId: pending.id, decidedBy: APPROVER, decision: "approved", note: "ok" });
      expect(outcome.execution).toEqual({ status: "executed", alreadyMember: true });
    });

    it("keeps the approval approved and records the failure when execute() rejects", async () => {
      execute.mockRejectedValue(new Error("Resource does not exist."));

      const outcome = await workflow.decide({ approvalId: pending.id, decidedBy: APPROVER, decision: "approved", note: "ok" });

      expect(outcome.approval.status).toBe("approved");
      expect(outcome.execution).toMatchObject({ status: "error", code: "unknown", message: "Resource does not exist." });
      expect(audit.list()[1]).toMatchObject({
        decision: "approved",
        result: { approvalId: pending.id, status: "error", code: "unknown", message: "Resource does not exist." },
      });
    });

    it("uses a supplied describeError to shape a thrown execute() error, instead of the default", async () => {
      execute.mockRejectedValue({ status: 404, code: "Request_ResourceNotFound" });
      const describeError = vi.fn((error: unknown) => {
        const e = error as { status: number; code: string };
        return { status: "error" as const, code: e.code, message: "Resource does not exist.", requestId: "req-x" };
      });
      const custom = new ApprovalWorkflow({ approvals, audit, execute, describeError });

      const outcome = await custom.decide({ approvalId: pending.id, decidedBy: APPROVER, decision: "approved", note: "ok" });

      expect(describeError).toHaveBeenCalledWith({ status: 404, code: "Request_ResourceNotFound" });
      expect(outcome.execution).toEqual({ status: "error", code: "Request_ResourceNotFound", message: "Resource does not exist.", requestId: "req-x" });
    });
  });

  describe("reject", () => {
    it("audits and records the verdict and calls execute() with nothing", async () => {
      const outcome = await workflow.decide({
        approvalId: pending.id,
        decidedBy: APPROVER,
        decision: "rejected",
        note: "Not justified by role.",
      });

      expect(outcome.approval).toMatchObject({ status: "rejected", decidedBy: APPROVER, decisionNote: "Not justified by role." });
      expect(outcome.execution).toBeNull();
      expect(execute).not.toHaveBeenCalled();
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
      expect(execute).not.toHaveBeenCalled();
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
      expect(execute).not.toHaveBeenCalled();
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
      expect(execute).not.toHaveBeenCalled();
    });

    it("rejects a decision value that is neither approved nor rejected", async () => {
      await expect(
        workflow.decide({ approvalId: pending.id, decidedBy: APPROVER, decision: "maybe" as "approved", note: "ok" }),
      ).rejects.toMatchObject({ code: "invalid_decision" });
    });
  });

  it("does not touch the record or call execute() if the audit record cannot be written", async () => {
    const broken = new ApprovalWorkflow({
      approvals,
      audit: {
        append: () => {
          throw new Error("disk full");
        },
      },
      execute,
    });

    await expect(broken.decide({ approvalId: pending.id, decidedBy: APPROVER, decision: "approved", note: "ok" })).rejects.toThrow(
      "disk full",
    );
    expect(approvals.get(pending.id)?.status).toBe("pending");
    expect(execute).not.toHaveBeenCalled();
  });
});
