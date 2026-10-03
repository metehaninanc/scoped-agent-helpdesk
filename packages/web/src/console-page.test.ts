import { ApprovalError, type ApprovalOutcome, type ApprovalRecord } from "@helpdesk/gateway-core";
import { HandoffError, type HandoffRecord } from "@helpdesk/handoff-core";
import { describe, expect, it, vi } from "vitest";

import { approvalRow, handoffRow, type TrailRecord } from "./console-data.js";
import {
  decideApproval,
  renderApprovalDetail,
  renderConsole,
  renderHandoffDetail,
  requestRationale,
  resolveHandoff,
  takeHandoff,
} from "./console-page.js";
import { escapeHtml } from "./html.js";

const approval = (overrides: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  id: "app-1",
  createdAt: "2026-09-16T12:00:00.000Z",
  requestId: "req-1",
  actor: "alice@contoso.com",
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

const handoff = (overrides: Partial<HandoffRecord> = {}): HandoffRecord => ({
  id: "handoff-1",
  createdAt: "2026-09-16T12:00:00.000Z",
  requestId: "req-2",
  actor: "bob@contoso.com",
  requestText: "my laptop screen is cracked",
  createdBy: "orchestrator",
  reason: "needs a replacement device",
  urgent: false,
  status: "open",
  takenBy: null,
  takenAt: null,
  resolvedBy: null,
  resolvedAt: null,
  resolutionNote: null,
  ...overrides,
});

const trailRecord = (overrides: Partial<TrailRecord> = {}): TrailRecord => ({
  id: 1,
  timestamp: "2026-09-16T12:00:00.000Z",
  requestId: "req-1",
  actor: "alice@contoso.com",
  agent: "identity-agent",
  chain: "identity",
  tool: "add_user_to_group",
  parameters: { userPrincipalName: "alice@contoso.com", groupId: "g-1" },
  decision: "approval",
  rules: ["approval.add_user_to_group"],
  result: null,
  prevHash: "x",
  hash: "y",
  ...overrides,
});

// ---------------------------------------------------------------------------

describe("decideApproval()", () => {
  it("calls decide() and returns the outcome", async () => {
    const outcome: ApprovalOutcome = { approval: approval({ status: "approved" }), execution: { status: "executed", alreadyMember: false } };
    const decide = vi.fn().mockResolvedValue(outcome);

    const result = await decideApproval({ approvalId: "app-1", decidedBy: "it.manager@contoso.com", decision: "approved", note: "ok" }, { decide });

    expect(result).toEqual({ status: "ok", outcome });
  });

  it("reports an ApprovalError with its code and message", async () => {
    const decide = vi.fn().mockRejectedValue(new ApprovalError("self_approval", "the requester may not decide their own request"));
    const result = await decideApproval({ approvalId: "app-1", decidedBy: "x@contoso.com", decision: "approved", note: "ok" }, { decide });
    expect(result).toEqual({ status: "error", code: "self_approval", message: "the requester may not decide their own request" });
  });
});

describe("takeHandoff() / resolveHandoff()", () => {
  it("takes a handoff and returns the updated record", () => {
    const take = vi.fn().mockReturnValue(handoff({ status: "taken", takenBy: "op@contoso.com" }));
    const result = takeHandoff("handoff-1", "op@contoso.com", { take });
    expect(take).toHaveBeenCalledWith("handoff-1", "op@contoso.com");
    expect(result).toEqual({ status: "ok", handoff: handoff({ status: "taken", takenBy: "op@contoso.com" }) });
  });

  it("reports a HandoffError with its code and message from take()", () => {
    const take = vi.fn(() => {
      throw new HandoffError("not_open", "handoff handoff-1 is already taken");
    });
    const result = takeHandoff("handoff-1", "op@contoso.com", { take });
    expect(result).toEqual({ status: "error", code: "not_open", message: "handoff handoff-1 is already taken" });
  });

  it("resolves a handoff and returns the updated record", () => {
    const resolve = vi.fn().mockReturnValue(handoff({ status: "resolved", resolvedBy: "op@contoso.com", resolutionNote: "replaced the device" }));
    const result = resolveHandoff("handoff-1", "op@contoso.com", "replaced the device", { resolve });
    expect(resolve).toHaveBeenCalledWith("handoff-1", "op@contoso.com", "replaced the device");
    expect(result.status).toBe("ok");
  });

  it("reports note_required from resolve() as a HandoffError", () => {
    const resolve = vi.fn(() => {
      throw new HandoffError("note_required", "a resolution note is required");
    });
    const result = resolveHandoff("handoff-1", "op@contoso.com", "", { resolve });
    expect(result).toEqual({ status: "error", code: "note_required", message: "a resolution note is required" });
  });
});

describe("requestRationale()", () => {
  it("calls request() and returns the ok result unchanged", async () => {
    const updated = approval({ rationale: "What is being requested\n..." });
    const request = vi.fn().mockResolvedValue({ status: "ok", approval: updated });

    const result = await requestRationale({ approvalId: "app-1", requestedBy: "it.manager@contoso.com" }, { request });

    expect(request).toHaveBeenCalledWith({ approvalId: "app-1", requestedBy: "it.manager@contoso.com" });
    expect(result).toEqual({ status: "ok", approval: updated });
  });

  it("returns an error result unchanged", async () => {
    const request = vi.fn().mockResolvedValue({ status: "error", code: "already_generated", message: "approval app-1 already has a briefing" });
    const result = await requestRationale({ approvalId: "app-1", requestedBy: "it.manager@contoso.com" }, { request });
    expect(result).toEqual({ status: "error", code: "already_generated", message: "approval app-1 already has a briefing" });
  });

  it("catches an unexpected throw from its dependency rather than propagating it", async () => {
    const request = vi.fn().mockRejectedValue(new Error("network blip"));
    const result = await requestRationale({ approvalId: "app-1", requestedBy: "it.manager@contoso.com" }, { request });
    expect(result).toEqual({ status: "error", code: "unknown", message: "network blip" });
  });
});

// ---------------------------------------------------------------------------

describe("renderConsole()", () => {
  it("writes a deliberate, calm empty state for each queue, not a blank page", () => {
    const html = renderConsole([], []);
    expect(html).toMatch(/no approvals waiting/i);
    expect(html).toMatch(/no handoffs waiting/i);
    expect(html).toContain("Approvals waiting (0)");
    expect(html).toContain("Handoffs waiting (0)");
  });

  it("lists approval rows linked to their own detail page, oldest first as given", () => {
    const rows = [approvalRow(approval({ id: "app-1" }), new Date("2026-09-16T13:00:00.000Z"))];
    const html = renderConsole(rows, []);
    expect(html).toContain('href="/console/approvals/app-1"');
    expect(html).toContain("Add alice@contoso.com to group 20a26e53-1cbd-48e3-8cc4-8d86cece7a6a");
  });

  it("lists handoff rows linked to their own detail page", () => {
    const rows = [handoffRow(handoff({ id: "handoff-1" }), new Date("2026-09-16T13:00:00.000Z"))];
    const html = renderConsole([], rows);
    expect(html).toContain('href="/console/handoffs/handoff-1"');
    expect(html).toContain("my laptop screen is cracked");
  });

  it("marks only the first (oldest) row of each queue as visually distinct", () => {
    const rows = [
      approvalRow(approval({ id: "app-old", createdAt: "2026-09-16T10:00:00.000Z" }), new Date("2026-09-16T13:00:00.000Z")),
      approvalRow(approval({ id: "app-new", createdAt: "2026-09-16T12:00:00.000Z" }), new Date("2026-09-16T13:00:00.000Z")),
    ];
    const html = renderConsole(rows, []);
    expect((html.match(/class="age oldest"/g) ?? []).length).toBe(1);
  });

  it("marks an urgent handoff plainly, and gives the oldest-row emphasis to the first row that is not urgent", () => {
    const now = new Date("2026-09-16T13:00:00.000Z");
    const rows = [
      handoffRow(handoff({ id: "h-urgent", createdAt: "2026-09-16T12:50:00.000Z", urgent: true, requestText: "I entered my password on a fake page" }), now),
      handoffRow(handoff({ id: "h-old", createdAt: "2026-09-16T08:00:00.000Z" }), now),
      handoffRow(handoff({ id: "h-new", createdAt: "2026-09-16T12:00:00.000Z" }), now),
    ];
    const html = renderConsole([], rows);
    expect((html.match(/URGENT/g) ?? []).length).toBe(1);
    expect((html.match(/class="age urgent"/g) ?? []).length).toBe(1);
    expect((html.match(/class="age oldest"/g) ?? []).length).toBe(1);
    expect(html.indexOf("h-urgent")).toBeLessThan(html.indexOf("h-old"));
  });

  it("escapes a hostile requester value", () => {
    const rows = [approvalRow(approval({ actor: "<b>mallory</b>@contoso.com" }), new Date())];
    const html = renderConsole(rows, []);
    expect(html).not.toContain("<b>mallory</b>");
    expect(html).toContain("&lt;b&gt;mallory&lt;/b&gt;");
  });
});

// ---------------------------------------------------------------------------

describe("renderApprovalDetail()", () => {
  it("shows the raw request text when the trail carries it", () => {
    const html = renderApprovalDetail(approval(), [], "which groups is alice in");
    expect(html).toContain("which groups is alice in");
  });

  it("says plainly when no raw request text was found, rather than a blank section", () => {
    const html = renderApprovalDetail(approval(), [], null);
    expect(html).toMatch(/no raw request text found/i);
  });

  it("renders the trail as what the system did and why", () => {
    const html = renderApprovalDetail(approval(), [trailRecord({ decision: "approval", tool: "add_user_to_group", rules: ["approval.add_user_to_group"] })], null);
    expect(html).toContain("identity");
    expect(html).toContain("add_user_to_group");
    expect(html).toContain("approval.add_user_to_group");
  });

  describe("the trail's Result column", () => {
    it("shows a short result inline, in full", () => {
      const html = renderApprovalDetail(approval(), [trailRecord({ result: { status: "ok" } })], null);
      expect(html).toContain(escapeHtml('{"status":"ok"}'));
      expect(html).not.toContain("<details>");
    });

    it("never truncates a long result and throws the remainder away — it goes behind a details disclosure instead", () => {
      const longResult = { status: "ok", groups: Array.from({ length: 10 }, (_, i) => ({ id: `group-${i}`, displayName: `Group ${i}` })) };
      const html = renderApprovalDetail(approval(), [trailRecord({ result: longResult })], null);
      const fullJson = JSON.stringify(longResult, null, 2);

      expect(html).toContain("<details>");
      expect(html).toContain("<summary>");
      // Every line of the real value is present somewhere in the page, not cut off.
      for (const line of fullJson.split("\n")) {
        expect(html).toContain(escapeHtml(line));
      }
    });

    it("shows a literal dash for a null result, not an empty or truncated cell", () => {
      const html = renderApprovalDetail(approval(), [trailRecord({ result: null })], null);
      expect(html).toContain("—");
    });
  });

  describe("the trail's Agent column", () => {
    it("resolves a GUID agent to the literal name recorded elsewhere on the same chain, in this same trail", () => {
      const html = renderApprovalDetail(
        approval(),
        [
          trailRecord({ chain: "identity", agent: "identity-agent", decision: "request", tool: null }),
          trailRecord({ chain: "identity", agent: "c51ca6c5-a783-4685-8b80-eb4bd2df4070", decision: "approval", tool: "add_user_to_group" }),
        ],
        null,
      );
      // The GUID is available via a title attribute, and the resolved name renders as text.
      expect(html).toContain('title="c51ca6c5-a783-4685-8b80-eb4bd2df4070"');
      expect(html).toContain(">identity-agent<");
    });

    it("keeps the GUID available rather than discarding it", () => {
      const html = renderApprovalDetail(
        approval(),
        [
          trailRecord({ chain: "identity", agent: "identity-agent", decision: "request", tool: null }),
          trailRecord({ chain: "identity", agent: "c51ca6c5-a783-4685-8b80-eb4bd2df4070", decision: "approval", tool: "add_user_to_group" }),
        ],
        null,
      );
      expect(html).toContain("c51ca6c5-a783-4685-8b80-eb4bd2df4070");
    });

    it("leaves a non-GUID agent value exactly as recorded", () => {
      const html = renderApprovalDetail(approval(), [trailRecord({ agent: "approval-workflow" })], null);
      expect(html).toContain("approval-workflow");
    });

    it("falls back to the raw GUID when no literal name exists anywhere on that chain in this trail", () => {
      const html = renderApprovalDetail(approval(), [trailRecord({ chain: "identity", agent: "c51ca6c5-a783-4685-8b80-eb4bd2df4070" })], null);
      expect(html).toContain("c51ca6c5-a783-4685-8b80-eb4bd2df4070");
    });
  });

  it("frames 'what it could not do' honestly for a gated action, not as a failure", () => {
    const html = renderApprovalDetail(approval(), [], null);
    expect(html).toMatch(/nothing on its own/i);
  });

  it("says a briefing has not been requested, with a control beside it, while pending", () => {
    const html = renderApprovalDetail(approval({ rationale: null, status: "pending" }), [], null);
    expect(html).toMatch(/no briefing has been requested/i);
    expect(html).toContain('action="/console/approvals/app-1/rationale"');
    expect(html).toContain('name="requestedBy"');
    expect(html).toContain('id="rationale-request-button"');
  });

  it("says a briefing was never requested, with no control, once decided", () => {
    const html = renderApprovalDetail(approval({ rationale: null, status: "approved", decidedBy: "it.manager@contoso.com", decidedAt: "2026-09-16T12:05:00.000Z", decisionNote: "ok" }), [], null);
    expect(html).toMatch(/no briefing was requested before this was decided/i);
    expect(html).not.toContain("/rationale");
  });

  it("says plainly that a reboot approval's gateway does not generate a briefing, with no control", () => {
    const html = renderApprovalDetail(approval({ tool: "reboot_endpoint", rationale: null }), [], null);
    expect(html).toMatch(/does not generate a briefing/i);
    expect(html).not.toContain("/rationale");
    expect(html).not.toContain('id="rationale-request-button"');
  });

  it("marks a present rationale as generated and shows it, escaped, regardless of the tool or decided status", () => {
    const html = renderApprovalDetail(approval({ rationale: "What is being requested\n<script>bad()</script>", status: "approved" }), [], null);
    expect(html).toMatch(/generated/i);
    expect(html).not.toContain("<script>bad()</script>");
  });

  it("shows an error inline when a briefing request failed, and keeps the control for a retry", () => {
    const html = renderApprovalDetail(approval({ rationale: null }), [], null, undefined, {
      status: "error",
      code: "generation_failed",
      message: "Rationale request failed (429): rate limited",
    });
    expect(html).toContain('class="error"');
    expect(html).toContain("rate limited");
    expect(html).toContain('id="rationale-request-button"');
  });

  it("shows a plain acknowledgement, not the raw record, once a briefing was just generated", () => {
    const updated = approval({ rationale: "What is being requested\n..." });
    const html = renderApprovalDetail(updated, [], null, undefined, { status: "ok", approval: updated });
    expect(html).toContain('class="ok"');
    expect(html).toMatch(/briefing generated/i);
  });

  it("renders the decide form, note required, while pending", () => {
    const html = renderApprovalDetail(approval(), [], null);
    expect(html).toContain('name="decidedBy"');
    expect(html).toMatch(/name="note"[^>]*required/);
    expect(html).toContain('value="approved"');
    expect(html).toContain('value="rejected"');
  });

  it("does not render the decide form once a decision has been made", () => {
    const html = renderApprovalDetail(
      approval({ status: "approved", decidedBy: "it.manager@contoso.com", decidedAt: "2026-09-16T12:05:00.000Z", decisionNote: "Looks fine." }),
      [],
      null,
    );
    expect(html).not.toContain('name="decidedBy"');
    expect(html).toContain("it.manager@contoso.com");
    expect(html).toContain("Looks fine.");
  });

  it("shows a decide error", () => {
    const html = renderApprovalDetail(approval(), [], null, { status: "error", code: "self_approval", message: "the requester may not decide their own request" });
    expect(html).toContain('class="error"');
  });

  it("shows a successful approval's execution outcome", () => {
    const outcome: ApprovalOutcome = { approval: approval({ status: "approved" }), execution: { status: "executed", alreadyMember: false } };
    const html = renderApprovalDetail(approval({ status: "approved" }), [], null, { status: "ok", outcome });
    expect(html).toContain('class="ok"');
    expect(html).toMatch(/executed/i);
  });
});

// ---------------------------------------------------------------------------

describe("renderHandoffDetail()", () => {
  it("shows the raw request text directly from the handoff record", () => {
    const html = renderHandoffDetail(handoff(), []);
    expect(html).toContain("my laptop screen is cracked");
  });

  it("flags an urgent handoff at the top of its own page, and an ordinary one not at all", () => {
    expect(renderHandoffDetail(handoff({ urgent: true }), [])).toContain("URGENT");
    expect(renderHandoffDetail(handoff(), [])).not.toContain("URGENT");
  });

  it("shows the reason under 'what it could not do'", () => {
    const html = renderHandoffDetail(handoff(), []);
    expect(html).toContain("needs a replacement device");
  });

  it("renders the trail", () => {
    const html = renderHandoffDetail(handoff(), [trailRecord({ chain: "endpoint", decision: "handoff", tool: null, rules: [] })]);
    expect(html).toContain("endpoint");
    expect(html).toContain("handoff");
  });

  it("renders a take form, with no note field, for an open handoff", () => {
    const html = renderHandoffDetail(handoff({ status: "open" }), []);
    expect(html).toContain('action="/console/handoffs/handoff-1/take"');
    expect(html).toContain('name="takenBy"');
    expect(html).not.toContain('action="/console/handoffs/handoff-1/resolve"');
  });

  it("renders a resolve form, with a required note, for a taken handoff, and shows who took it", () => {
    const html = renderHandoffDetail(handoff({ status: "taken", takenBy: "op@contoso.com", takenAt: "2026-09-16T12:05:00.000Z" }), []);
    expect(html).toContain("op@contoso.com");
    expect(html).toContain('action="/console/handoffs/handoff-1/resolve"');
    expect(html).toMatch(/name="note"[^>]*required/);
    expect(html).not.toContain('name="takenBy"');
  });

  it("renders no form at all for a resolved handoff, and shows the resolution facts", () => {
    const html = renderHandoffDetail(
      handoff({ status: "resolved", takenBy: "op@contoso.com", resolvedBy: "op@contoso.com", resolvedAt: "2026-09-16T12:10:00.000Z", resolutionNote: "replaced the device" }),
      [],
    );
    expect(html).not.toContain("<form");
    expect(html).toContain("replaced the device");
  });

  it("shows a take/resolve error", () => {
    const html = renderHandoffDetail(handoff(), [], { status: "error", code: "not_open", message: "handoff handoff-1 is already taken" });
    expect(html).toContain('class="error"');
    expect(html).toContain("already taken");
  });

  it("shows a successful take outcome", () => {
    const taken = handoff({ status: "taken", takenBy: "op@contoso.com" });
    const html = renderHandoffDetail(taken, [], { status: "ok", handoff: taken });
    expect(html).toContain('class="ok"');
    expect(html).toMatch(/taken by op@contoso\.com/i);
  });
});
