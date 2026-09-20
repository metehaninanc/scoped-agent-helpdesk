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
      split: { autonomous: 2, approvalGated: 1, refused: 1, modelDeclined: 1 },
      classifierFailures: 0,
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

  it("renders four outcome buckets, not three, and explains why model-declined is separate from refused", () => {
    const html = renderDashboard(baseData());
    expect(html).toMatch(/model declined/i);
    expect(html).toMatch(/no\s+policy decision was ever made/i);
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
