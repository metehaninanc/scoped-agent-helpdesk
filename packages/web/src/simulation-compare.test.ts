import { describe, expect, it } from "vitest";

import {
  buildCategoryComparison,
  buildCostComparison,
  buildOutcomeComparison,
  classifyChange,
  computeHeadlineNumbers,
  computeOutcomeChanges,
} from "./simulation-compare.js";
import type { CostSection } from "./dashboard-metrics.js";
import type { TicketResult } from "./simulation-types.js";

function result(overrides: Partial<TicketResult> & { id: string; sourceFile: string }): TicketResult {
  return {
    submittedBy: "someone@fake.example",
    actor: "alexdesouza@metehantestoutlook.onmicrosoft.com",
    requestId: `req-${overrides.id}`,
    category: "identity",
    partiallyOutOfScope: false,
    agentInvoked: "identity-agent",
    toolCalled: true,
    toolCalls: [],
    toolName: null,
    policyDecision: null,
    policyRules: [],
    reply: "done",
    ...overrides,
  };
}

describe("computeHeadlineNumbers()", () => {
  it("counts identity tickets that reached add_user_to_group", () => {
    const results = [
      result({ id: "1", sourceFile: "a", category: "identity", toolCalls: [{ tool: "add_user_to_group", decision: "approval", rules: [] }] }),
      result({ id: "2", sourceFile: "a", category: "identity", toolCalls: [{ tool: "list_user_groups", decision: "autonomous", rules: [] }] }),
      result({ id: "3", sourceFile: "a", category: "identity", toolCalled: false }),
    ];
    expect(computeHeadlineNumbers(results).identityReachedAddUserToGroup).toBe(1);
  });

  it("counts endpoint replies naming a managed stub hostname, and not ones that don't", () => {
    const results = [
      result({ id: "1", sourceFile: "a", category: "endpoint", reply: "front-desk-01 is online." }),
      result({ id: "2", sourceFile: "a", category: "endpoint", reply: "That device is not one this system manages." }),
      result({ id: "3", sourceFile: "a", category: "identity", reply: "front-desk-01 mentioned but wrong category" }),
    ];
    expect(computeHeadlineNumbers(results).endpointNamedStubDevice).toBe(1);
  });
});

describe("buildCategoryComparison()", () => {
  it("compares counts per category across both passes, including a category present in only one", () => {
    const pass1 = [result({ id: "1", sourceFile: "a", category: "identity" }), result({ id: "2", sourceFile: "a", category: "unsupported" })];
    const pass2 = [result({ id: "1", sourceFile: "a", category: "identity" }), result({ id: "2", sourceFile: "a", category: "knowledge" })];

    const comparison = buildCategoryComparison(pass1, pass2);

    expect(comparison).toEqual(
      expect.arrayContaining([
        { label: "identity", pass1: 1, pass2: 1, delta: 0 },
        { label: "unsupported", pass1: 1, pass2: 0, delta: -1 },
        { label: "knowledge", pass1: 0, pass2: 1, delta: 1 },
      ]),
    );
  });
});

describe("buildOutcomeComparison()", () => {
  it("computes reachedTool/modelDeclined/refused deltas and per-rule refusal deltas", () => {
    const pass1 = [
      result({ id: "1", sourceFile: "a", toolCalled: true }),
      result({ id: "2", sourceFile: "a", toolCalled: false }),
      result({ id: "3", sourceFile: "a", toolCalled: true, policyDecision: "denied", policyRules: ["deny.group_not_managed"] }),
    ];
    const pass2 = [
      result({ id: "1", sourceFile: "a", toolCalled: true }),
      result({ id: "2", sourceFile: "a", toolCalled: true }),
      result({ id: "3", sourceFile: "a", toolCalled: true, policyDecision: "denied", policyRules: ["deny.group_not_managed"] }),
    ];

    const comparison = buildOutcomeComparison(pass1, pass2);

    expect(comparison.reachedTool).toEqual({ label: "Reached a tool", pass1: 2, pass2: 3, delta: 1 });
    expect(comparison.modelDeclined).toEqual({ label: "Model declined", pass1: 1, pass2: 0, delta: -1 });
    expect(comparison.refused).toEqual({ label: "Refused by rule", pass1: 1, pass2: 1, delta: 0 });
    expect(comparison.refusedByRule).toEqual([{ rule: "deny.group_not_managed", pass1: 1, pass2: 1, delta: 0 }]);
  });

  it("excludes unsupported/triage_failed/error from reachedTool and modelDeclined, on both sides", () => {
    const pass1 = [result({ id: "1", sourceFile: "a", category: "unsupported", toolCalled: false })];
    const pass2 = [result({ id: "1", sourceFile: "a", category: "error", toolCalled: false })];

    const comparison = buildOutcomeComparison(pass1, pass2);

    expect(comparison.reachedTool).toEqual({ label: "Reached a tool", pass1: 0, pass2: 0, delta: 0 });
    expect(comparison.modelDeclined).toEqual({ label: "Model declined", pass1: 0, pass2: 0, delta: 0 });
  });
});

