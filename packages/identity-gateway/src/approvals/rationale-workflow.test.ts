import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditLog } from "@helpdesk/audit-core";
import { ApprovalStore, openDatabase, type ApprovalRecord } from "@helpdesk/gateway-core";

import type { PolicyConfig } from "../policy/types.js";
import type { RationaleGenerator } from "./rationale.js";
import {
  RATIONALE_REQUESTER_AGENT,
  RationaleRequestError,
  RationaleWorkflow,
  rationaleFactsFromApproval,
} from "./rationale-workflow.js";

const MARKETING = "20a26e53-1cbd-48e3-8cc4-8d86cece7a6a";
const ALICE = "alice@contoso.com";
const REQUESTER = "helpdesk.operator@contoso.com";
const APPROVER = "it.manager@contoso.com";

const config: PolicyConfig = {
  breakGlassUsers: [],
  managedGroups: [{ id: MARKETING, displayName: "Marketing" }],
  directoryRoleIds: [],
};

describe("RationaleWorkflow", () => {
  let audit: AuditLog;
  let approvals: ApprovalStore;
  let generate: ReturnType<typeof vi.fn<RationaleGenerator["generate"]>>;
  let workflow: RationaleWorkflow;
  let pending: ApprovalRecord;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    let t = Date.UTC(2026, 8, 15, 12, 0, 0);
    const now = () => new Date((t += 1000));
    audit = new AuditLog(db, { now });
    approvals = new ApprovalStore(db, { now });
    generate = vi.fn<RationaleGenerator["generate"]>(async () => ({
      text: "What is being requested\n...",
      model: "claude-opus-5",
      usage: { inputTokens: 210, outputTokens: 55 },
    }));
    workflow = new RationaleWorkflow({ approvals, audit, generator: { generate }, config });

    // Matches what onApproval() actually does in production: the "approval" audit record and the
    // stored ApprovalRecord are both written before a rationale is ever requested.
    audit.append({
      requestId: "req-1",
      actor: REQUESTER,
      agent: "identity-agent",
      tool: "add_user_to_group",
      parameters: { userPrincipalName: ALICE, groupId: MARKETING },
      decision: "approval",
      rules: ["approval.add_user_to_group"],
    });
    pending = approvals.create({
      requestId: "req-1",
      actor: REQUESTER,
      tool: "add_user_to_group",
      params: { userPrincipalName: ALICE, groupId: MARKETING },
      rules: ["approval.add_user_to_group"],
    });
  });

  afterEach(() => {
    audit.close();
  });

  // -------------------------------------------------------------------------

  it("audits the request before calling the generator, then audits the result, in that order", async () => {
    let auditKindsWhenGeneratorRan: string[] = [];
    generate.mockImplementation(async () => {
      auditKindsWhenGeneratorRan = audit.list().map((r) => r.decision);
      return { text: "What is being requested\n...", model: "claude-opus-5", usage: { inputTokens: 210, outputTokens: 55 } };
    });

    const updated = await workflow.request({ approvalId: pending.id, requestedBy: APPROVER });

    expect(auditKindsWhenGeneratorRan).toEqual(["approval", "rationale_requested"]);
    expect(updated.rationale).toBe("What is being requested\n...");

    const records = audit.list();
    expect(records.map((r) => r.decision)).toEqual(["approval", "rationale_requested", "rationale"]);
    expect(records[1]).toMatchObject({
      requestId: "req-1",
      actor: APPROVER,
      agent: RATIONALE_REQUESTER_AGENT,
      tool: "add_user_to_group",
      parameters: { approvalId: pending.id },
      result: null,
    });
    expect(records[2]).toMatchObject({
      requestId: "req-1",
      actor: APPROVER,
      agent: RATIONALE_REQUESTER_AGENT,
      tool: "add_user_to_group",
      result: {
        approvalId: pending.id,
        model: "claude-opus-5",
        rationale: "What is being requested\n...",
        usage: { inputTokens: 210, outputTokens: 55 },
      },
    });
  });

  it("gives the generator exactly the same facts shape the old automatic path built, read back from the stored record", async () => {
    await workflow.request({ approvalId: pending.id, requestedBy: APPROVER });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith({
      tool: "add_user_to_group",
      params: { userPrincipalName: ALICE, groupId: MARKETING },
      rules: ["approval.add_user_to_group"],
      targetUser: ALICE,
      targetGroup: { id: MARKETING, displayName: "Marketing" },
      requestingUser: REQUESTER,
    });
  });

  it("names the approver as actor, not the original requester", async () => {
    await workflow.request({ approvalId: pending.id, requestedBy: APPROVER });
    for (const record of audit.list().slice(1)) {
      expect(record.actor).toBe(APPROVER);
    }
  });

  it("audits the failure and refuses when generation throws, leaving the approval without a rationale", async () => {
    generate.mockRejectedValue(new Error("Rationale request failed (429): rate limited"));

    const failure = await workflow.request({ approvalId: pending.id, requestedBy: APPROVER }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(RationaleRequestError);
    expect((failure as RationaleRequestError).code).toBe("generation_failed");
    expect(approvals.get(pending.id)).toMatchObject({ status: "pending", rationale: null });

    const records = audit.list();
    expect(records.map((r) => r.decision)).toEqual(["approval", "rationale_requested", "rationale"]);
    expect(records[2]?.result).toEqual({ approvalId: pending.id, error: "Rationale request failed (429): rate limited" });
  });

  it("allows a retry after a failed attempt", async () => {
    generate.mockRejectedValueOnce(new Error("network blip"));
    await workflow.request({ approvalId: pending.id, requestedBy: APPROVER }).catch(() => undefined);

    const updated = await workflow.request({ approvalId: pending.id, requestedBy: APPROVER });
    expect(updated.rationale).toBe("What is being requested\n...");
  });

  it("refuses a second request once a briefing already exists, and calls the generator only once", async () => {
    await workflow.request({ approvalId: pending.id, requestedBy: APPROVER });

    await expect(workflow.request({ approvalId: pending.id, requestedBy: APPROVER })).rejects.toMatchObject({
      code: "already_generated",
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("refuses once the approval has been decided", async () => {
    approvals.recordVerdict(pending.id, { status: "approved", decidedBy: APPROVER, decisionNote: "ok" });

    await expect(workflow.request({ approvalId: pending.id, requestedBy: APPROVER })).rejects.toMatchObject({ code: "not_pending" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects an unknown approval id", async () => {
    await expect(
      workflow.request({ approvalId: "00000000-0000-4000-8000-000000000000", requestedBy: APPROVER }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects a requester that is not a UPN, and writes nothing", async () => {
    await expect(workflow.request({ approvalId: pending.id, requestedBy: "manager" })).rejects.toMatchObject({
      code: "invalid_requester",
    });
    expect(audit.list()).toHaveLength(1); // only the original "approval" record
    expect(generate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("rationaleFactsFromApproval()", () => {
  const approval: ApprovalRecord = {
    id: "app-1",
    createdAt: "2026-09-16T12:00:00.000Z",
    requestId: "req-1",
    actor: REQUESTER,
    tool: "add_user_to_group",
    params: { userPrincipalName: ALICE, groupId: MARKETING.toUpperCase() },
    rules: ["approval.add_user_to_group"],
    rationale: null,
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  };

  it("resolves a managed group case-insensitively to its display name", () => {
    expect(rationaleFactsFromApproval(approval, config)).toEqual({
      tool: "add_user_to_group",
      params: { userPrincipalName: ALICE, groupId: MARKETING.toUpperCase() },
      rules: ["approval.add_user_to_group"],
      targetUser: ALICE,
      targetGroup: { id: MARKETING, displayName: "Marketing" },
      requestingUser: REQUESTER,
    });
  });

  it("names an unmanaged group by id alone, with no display name", () => {
    const unmanaged = { ...approval, params: { userPrincipalName: ALICE, groupId: "33333333-3333-4333-8333-333333333333" } };
    const facts = rationaleFactsFromApproval(unmanaged, config);
    expect(facts.targetGroup).toEqual({ id: "33333333-3333-4333-8333-333333333333", displayName: null });
  });

  it("reports no target user or group when the params carry neither", () => {
    const reboot = { ...approval, tool: "reboot_endpoint", params: { endpointId: "ep-1" } };
    const facts = rationaleFactsFromApproval(reboot, config);
    expect(facts.targetUser).toBeNull();
    expect(facts.targetGroup).toBeNull();
  });
});
