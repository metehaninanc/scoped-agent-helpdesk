import { ApprovalError, type ApprovalOutcome, type ApprovalRecord } from "@helpdesk/gateway";
import { describe, expect, it, vi } from "vitest";

import { decideApproval, renderApprovalDetail, renderApprovalsList, type DecideDeps } from "./approvals-page.js";

const pending = (overrides: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  id: "app-1",
  createdAt: "2026-09-16T12:00:00.000Z",
  requestId: "req-1",
  actor: "helpdesk.operator@contoso.com",
  tool: "add_user_to_group",
  params: { userPrincipalName: "alice@contoso.com", groupId: "20a26e53-1cbd-48e3-8cc4-8d86cece7a6a" },
  rules: ["approval.add_user_to_group"],
  rationale: null,
  status: "pending",
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  ...overrides,
});

describe("decideApproval()", () => {
  it("calls decide() with exactly the given input and returns the outcome", async () => {
    const outcome: ApprovalOutcome = {
      approval: pending({ status: "approved", decidedBy: "it.manager@contoso.com", decidedAt: "x", decisionNote: "ok" }),
      execution: { status: "executed", alreadyMember: false },
    };
    const decide = vi.fn().mockResolvedValue(outcome);
    const deps: DecideDeps = { decide };

    const result = await decideApproval(
      { approvalId: "app-1", decidedBy: "it.manager@contoso.com", decision: "approved", note: "ok" },
      deps,
    );

    expect(decide).toHaveBeenCalledWith({ approvalId: "app-1", decidedBy: "it.manager@contoso.com", decision: "approved", note: "ok" });
    expect(result).toEqual({ status: "ok", outcome });
  });

  it("reports an ApprovalError with its code and message", async () => {
    const decide = vi.fn().mockRejectedValue(new ApprovalError("self_approval", "the requester may not decide their own request"));

    const result = await decideApproval({ approvalId: "app-1", decidedBy: "x@contoso.com", decision: "approved", note: "ok" }, { decide });

    expect(result).toEqual({ status: "error", code: "self_approval", message: "the requester may not decide their own request" });
  });

  it("reports a plain Error as code unknown", async () => {
    const decide = vi.fn().mockRejectedValue(new Error("disk full"));
    const result = await decideApproval({ approvalId: "app-1", decidedBy: "x@contoso.com", decision: "approved", note: "ok" }, { decide });
    expect(result).toEqual({ status: "error", code: "unknown", message: "disk full" });
  });
});

describe("renderApprovalsList()", () => {
  it("says so when there are no pending approvals", () => {
    const html = renderApprovalsList([]);
    expect(html).toMatch(/no pending approvals/i);
  });

  it("lists each approval, escaped, linked to its detail page", () => {
    const html = renderApprovalsList([pending({ id: "app-1", actor: '<b>mallory</b>@contoso.com' })]);

    expect(html).toContain('href="/approvals/app-1"');
    expect(html).toContain("add_user_to_group");
    expect(html).not.toContain("<b>mallory</b>");
    expect(html).toContain("&lt;b&gt;mallory&lt;/b&gt;");
  });
});

describe("renderApprovalDetail()", () => {
  it("shows the raw facts exactly as stored", () => {
    const html = renderApprovalDetail(pending());

    expect(html).toContain("add_user_to_group");
    expect(html).toContain("alice@contoso.com");
    expect(html).toContain("20a26e53-1cbd-48e3-8cc4-8d86cece7a6a");
    expect(html).toContain("approval.add_user_to_group");
    expect(html).toContain("req-1");
  });

  it("states explicitly when no rationale was generated, rather than rendering nothing", () => {
    const html = renderApprovalDetail(pending({ rationale: null }));

    expect(html).toMatch(/no rationale was generated/i);
  });

  it("marks a present rationale as generated and shows it, escaped", () => {
    const html = renderApprovalDetail(pending({ rationale: "What is being requested\n<script>bad()</script>" }));

    expect(html).toMatch(/generated/i);
    expect(html).toContain("What is being requested");
    expect(html).not.toContain("<script>bad()</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders the decide form, with the note marked required, while pending", () => {
    const html = renderApprovalDetail(pending());

    expect(html).toContain('name="decidedBy"');
    expect(html).toMatch(/name="note"[^>]*required/);
    expect(html).toContain('value="approved"');
    expect(html).toContain('value="rejected"');
  });

  it("does not render the decide form once a decision has been made", () => {
    const html = renderApprovalDetail(
      pending({ status: "approved", decidedBy: "it.manager@contoso.com", decidedAt: "2026-09-16T12:05:00.000Z", decisionNote: "Looks fine." }),
    );

    expect(html).not.toContain("name=\"decidedBy\"");
    expect(html).toContain("it.manager@contoso.com");
    expect(html).toContain("Looks fine.");
    expect(html).toContain("approved");
  });

  it("shows a decide error", () => {
    const html = renderApprovalDetail(pending(), { status: "error", code: "self_approval", message: "the requester may not decide their own request" });
    expect(html).toContain('class="error"');
    expect(html).toContain("the requester may not decide their own request");
  });

  it("shows a successful approval's execution outcome", () => {
    const outcome: ApprovalOutcome = {
      approval: pending({ status: "approved" }),
      execution: { status: "executed", alreadyMember: false },
    };
    const html = renderApprovalDetail(pending({ status: "approved" }), { status: "ok", outcome });
    expect(html).toContain('class="ok"');
    expect(html).toMatch(/executed/i);
  });

  it("shows a rejection without claiming anything was executed", () => {
    const outcome: ApprovalOutcome = { approval: pending({ status: "rejected" }), execution: null };
    const html = renderApprovalDetail(pending({ status: "rejected" }), { status: "ok", outcome });
    expect(html).toContain('class="ok"');
    expect(html).not.toMatch(/executed/i);
  });
});
