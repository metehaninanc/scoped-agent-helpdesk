import type { AddressInfo } from "node:net";

import { ApprovalError, type ApprovalDecisionInput, type ApprovalOutcome, type ApprovalRecord } from "@helpdesk/gateway-core";
import { HandoffError, type HandoffRecord } from "@helpdesk/handoff-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TrailRecord } from "./console-data.js";
import type { RationaleActionResult } from "./console-page.js";
import type { DashboardData } from "./dashboard-metrics.js";
import type { RouteResult, SubmitRequestInput } from "./request-page.js";
import { createWebServer, type WebDeps } from "./server.js";

const emptyDashboardData = (): DashboardData => ({
  trust: {
    chains: (["orchestrator", "identity", "mdm", "knowledge", "endpoint"] as const).map((name) => ({
      name,
      totalRecords: 0,
      intact: true,
      break: null,
    })),
    verifiedAt: "2026-09-16T12:00:00.000Z",
  },
  volume: { requestsByDay: [] },
  outcomes: {
    rejectPath: { total: 0, redirected: 0, handedOffResolved: 0, handedOffInProgress: 0 },
    acceptPath: { total: 0, resolved: 0, handedOffResolved: 0, handedOffInProgress: 0, routedButUnresolved: 0, approvalPending: 0, approvalRejected: 0 },
    classifierFailures: 0,
    otherDenied: 0,
    misroutedNote: "not computable from the chains",
  },
  humans: {
    gateways: [
      { gateway: "identity", pendingCount: 0, oldestPendingAgeMs: null, resolvedCount: 0, medianTimeToDecisionMs: null },
      { gateway: "endpoint", pendingCount: 0, oldestPendingAgeMs: null, resolvedCount: 0, medianTimeToDecisionMs: null },
    ],
    totalPending: 0,
    oldestPendingAgeMs: null,
    medianTimeToDecisionMs: null,
  },
  stopped: { refusalReasons: [], classifierFailures: [], passwordReset: { count: 0, note: "note" } },
  cost: {
    components: [],
    totalCostUsd: 0,
    totalRequests: 0,
    averageCostPerRequestUsd: null,
    observedDays: 0,
    estimatedMonthlyCostUsd: null,
    noModelCallShare: null,
  },
});

