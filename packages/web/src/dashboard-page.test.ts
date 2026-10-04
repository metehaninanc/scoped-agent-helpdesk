import { describe, expect, it } from "vitest";

import type { DashboardData } from "./dashboard-metrics.js";
import { renderDashboard } from "./dashboard-page.js";

function baseData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    trust: {
      chains: [
        { name: "orchestrator", totalRecords: 1, intact: true, break: null },
        { name: "identity", totalRecords: 1, intact: true, break: null },
        { name: "mdm", totalRecords: 0, intact: true, break: null },
        { name: "knowledge", totalRecords: 0, intact: true, break: null },
        { name: "endpoint", totalRecords: 0, intact: true, break: null },
      ],
      verifiedAt: "2026-09-20T00:00:00.000Z",
    },
    volume: {
      requestsByDay: [{ day: "2026-09-19", count: 3 }],
    },
    outcomes: {
      rejectPath: { total: 2, redirected: 1, handedOffResolved: 1, handedOffInProgress: 0 },
      acceptPath: {
        total: 3,
        resolved: 2,
        handedOffResolved: 0,
        handedOffInProgress: 0,
        routedButUnresolved: 1,
        approvalPending: 0,
        approvalRejected: 0,
      },
      classifierFailures: 0,
      otherDenied: 0,
      misroutedNote: "Not computable from the chains. Only a ground-truth-labelled evaluation can measure this.",
    },
    humans: {
      gateways: [
        { gateway: "identity", pendingCount: 1, oldestPendingAgeMs: 60_000, resolvedCount: 2, medianTimeToDecisionMs: 120_000 },
        { gateway: "endpoint", pendingCount: 0, oldestPendingAgeMs: null, resolvedCount: 0, medianTimeToDecisionMs: null },
      ],
      totalPending: 1,
      oldestPendingAgeMs: 60_000,
      medianTimeToDecisionMs: 120_000,
    },
    stopped: {
      refusalReasons: [{ rule: "deny.break_glass_user", count: 3 }],
      classifierFailures: [],
      passwordReset: { count: 2, note: "Estimated from triage routed request text." },
    },
    cost: {
      components: [{ component: "triage", inputTokens: 1000, outputTokens: 100, costUsd: 0.0015, unpriced: [] }],
      totalCostUsd: 0.0015,
      totalRequests: 3,
      averageCostPerRequestUsd: 0.0005,
      observedDays: 2,
      estimatedMonthlyCostUsd: 0.0225,
      noModelCallShare: 0.25,
    },
    ...overrides,
  };
}

describe("renderDashboard()", () => {
  it("shows an intact chain as OK and a broken one as BROKEN, naming the record and reason", () => {
    const data = baseData();
    data.trust.chains[1] = { name: "identity", totalRecords: 5, intact: false, break: { index: 2, id: 3, reason: "hash_mismatch" } };

    const html = renderDashboard(data);

    expect(html).toContain(">OK<");
    expect(html).toContain("BROKEN");
    expect(html).toContain("record 3");
    expect(html).toContain("hash_mismatch");
  });

  it("states the verification is live, on this render", () => {
    const html = renderDashboard(baseData());
    expect(html).toMatch(/verified just now/i);
    expect(html).toContain("2026-09-20T00:00:00.000Z");
  });

  it("reports the reject path and accept path as separate figures, each with its own total", () => {
    const html = renderDashboard(baseData());
    expect(html).toContain("Reject path — triage said not IT or needs a human (2)");
    expect(html).toContain("Accept path — triage routed it to an agent (3)");
  });

  it("shows a handoff still in progress separately from one that was resolved", () => {
    const html = renderDashboard(baseData());
    expect(html).toMatch(/handed off, resolved/i);
    expect(html).toMatch(/handed off, still in progress/i);
  });

  it("shows approval pending and approval rejected on their own, not folded into resolved", () => {
    const html = renderDashboard(baseData());
    expect(html).toMatch(/approval pending/i);
    expect(html).toMatch(/approval rejected/i);
  });

  it("names misrouted as a gap rather than showing a fabricated count", () => {
    const html = renderDashboard(baseData());
    expect(html).toContain("Misrouted");
    expect(html).toMatch(/not computable from the chains/i);
  });

  it("reports a classifier failure separately from both paths, only when one occurred", () => {
    const clean = renderDashboard(baseData());
    expect(clean).not.toMatch(/could not be classified/i);

    const data = baseData();
    data.outcomes.classifierFailures = 2;
    const html = renderDashboard(data);
    expect(html).toMatch(/2 request\(s\) could not be classified/i);
  });

  it("reports an unrecognized denial rule separately, only when one occurred, rather than a silent gap", () => {
    const clean = renderDashboard(baseData());
    expect(clean).not.toMatch(/does not recognize/i);

    const data = baseData();
    data.outcomes.otherDenied = 6;
    const html = renderDashboard(data);
    expect(html).toMatch(/6 older denial\(s\)/i);
    expect(html).toMatch(/does\s+not recognize/i);
  });

  it("calls out an unpriced model by name instead of silently showing $0", () => {
    const data = baseData();
    data.cost.components[0] = {
      component: "mdm-agent",
      inputTokens: 500,
      outputTokens: 500,
      costUsd: 0,
      unpriced: [{ model: "some-future-model", count: 1, inputTokens: 500, outputTokens: 500 }],
    };

    const html = renderDashboard(data);

    expect(html).toContain("some-future-model");
    expect(html).toMatch(/not priced at \$0/i);
  });

  it("says plainly when there is not enough history for a monthly estimate", () => {
    const data = baseData();
    data.cost.estimatedMonthlyCostUsd = null;

    const html = renderDashboard(data);

    expect(html).toMatch(/not enough history/i);
  });

  it("renders the password-reset estimate and its sourcing note", () => {
    const html = renderDashboard(baseData());
    expect(html).toContain(">2<");
    expect(html).toContain("Estimated from triage routed request text.");
  });

  it("states its own lack of authentication rather than implying a protection that does not exist", () => {
    const html = renderDashboard(baseData());
    expect(html).toMatch(/not linked from the request form/i);
    expect(html).toMatch(/no\s+authentication of its own/i);
  });
});
