import type { AddressInfo } from "node:net";

import { ApprovalError, type ApprovalDecisionInput, type ApprovalOutcome, type ApprovalRecord } from "@helpdesk/gateway-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  volume: { requestsByDay: [], split: { autonomous: 0, approvalGated: 0, refused: 0, modelDeclined: 0 }, classifierFailures: 0 },
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

describe("web server", () => {
  let server: ReturnType<typeof createWebServer>;
  let baseUrl: string;
  let deps: WebDeps;
  let routeRequest: ReturnType<typeof vi.fn<(input: SubmitRequestInput) => Promise<RouteResult>>>;
  let decide: ReturnType<typeof vi.fn<(input: ApprovalDecisionInput) => Promise<ApprovalOutcome>>>;
  let approvals: Map<string, ApprovalRecord>;

  const post = (path: string, body: Record<string, string>) =>
    fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });

  beforeEach(async () => {
    approvals = new Map([["app-1", approval()]]);
    routeRequest = vi
      .fn<(input: SubmitRequestInput) => Promise<RouteResult>>()
      .mockResolvedValue({ status: "routed", category: "identity", agent: "identity-agent", requestId: "req-9", toolWasCalled: true, reply: "Alice is in Marketing." });
    decide = vi.fn<(input: ApprovalDecisionInput) => Promise<ApprovalOutcome>>();
    deps = {
      routeRequest,
      decide,
      listPendingApprovals: () => [...approvals.values()].filter((a) => a.status === "pending"),
      getApproval: (id) => approvals.get(id) ?? null,
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

  describe("GET /approvals", () => {
    it("lists pending approvals", async () => {
      const res = await fetch(baseUrl + "/approvals");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("app-1");
      expect(text).toContain('href="/approvals/app-1"');
    });

    it("omits an approval once it is decided", async () => {
      approvals.set("app-1", approval({ status: "approved" }));
      const text = await (await fetch(baseUrl + "/approvals")).text();
      expect(text).toMatch(/no pending approvals/i);
    });
  });

  describe("GET /approvals/:id", () => {
    it("shows the detail page for a known approval", async () => {
      const res = await fetch(baseUrl + "/approvals/app-1");
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("add_user_to_group");
    });

    it("404s for an unknown approval", async () => {
      const res = await fetch(baseUrl + "/approvals/does-not-exist");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /approvals/:id/decide", () => {
    it("approves, updates the store, and shows the outcome", async () => {
      const outcome: ApprovalOutcome = {
        approval: approval({ status: "approved", decidedBy: "it.manager@contoso.com", decidedAt: "2026-09-16T12:05:00.000Z", decisionNote: "ok" }),
        execution: { status: "executed", alreadyMember: false },
      };
      decide.mockImplementation(async (input) => {
        approvals.set(input.approvalId, outcome.approval);
        return outcome;
      });

      const res = await post("/approvals/app-1/decide", { decidedBy: "it.manager@contoso.com", decision: "approved", note: "ok" });

      expect(res.status).toBe(200);
      expect(decide).toHaveBeenCalledWith({ approvalId: "app-1", decidedBy: "it.manager@contoso.com", decision: "approved", note: "ok" });
      const text = await res.text();
      expect(text).toMatch(/executed/i);
      expect(text).toContain("it.manager@contoso.com");
    });

    it("shows a self-approval refusal from the workflow, not a generic 500", async () => {
      decide.mockRejectedValue(new ApprovalError("self_approval", "the requester may not decide their own request"));

      const res = await post("/approvals/app-1/decide", {
        decidedBy: "helpdesk.operator@contoso.com",
        decision: "approved",
        note: "approving myself",
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("the requester may not decide their own request");
    });

    it("rejects a malformed decision value before calling decide()", async () => {
      const res = await post("/approvals/app-1/decide", { decidedBy: "it.manager@contoso.com", decision: "maybe", note: "x" });

      expect(res.status).toBe(400);
      expect(decide).not.toHaveBeenCalled();
    });

    it("404s when deciding an unknown approval", async () => {
      const res = await post("/approvals/does-not-exist/decide", { decidedBy: "it.manager@contoso.com", decision: "approved", note: "x" });
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

  it("404s an unrecognised route", async () => {
    const res = await fetch(baseUrl + "/nonsense");
    expect(res.status).toBe(404);
  });
});
