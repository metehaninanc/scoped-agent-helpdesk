import { describe, expect, it } from "vitest";

import {
  buildCategoryComparison,
  buildCostComparison,
  buildOutcomeComparison,
  classifyChange,
  computeHeadlineNumbers,
  computeOutcomeChanges,
  filterChainToRequestIds,
  renderComparisonMarkdown,
  renderOutcomesComparisonMarkdown,
  requestIdsOf,
  type PassOutcomes,
} from "./simulation-compare.js";
import type { AuditRecord } from "@helpdesk/audit-core";
import type { CostSection, OutcomesSection } from "./dashboard-metrics.js";
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

  const resolved = sig({ toolCalled: true, policyDecision: "autonomous" });
  const redirected = sig({ category: "not_it" });
  const handedOffByTriage = sig({ category: "needs_human" });
  const handedOffByAgent = sig({ toolCalled: true, toolName: "hand_off", policyDecision: "autonomous" });
  const approvalPending = sig({ toolCalled: true, policyDecision: "approval" });
  const deadEnd = sig({ toolCalled: false }); // routedButUnresolved: reached an agent, nothing came of it
  const deniedDeadEnd = sig({ toolCalled: true, policyDecision: "denied" });
  const classifierFailed = sig({ category: "triage_failed" });
  const runnerError = sig({ category: "error" });

  it("classifies a dead end reaching any working outcome as improved", () => {
    expect(classifyChange(deadEnd, resolved)).toBe("improved");
    expect(classifyChange(deadEnd, redirected)).toBe("improved");
    expect(classifyChange(deadEnd, handedOffByTriage)).toBe("improved");
    expect(classifyChange(deadEnd, approvalPending)).toBe("improved");
  });

  it("classifies a working outcome falling to a dead end as regressed", () => {
    expect(classifyChange(resolved, deadEnd)).toBe("regressed");
    expect(classifyChange(handedOffByAgent, deniedDeadEnd)).toBe("regressed");
  });

  it("classifies unsupported the same as its successor not_it (SPRINT4.md, section 1): reaching it from a dead end is improved", () => {
    expect(classifyChange(deadEnd, sig({ category: "unsupported" }))).toBe("improved");
  });

  it("does not treat a resolved-to-redirected move as a regression — a redirect is not worse than a resolution, only different", () => {
    expect(classifyChange(resolved, redirected)).toBe("changed");
  });

  it("classifies an operational fault as worse than a dead end, in either direction", () => {
    expect(classifyChange(classifierFailed, deadEnd)).toBe("improved");
    expect(classifyChange(deadEnd, runnerError)).toBe("regressed");
  });

  it("classifies an operational fault reaching a working outcome as improved", () => {
    expect(classifyChange(runnerError, resolved)).toBe("improved");
    expect(classifyChange(resolved, classifierFailed)).toBe("regressed");
  });

  it("does not rank the four working outcomes against each other — the fix for the pass-two/pass-three regression bug", () => {
    // The bug this replaced: a tool call that resolved nothing (an mdm lookup against this
    // tenant's permanently empty device directory) used to outrank a needs_human handoff simply
    // because toolCalled was true. Both are tier-2, working outcomes now — reaching one from the
    // other is "changed, direction not asserted," never "regressed," and reading the actual reply
    // text is what decides which one was really better (see the root README's own account).
    expect(classifyChange(resolved, handedOffByTriage)).toBe("changed");
    expect(classifyChange(resolved, handedOffByAgent)).toBe("changed");
    expect(classifyChange(handedOffByTriage, redirected)).toBe("changed");
    expect(classifyChange(approvalPending, resolved)).toBe("changed");
  });

  it("classifies a same-tier move between two real categories as changed", () => {
    expect(classifyChange(sig({ category: "identity", toolCalled: true, policyDecision: "autonomous" }), sig({ category: "mdm", toolCalled: true, policyDecision: "autonomous" }))).toBe(
      "changed",
    );
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
      result({ id: "2", sourceFile: "a", toolCalled: true, policyDecision: "autonomous" }), // changed: improved
      result({ id: "4", sourceFile: "a", toolCalled: true }), // only in pass2
    ];

    const changes = computeOutcomeChanges(pass1, pass2);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ sourceFile: "a", id: "2", classification: "improved" });
  });
});