describe("buildCostComparison()", () => {
  const cost = (overrides: Partial<CostSection> = {}): CostSection => ({
    components: [],
    totalCostUsd: 0,
    totalRequests: 0,
    averageCostPerRequestUsd: null,
    observedDays: 1,
    estimatedMonthlyCostUsd: null,
    noModelCallShare: null,
    ...overrides,
  });

  it("compares total cost and per-component cost, defaulting a missing component to 0", () => {
    const pass1 = cost({ totalCostUsd: 1, components: [{ component: "triage", inputTokens: 0, outputTokens: 0, costUsd: 1, unpriced: [] }] });
    const pass2 = cost({
      totalCostUsd: 1.5,
      components: [
        { component: "triage", inputTokens: 0, outputTokens: 0, costUsd: 0.5, unpriced: [] },
        { component: "rationale", inputTokens: 0, outputTokens: 0, costUsd: 1, unpriced: [] },
      ],
    });

    const comparison = buildCostComparison(pass1, pass2);

    expect(comparison.totalCostUsd).toEqual({ pass1: 1, pass2: 1.5, delta: 0.5 });
    expect(comparison.byComponent).toEqual(
      expect.arrayContaining([
        { component: "triage", pass1: 1, pass2: 0.5, delta: -0.5 },
        { component: "rationale", pass1: 0, pass2: 1, delta: 1 },
      ]),
    );
  });
});

describe("classifyChange()", () => {
  const sig = (overrides: Partial<Parameters<typeof classifyChange>[0]>) => ({
    category: "identity" as const,
    toolCalled: false,
    toolName: null,
    policyDecision: null,
    ...overrides,
  });

  it("classifies a stall-to-resolved change as improved", () => {
    expect(classifyChange(sig({ toolCalled: false }), sig({ toolCalled: true }))).toBe("improved");
  });

  it("classifies unsupported-to-real-category as improved", () => {
    expect(classifyChange(sig({ category: "unsupported" }), sig({ category: "knowledge" }))).toBe("improved");
  });

  it("classifies a resolved-to-stall change as regressed", () => {
    expect(classifyChange(sig({ toolCalled: true }), sig({ toolCalled: false }))).toBe("regressed");
  });

  it("classifies real-category-to-unsupported as regressed", () => {
    expect(classifyChange(sig({ category: "identity" }), sig({ category: "unsupported" }))).toBe("regressed");
  });

  it("classifies a same-toolCalled, different-category move between two real categories as changed", () => {
    expect(classifyChange(sig({ category: "identity", toolCalled: true }), sig({ category: "mdm", toolCalled: true }))).toBe("changed");
  });
});

describe("computeOutcomeChanges()", () => {
  it("only reports tickets whose signature actually differs, and only for keys present in both passes", () => {
    const pass1 = [
      result({ id: "1", sourceFile: "a", toolCalled: true }),
      result({ id: "2", sourceFile: "a", toolCalled: false }),
      result({ id: "3", sourceFile: "a", toolCalled: false }), // only in pass1
    ];
    const pass2 = [
      result({ id: "1", sourceFile: "a", toolCalled: true }), // unchanged
      result({ id: "2", sourceFile: "a", toolCalled: true }), // changed: improved
      result({ id: "4", sourceFile: "a", toolCalled: true }), // only in pass2
    ];

    const changes = computeOutcomeChanges(pass1, pass2);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ sourceFile: "a", id: "2", classification: "improved" });
  });
});
