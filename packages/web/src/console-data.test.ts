import { describe, expect, it } from "vitest";

import type { AuditRecord } from "@helpdesk/audit-core";
import type { ApprovalRecord } from "@helpdesk/gateway-core";
import type { HandoffRecord } from "@helpdesk/handoff-core";

import { approvalRow, getRequestTrail, handoffRow, rawRequestText, sortQueue } from "./console-data.js";

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

describe("approvalRow()", () => {
  it("summarizes add_user_to_group from its own params", () => {
    const row = approvalRow(approval(), new Date("2026-09-16T12:05:00.000Z"));
    expect(row.summary).toBe("Add alice@contoso.com to group 20a26e53-1cbd-48e3-8cc4-8d86cece7a6a");
    expect(row.action).toBe("add_user_to_group");
  });

  it("summarizes remove_user_from_group and reboot_endpoint distinctly", () => {
    const remove = approvalRow(approval({ tool: "remove_user_from_group", params: { userPrincipalName: "bob@contoso.com", groupId: "g-1" } }), new Date());
    expect(remove.summary).toBe("Remove bob@contoso.com from group g-1");

    const reboot = approvalRow(approval({ tool: "reboot_endpoint", params: { endpointId: "ep-front-desk-01" } }), new Date());
    expect(reboot.summary).toBe("Reboot endpoint ep-front-desk-01");
  });

  it("computes age from now minus createdAt", () => {
    const row = approvalRow(approval({ createdAt: "2026-09-16T12:00:00.000Z" }), new Date("2026-09-16T12:10:00.000Z"));
    expect(row.ageMs).toBe(10 * 60_000);
  });

  it("is kind 'approval' and carries the requestId and actor through unchanged", () => {
    const row = approvalRow(approval(), new Date());
    expect(row.kind).toBe("approval");
    expect(row.id).toBe("app-1");
    expect(row.requestId).toBe("req-1");
    expect(row.actor).toBe("alice@contoso.com");
  });
});

describe("handoffRow()", () => {
  it("uses the raw request text as the summary and the reason as the action", () => {
    const row = handoffRow(handoff(), new Date("2026-09-16T12:05:00.000Z"));
    expect(row.kind).toBe("handoff");
    expect(row.summary).toBe("my laptop screen is cracked");
    expect(row.action).toBe("needs a replacement device");
    expect(row.ageMs).toBe(5 * 60_000);
  });

  it("truncates a long request text or reason rather than showing it in full on the row", () => {
    const longText = "a".repeat(200);
    const row = handoffRow(handoff({ requestText: longText, reason: longText }), new Date());
    expect(row.summary.length).toBeLessThan(longText.length);
    expect(row.summary.endsWith("…")).toBe(true);
    expect(row.action.endsWith("…")).toBe(true);
  });
});

describe("sortQueue()", () => {
  it("sorts oldest first by createdAt", () => {
    const rows = [
      approvalRow(approval({ id: "a", createdAt: "2026-09-16T12:02:00.000Z" }), new Date()),
      approvalRow(approval({ id: "b", createdAt: "2026-09-16T12:00:00.000Z" }), new Date()),
      approvalRow(approval({ id: "c", createdAt: "2026-09-16T12:01:00.000Z" }), new Date()),
    ];
    expect(sortQueue(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("puts an urgent handoff above every older non-urgent row, then keeps oldest-first order", () => {
    const now = new Date("2026-09-16T13:00:00.000Z");
    const rows = [
      handoffRow(handoff({ id: "old", createdAt: "2026-09-16T08:00:00.000Z" }), now),
      handoffRow(handoff({ id: "newer", createdAt: "2026-09-16T11:00:00.000Z" }), now),
      handoffRow(handoff({ id: "urgent-late", createdAt: "2026-09-16T12:59:00.000Z", urgent: true }), now),
      handoffRow(handoff({ id: "urgent-early", createdAt: "2026-09-16T12:00:00.000Z", urgent: true }), now),
    ];
    expect(sortQueue(rows).map((r) => r.id)).toEqual(["urgent-early", "urgent-late", "old", "newer"]);
  });

  it("breaks ties by id for a stable order", () => {
    const rows = [
      approvalRow(approval({ id: "z", createdAt: "2026-09-16T12:00:00.000Z" }), new Date()),
      approvalRow(approval({ id: "a", createdAt: "2026-09-16T12:00:00.000Z" }), new Date()),
    ];
    expect(sortQueue(rows).map((r) => r.id)).toEqual(["a", "z"]);
  });
});

// ---------------------------------------------------------------------------

const record = (overrides: Partial<AuditRecord> = {}): AuditRecord => ({
  id: 1,
  timestamp: "2026-09-16T12:00:00.000Z",
  requestId: "req-1",
  actor: "alice@contoso.com",
  agent: "orchestrator",
  tool: null,
  parameters: null,
  decision: "model_usage",
  rules: [],
  result: null,
  prevHash: "x",
  hash: "y",
  ...overrides,
});

function fakeLog(records: AuditRecord[]) {
  return { list: () => records };
}

describe("getRequestTrail()", () => {
  it("collects every record with the matching requestId across every chain given, tagged with its chain", () => {
    const chains = {
      orchestrator: fakeLog([record({ id: 1, requestId: "req-1", decision: "routed" }), record({ id: 2, requestId: "req-2" })]),
      identity: fakeLog([record({ id: 1, requestId: "req-1", decision: "autonomous" })]),
    };

    const trail = getRequestTrail("req-1", chains);

    expect(trail).toHaveLength(2);
    expect(trail.every((r) => r.requestId === "req-1")).toBe(true);
    expect(trail.map((r) => r.chain).sort()).toEqual(["identity", "orchestrator"]);
  });

  it("orders the trail by timestamp, then by id within the same timestamp", () => {
    const chains = {
      identity: fakeLog([
        record({ id: 2, timestamp: "2026-09-16T12:00:02.000Z" }),
        record({ id: 1, timestamp: "2026-09-16T12:00:01.000Z" }),
      ]),
      orchestrator: fakeLog([record({ id: 1, timestamp: "2026-09-16T12:00:01.000Z" })]),
    };

    const trail = getRequestTrail("req-1", chains);

    expect(trail.map((r) => `${r.chain}:${r.id}`)).toEqual(["identity:1", "orchestrator:1", "identity:2"]);
  });

  it("returns an empty trail for a requestId no chain has", () => {
    expect(getRequestTrail("nope", { identity: fakeLog([record()]) })).toEqual([]);
  });
});

describe("rawRequestText()", () => {
  it("reads it from a request record's own string parameters", () => {
    const trail = [{ ...record({ decision: "request", parameters: "which groups is bob in" }), chain: "identity" }];
    expect(rawRequestText(trail)).toBe("which groups is bob in");
  });

  it("reads it from a routed/denied/handoff record's parameters.requestText", () => {
    const trail = [{ ...record({ decision: "handoff", parameters: { requestText: "my laptop is cracked", reason: "x" } }), chain: "orchestrator" }];
    expect(rawRequestText(trail)).toBe("my laptop is cracked");
  });

  it("returns null, not an empty string, when nothing in the trail carries it", () => {
    const trail = [{ ...record({ decision: "model_usage", parameters: null }), chain: "orchestrator" }];
    expect(rawRequestText(trail)).toBeNull();
  });
});