describe("renderComparisonMarkdown()", () => {
  it("labels each side by its own pass, not a hardcoded 'pass one'/'pass two' — SPRINT4.md, section 6 compares pass two against pass three", () => {
    const empty = buildOutcomeComparison([], []);
    const headline = computeHeadlineNumbers([]);
    const cost = { totalCostUsd: { pass1: 0, pass2: 0, delta: 0 }, byComponent: [] };

    const markdown = renderComparisonMarkdown([], empty, headline, headline, cost, [], "pass two", "pass three");

    expect(markdown).toContain("# Simulation comparison: pass two vs pass three");
    expect(markdown).toContain("| Metric | Pass two | Pass three | Delta |");
    expect(markdown).not.toContain("pass one");
  });

  it("defaults to pass one vs pass two when no labels are given, unchanged from before section 6", () => {
    const empty = buildOutcomeComparison([], []);
    const headline = computeHeadlineNumbers([]);
    const cost = { totalCostUsd: { pass1: 0, pass2: 0, delta: 0 }, byComponent: [] };

    const markdown = renderComparisonMarkdown([], empty, headline, headline, cost, []);

    expect(markdown).toContain("# Simulation comparison: pass one vs pass two");
  });
});

describe("renderOutcomesComparisonMarkdown()", () => {
  const outcomes = (overrides: Partial<OutcomesSection> = {}): OutcomesSection => ({
    rejectPath: { total: 0, redirected: 0, handedOffResolved: 0, handedOffInProgress: 0 },
    acceptPath: { total: 0, resolved: 0, handedOffResolved: 0, handedOffInProgress: 0, routedButUnresolved: 0, approvalPending: 0, approvalRejected: 0 },
    classifierFailures: 0,
    otherDenied: 0,
    misroutedNote: "not computable",
    ...overrides,
  });

  it("renders every pass given as its own column, in order, across both paths", () => {
    const passes: PassOutcomes[] = [
      { label: "pass one", outcomes: outcomes({ rejectPath: { total: 41, redirected: 41, handedOffResolved: 0, handedOffInProgress: 0 } }), misrouted: null },
      { label: "pass three", outcomes: outcomes({ rejectPath: { total: 20, redirected: 15, handedOffResolved: 0, handedOffInProgress: 5 } }), misrouted: 12 },
    ];

    const markdown = renderOutcomesComparisonMarkdown(passes);

    expect(markdown).toContain("| Outcome | pass one | pass three |");
    expect(markdown).toContain("| Total | 41 | 20 |");
    expect(markdown).toContain("| Redirected | 41 | 15 |");
  });

  it("shows 'not scored' for a pass with no hand-scored misrouted count, and the real count for one that has it", () => {
    const passes: PassOutcomes[] = [
      { label: "pass one", outcomes: outcomes(), misrouted: null },
      { label: "pass three", outcomes: outcomes(), misrouted: 12 },
    ];

    const markdown = renderOutcomesComparisonMarkdown(passes);

    expect(markdown).toContain("| Misrouted | not scored | 12 |");
  });

  it("reports the reject path and accept path as two separate tables", () => {
    const passes: PassOutcomes[] = [{ label: "pass three", outcomes: outcomes(), misrouted: 0 }];
    const markdown = renderOutcomesComparisonMarkdown(passes);
    expect(markdown).toContain("## Reject path");
    expect(markdown).toContain("## Accept path");
  });
});

describe("requestIdsOf() / filterChainToRequestIds()", () => {
  const result = (overrides: Partial<TicketResult> & { id: string; sourceFile: string }): TicketResult => ({
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
  });

  const rec = (requestId: string): AuditRecord => ({
    id: 1,
    timestamp: "2026-09-16T12:00:00.000Z",
    requestId,
    actor: "alice@contoso.com",
    agent: "orchestrator",
    tool: null,
    parameters: null,
    decision: "routed",
    rules: [],
    result: null,
    prevHash: "x",
    hash: "y",
  });

  it("collects every non-null requestId a pass's own results claim", () => {
    const results = [
      result({ id: "1", sourceFile: "a", requestId: "req-1" }),
      result({ id: "2", sourceFile: "a", requestId: "req-2" }),
      result({ id: "3", sourceFile: "a", requestId: null, category: "error" }),
    ];
    expect(requestIdsOf(results)).toEqual(new Set(["req-1", "req-2"]));
  });

  it("drops a record whose requestId is not in the valid set — an orphaned, interrupted attempt", () => {
    const snapshot = { records: [rec("req-1"), rec("req-orphan"), rec("req-2")], chainBreak: null };
    const filtered = filterChainToRequestIds(snapshot, new Set(["req-1", "req-2"]));
    expect(filtered.records.map((r) => r.requestId)).toEqual(["req-1", "req-2"]);
  });

  it("leaves chainBreak untouched — integrity is a property of the real, whole chain, never a filtered view", () => {
    const brk = { index: 0, id: 3, reason: "hash_mismatch" as const };
    const snapshot = { records: [rec("req-1")], chainBreak: brk };
    const filtered = filterChainToRequestIds(snapshot, new Set(["req-1"]));
    expect(filtered.chainBreak).toBe(brk);
  });
});
