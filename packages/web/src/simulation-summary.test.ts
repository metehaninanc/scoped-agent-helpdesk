import { describe, expect, it } from "vitest";

import { computeSimulationSummary } from "./simulation-summary.js";
import type { TicketResult } from "./simulation-types.js";

function result(overrides: Partial<TicketResult> & { id: string }): TicketResult {
  return {
    sourceFile: "test/sim_records1.json",
    submittedBy: "someone@fake.example",
    actor: "helpdesk.operator@metehantestoutlook.onmicrosoft.com",
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

describe("computeSimulationSummary()", () => {
  it("counts category distribution across all results, including unsupported/triage_failed/error", () => {
    const summary = computeSimulationSummary([
      result({ id: "1", category: "identity" }),
      result({ id: "2", category: "identity" }),
      result({ id: "3", category: "mdm" }),
      result({ id: "4", category: "unsupported", agentInvoked: null }),
      result({ id: "5", category: "triage_failed", agentInvoked: null }),
      result({ id: "6", category: "error", agentInvoked: null, error: "boom" }),
    ]);

    expect(summary.totalTickets).toBe(6);
    expect(summary.categoryDistribution).toEqual(
      expect.arrayContaining([
        { category: "identity", count: 2 },
        { category: "mdm", count: 1 },
        { category: "unsupported", count: 1 },
        { category: "triage_failed", count: 1 },
        { category: "error", count: 1 },
      ]),
    );
    expect(summary.errorCount).toBe(1);
  });

  it("counts a routed ticket that called a tool toward reachedToolCount, not modelDeclinedCount", () => {
    const summary = computeSimulationSummary([result({ id: "1", toolCalled: true })]);

    expect(summary.reachedToolCount).toBe(1);
    expect(summary.modelDeclinedCount).toBe(0);
  });

  it("counts a routed ticket with no tool call toward modelDeclinedCount, and flags a clarifying question by its own reply text", () => {
    const summary = computeSimulationSummary([
      result({ id: "1", toolCalled: false, reply: "Which device do you mean — front-desk-01 or the printer?" }),
      result({ id: "2", toolCalled: false, reply: "This system cannot do that." }),
    ]);

    expect(summary.modelDeclinedCount).toBe(2);
    expect(summary.clarifyingQuestionCount).toBe(1);
  });

  it("never counts unsupported, triage_failed or error toward reachedToolCount or modelDeclinedCount", () => {
    const summary = computeSimulationSummary([
      result({ id: "1", category: "unsupported", agentInvoked: null, toolCalled: false }),
      result({ id: "2", category: "triage_failed", agentInvoked: null, toolCalled: false }),
      result({ id: "3", category: "error", agentInvoked: null, toolCalled: false, error: "boom" }),
    ]);

    expect(summary.reachedToolCount).toBe(0);
    expect(summary.modelDeclinedCount).toBe(0);
  });

  it("tallies refusals by rule, most frequent first, only for routed tickets", () => {
    const summary = computeSimulationSummary([
      result({ id: "1", policyDecision: "denied", policyRules: ["deny.break_glass_user"] }),
      result({ id: "2", policyDecision: "denied", policyRules: ["deny.break_glass_user"] }),
      result({ id: "3", policyDecision: "denied", policyRules: ["deny.group_not_managed"] }),
      result({ id: "4", policyDecision: "autonomous", policyRules: [] }),
    ]);

    expect(summary.refusedCount).toBe(3);
    expect(summary.refusedByRule).toEqual([
      { rule: "deny.break_glass_user", count: 2 },
      { rule: "deny.group_not_managed", count: 1 },
    ]);
  });
});