const approval = (overrides: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
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

describe("web server", () => {
  let server: ReturnType<typeof createWebServer>;
  let baseUrl: string;
  let deps: WebDeps;
  let routeRequest: ReturnType<typeof vi.fn<(input: SubmitRequestInput) => Promise<RouteResult>>>;
  let decide: ReturnType<typeof vi.fn<(input: ApprovalDecisionInput) => Promise<ApprovalOutcome>>>;
  let takeHandoffFn: ReturnType<typeof vi.fn<(id: string, takenBy: string) => HandoffRecord>>;
  let resolveHandoffFn: ReturnType<typeof vi.fn<(id: string, resolvedBy: string, note: string) => HandoffRecord>>;
  let requestRationaleFn: ReturnType<typeof vi.fn<(input: { approvalId: string; requestedBy: string }) => Promise<RationaleActionResult>>>;
  let approvals: Map<string, ApprovalRecord>;
  let handoffs: Map<string, HandoffRecord>;

  const post = (path: string, body: Record<string, string>) =>
    fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });

  beforeEach(async () => {
    approvals = new Map([["app-1", approval()]]);
    handoffs = new Map([["handoff-1", handoff()]]);
    routeRequest = vi
      .fn<(input: SubmitRequestInput) => Promise<RouteResult>>()
      .mockResolvedValue({ status: "routed", category: "identity", agent: "identity-agent", requestId: "req-9", toolWasCalled: true, reply: "Alice is in Marketing." });
    decide = vi.fn<(input: ApprovalDecisionInput) => Promise<ApprovalOutcome>>();
    takeHandoffFn = vi.fn<(id: string, takenBy: string) => HandoffRecord>();
    resolveHandoffFn = vi.fn<(id: string, resolvedBy: string, note: string) => HandoffRecord>();
    requestRationaleFn = vi.fn<(input: { approvalId: string; requestedBy: string }) => Promise<RationaleActionResult>>();
    deps = {
      routeRequest,
      decide,
      request: requestRationaleFn,
      listPendingApprovals: () => [...approvals.values()].filter((a) => a.status === "pending"),
      getApproval: (id) => approvals.get(id) ?? null,
      listActiveHandoffs: () => [...handoffs.values()].filter((h) => h.status === "open" || h.status === "taken"),
      getHandoff: (id) => handoffs.get(id) ?? null,
      takeHandoff: takeHandoffFn,
      resolveHandoff: resolveHandoffFn,
      getRequestTrail: (requestId: string): TrailRecord[] =>
        requestId === "req-1"
          ? [
              {
                id: 1,
                timestamp: "2026-09-16T12:00:00.000Z",
                requestId: "req-1",
                actor: "helpdesk.operator@contoso.com",
                agent: "identity-agent",
                chain: "identity",
                tool: "add_user_to_group",
                parameters: { userPrincipalName: "alice@contoso.com", groupId: "g-1" },
                decision: "approval",
                rules: ["approval.add_user_to_group"],
                result: null,
                prevHash: "x",
                hash: "y",
              },
            ]
          : [],
      getDashboardData: () => emptyDashboardData(),
    };
    server = createWebServer(deps);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  describe("GET /", () => {
    it("serves the request form", async () => {
      const res = await fetch(baseUrl + "/");
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<form");
    });
  });

  describe("POST /", () => {
    it("runs the agent and shows the reply", async () => {
      const res = await post("/", { actor: "alice@contoso.com", requestText: "which groups is alice in" });

      expect(res.status).toBe(200);
      expect(routeRequest).toHaveBeenCalledWith({ actor: "alice@contoso.com", requestText: "which groups is alice in" });
      const text = await res.text();
      expect(text).toContain("Alice is in Marketing.");
      expect(text).toContain("req-9");
    });

    it("rejects an empty identity without routing the request", async () => {
      const res = await post("/", { actor: "", requestText: "hi" });

      expect(res.status).toBe(200);
      expect(routeRequest).not.toHaveBeenCalled();
      expect(await res.text()).toContain("Your identity is required.");
    });
  });

  describe("GET /console", () => {
    it("lists both queues, oldest first", async () => {
      const res = await fetch(baseUrl + "/console");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Approvals waiting (1)");
      expect(text).toContain("Handoffs waiting (1)");
      expect(text).toContain('href="/console/approvals/app-1"');
      expect(text).toContain('href="/console/handoffs/handoff-1"');
    });

    it("reads a clean queue rather than a blank page when both are empty", async () => {
      approvals.clear();
      handoffs.clear();
      const text = await (await fetch(baseUrl + "/console")).text();
      expect(text).toMatch(/no approvals waiting/i);
      expect(text).toMatch(/no handoffs waiting/i);
    });

    it("omits an approval once it is decided", async () => {
      approvals.set("app-1", approval({ status: "approved" }));
      const text = await (await fetch(baseUrl + "/console")).text();
      expect(text).toMatch(/no approvals waiting/i);
    });

    it("omits a handoff once it is resolved", async () => {
      handoffs.set("handoff-1", handoff({ status: "resolved", takenBy: "op@contoso.com", resolvedBy: "op@contoso.com", resolutionNote: "done" }));
      const text = await (await fetch(baseUrl + "/console")).text();
      expect(text).toMatch(/no handoffs waiting/i);
    });
  });

  describe("GET /console/approvals/:id", () => {
    it("shows the detail page for a known approval, including its trail looked up by request id", async () => {
      const res = await fetch(baseUrl + "/console/approvals/app-1");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Approval app-1");
      expect(text).toContain("add_user_to_group");
      expect(text).toContain("approval.add_user_to_group");
    });

    it("404s for an unknown approval", async () => {
      const res = await fetch(baseUrl + "/console/approvals/does-not-exist");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /console/approvals/:id/decide", () => {
    it("approves, updates the store, and shows the outcome", async () => {
      const outcome: ApprovalOutcome = {
        approval: approval({ status: "approved", decidedBy: "it.manager@contoso.com", decidedAt: "2026-09-16T12:05:00.000Z", decisionNote: "ok" }),
        execution: { status: "executed", alreadyMember: false },
      };
      decide.mockImplementation(async (input) => {
        approvals.set(input.approvalId, outcome.approval);
        return outcome;
      });

      const res = await post("/console/approvals/app-1/decide", { decidedBy: "it.manager@contoso.com", decision: "approved", note: "ok" });

      expect(res.status).toBe(200);
      expect(decide).toHaveBeenCalledWith({ approvalId: "app-1", decidedBy: "it.manager@contoso.com", decision: "approved", note: "ok" });
      const text = await res.text();
      expect(text).toMatch(/executed/i);
      expect(text).toContain("it.manager@contoso.com");
    });

    it("shows a self-approval refusal from the workflow, not a generic 500", async () => {
      decide.mockRejectedValue(new ApprovalError("self_approval", "the requester may not decide their own request"));

      const res = await post("/console/approvals/app-1/decide", {
        decidedBy: "helpdesk.operator@contoso.com",
        decision: "approved",
        note: "approving myself",
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("the requester may not decide their own request");
    });

    it("rejects a malformed decision value before calling decide()", async () => {
      const res = await post("/console/approvals/app-1/decide", { decidedBy: "it.manager@contoso.com", decision: "maybe", note: "x" });

      expect(res.status).toBe(400);
      expect(decide).not.toHaveBeenCalled();
    });

    it("404s when deciding an unknown approval", async () => {
      const res = await post("/console/approvals/does-not-exist/decide", { decidedBy: "it.manager@contoso.com", decision: "approved", note: "x" });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /console/approvals/:id/rationale", () => {
    it("requests a briefing and shows the generated text", async () => {
      requestRationaleFn.mockImplementation(async (input) => {
        const updated = approval({ rationale: "What is being requested\n..." });
        approvals.set(input.approvalId, updated);
        return { status: "ok", approval: updated };
      });

      const res = await post("/console/approvals/app-1/rationale", { requestedBy: "it.manager@contoso.com" });

      expect(res.status).toBe(200);
      expect(requestRationaleFn).toHaveBeenCalledWith({ approvalId: "app-1", requestedBy: "it.manager@contoso.com" });
      const text = await res.text();
      expect(text).toContain("Briefing generated.");
      expect(text).toContain("What is being requested");
    });

    it("shows a refusal from the workflow inline, not a generic 500, and leaves the approval as it was", async () => {
      requestRationaleFn.mockResolvedValue({ status: "error", code: "already_generated", message: "approval app-1 already has a briefing" });

      const res = await post("/console/approvals/app-1/rationale", { requestedBy: "it.manager@contoso.com" });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("approval app-1 already has a briefing");
    });

    it("404s when requesting a briefing for an unknown approval", async () => {
      requestRationaleFn.mockResolvedValue({ status: "error", code: "not_found", message: "approval does-not-exist not found" });
      const res = await post("/console/approvals/does-not-exist/rationale", { requestedBy: "it.manager@contoso.com" });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /console/handoffs/:id", () => {
    it("shows the detail page for a known handoff", async () => {
      const res = await fetch(baseUrl + "/console/handoffs/handoff-1");
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("my laptop screen is cracked");
    });

    it("404s for an unknown handoff", async () => {
      const res = await fetch(baseUrl + "/console/handoffs/does-not-exist");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /console/handoffs/:id/take", () => {
    it("takes the handoff and shows the outcome", async () => {
      takeHandoffFn.mockImplementation((id, takenBy) => {
        const updated = handoff({ status: "taken", takenBy, takenAt: "2026-09-16T12:05:00.000Z" });
        handoffs.set(id, updated);
        return updated;
      });

      const res = await post("/console/handoffs/handoff-1/take", { takenBy: "op@contoso.com" });

      expect(res.status).toBe(200);
      expect(takeHandoffFn).toHaveBeenCalledWith("handoff-1", "op@contoso.com");
      const text = await res.text();
      expect(text).toContain("op@contoso.com");
    });

    it("shows a not_open refusal, not a generic 500", async () => {
      takeHandoffFn.mockImplementation(() => {
        throw new HandoffError("not_open", "handoff handoff-1 is already taken");
      });

      const res = await post("/console/handoffs/handoff-1/take", { takenBy: "op@contoso.com" });

      expect(res.status).toBe(200);
      expect(await res.text()).toContain("already taken");
    });

    it("404s when taking an unknown handoff", async () => {
      takeHandoffFn.mockImplementation(() => {
        throw new HandoffError("not_found", "handoff does-not-exist not found");
      });
      const res = await post("/console/handoffs/does-not-exist/take", { takenBy: "op@contoso.com" });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /console/handoffs/:id/resolve", () => {
    it("resolves the handoff and shows the outcome", async () => {
      handoffs.set("handoff-1", handoff({ status: "taken", takenBy: "op@contoso.com", takenAt: "2026-09-16T12:05:00.000Z" }));
      resolveHandoffFn.mockImplementation((id, resolvedBy, note) => {
        const updated = handoff({ status: "resolved", takenBy: "op@contoso.com", resolvedBy, resolvedAt: "2026-09-16T12:10:00.000Z", resolutionNote: note });
        handoffs.set(id, updated);
        return updated;
      });

      const res = await post("/console/handoffs/handoff-1/resolve", { resolvedBy: "op@contoso.com", note: "replaced the device" });

      expect(res.status).toBe(200);
      expect(resolveHandoffFn).toHaveBeenCalledWith("handoff-1", "op@contoso.com", "replaced the device");
      const text = await res.text();
      expect(text).toContain("replaced the device");
    });

    it("shows a note_required refusal, not a generic 500", async () => {
      resolveHandoffFn.mockImplementation(() => {
        throw new HandoffError("note_required", "a resolution note is required");
      });

      const res = await post("/console/handoffs/handoff-1/resolve", { resolvedBy: "op@contoso.com", note: "" });

      expect(res.status).toBe(200);
      expect(await res.text()).toContain("a resolution note is required");
    });

    it("404s when resolving an unknown handoff", async () => {
      resolveHandoffFn.mockImplementation(() => {
        throw new HandoffError("not_found", "handoff does-not-exist not found");
      });
      const res = await post("/console/handoffs/does-not-exist/resolve", { resolvedBy: "op@contoso.com", note: "x" });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /dashboard", () => {
    it("renders the dashboard from getDashboardData()", async () => {
      const res = await fetch(baseUrl + "/dashboard");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<h1>Dashboard</h1>");
      expect(text).toContain("orchestrator");
    });
  });

  it("no longer serves the old /approvals routes", async () => {
    expect((await fetch(baseUrl + "/approvals")).status).toBe(404);
    expect((await fetch(baseUrl + "/approvals/app-1")).status).toBe(404);
  });

  it("404s an unrecognised route", async () => {
    const res = await fetch(baseUrl + "/nonsense");
    expect(res.status).toBe(404);
  });
});
