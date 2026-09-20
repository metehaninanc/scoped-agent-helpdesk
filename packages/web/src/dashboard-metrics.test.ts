import type { AuditRecord, ChainBreak } from "@helpdesk/audit-core";
import { describe, expect, it } from "vitest";

import {
  PASSWORD_RESET_REQUEST_PATTERN,
  computeDashboardData,
  type ChainSnapshot,
  type DashboardInput,
} from "./dashboard-metrics.js";

let nextId = 1;

function rec(overrides: Partial<AuditRecord> & { decision: AuditRecord["decision"] }): AuditRecord {
  return {
    id: nextId++,
    timestamp: "2026-09-16T12:00:00.000Z",
    requestId: "req-1",
    actor: "alice@contoso.com",
    agent: "identity-agent",
    tool: null,
    parameters: null,
    rules: [],
    result: null,
    prevHash: "prev",
    hash: "hash",
    ...overrides,
  };
}

function chain(records: AuditRecord[], chainBreak: ChainBreak | null = null): ChainSnapshot {
  return { records, chainBreak };
}

const EMPTY: ChainSnapshot = chain([]);

function baseInput(overrides: Partial<DashboardInput> = {}): DashboardInput {
  return {
    orchestrator: EMPTY,
    identity: EMPTY,
    mdm: EMPTY,
    knowledge: EMPTY,
    endpoint: EMPTY,
    now: new Date("2026-09-20T00:00:00.000Z"),
    ...overrides,
  };
}

describe("computeDashboardData() — trust", () => {
  it("reports total records and intact status per chain, verified as of this render", () => {
    const now = new Date("2026-09-20T00:00:00.000Z");
    const data = computeDashboardData(
      baseInput({
        identity: chain([rec({ decision: "autonomous" }), rec({ decision: "autonomous", result: { ok: true } })]),
        now,
      }),
    );

    const identity = data.trust.chains.find((c) => c.name === "identity")!;
    expect(identity.totalRecords).toBe(2);
    expect(identity.intact).toBe(true);
    expect(identity.break).toBeNull();
    expect(data.trust.verifiedAt).toBe(now.toISOString());
  });

  it("surfaces a broken chain's reason rather than just a boolean", () => {
    const brokenChain: ChainBreak = { index: 0, id: 3, reason: "hash_mismatch" };
    const data = computeDashboardData(baseInput({ endpoint: chain([rec({ decision: "autonomous" })], brokenChain) }));

    const endpoint = data.trust.chains.find((c) => c.name === "endpoint")!;
    expect(endpoint.intact).toBe(false);
    expect(endpoint.break).toEqual(brokenChain);
  });
});

describe("computeDashboardData() — volume", () => {
  it("buckets orchestrator-level requests by day from routed and denied records only", () => {
    const data = computeDashboardData(
      baseInput({
        orchestrator: chain([
          rec({ decision: "routed", agent: "orchestrator", timestamp: "2026-09-18T10:00:00.000Z" }),
          rec({ decision: "denied", agent: "orchestrator", rules: ["triage.unsupported"], timestamp: "2026-09-18T11:00:00.000Z" }),
          rec({ decision: "routed", agent: "orchestrator", timestamp: "2026-09-19T09:00:00.000Z" }),
          rec({ decision: "model_usage", agent: "orchestrator", timestamp: "2026-09-19T09:00:01.000Z" }),
        ]),
      }),
    );

    expect(data.volume.requestsByDay).toEqual([
      { day: "2026-09-18", count: 2 },
      { day: "2026-09-19", count: 1 },
    ]);
  });

  it("counts each autonomous tool call once despite the two audit records tool-call.ts writes for it", () => {
    const data = computeDashboardData(
      baseInput({
        identity: chain([
          rec({ decision: "autonomous", tool: "list_user_groups", result: null }),
          rec({ decision: "autonomous", tool: "list_user_groups", result: { status: "ok" } }),
        ]),
      }),
    );

    expect(data.volume.split.autonomous).toBe(1);
  });

  it("splits refused into triage-level and gateway-level, and keeps the model's own decline as its own bucket", () => {
    const data = computeDashboardData(
      baseInput({
        orchestrator: chain([rec({ decision: "denied", agent: "orchestrator", rules: ["triage.unsupported"] })]),
        identity: chain([
          rec({ decision: "denied", tool: "add_user_to_group", rules: ["deny.break_glass_user"] }),
          rec({ decision: "approval", tool: "add_user_to_group", rules: ["approval.add_user_to_group"] }),
        ]),
        endpoint: chain([rec({ decision: "no_tool_called", agent: "endpoint-agent", result: "SSPR guidance" })]),
      }),
    );

    expect(data.volume.split).toEqual({ autonomous: 0, approvalGated: 1, refused: 2, modelDeclined: 1 });
  });

  it("excludes a triage operational failure from the split and reports it separately", () => {
    const data = computeDashboardData(
      baseInput({
        orchestrator: chain([rec({ decision: "denied", agent: "orchestrator", rules: ["triage.request_failed"] })]),
      }),
    );

    expect(data.volume.split.refused).toBe(0);
    expect(data.volume.classifierFailures).toBe(1);
  });
});

describe("computeDashboardData() — humans", () => {
  it("ages a pending approval from its approval-decision timestamp to now", () => {
    const data = computeDashboardData(
      baseInput({
        identity: chain([rec({ decision: "approval", requestId: "req-1", timestamp: "2026-09-19T00:00:00.000Z" })]),
        now: new Date("2026-09-20T00:00:00.000Z"),
      }),
    );

    const identity = data.humans.gateways.find((g) => g.gateway === "identity")!;
    expect(identity.pendingCount).toBe(1);
    expect(identity.oldestPendingAgeMs).toBe(24 * 60 * 60 * 1000);
    expect(data.humans.totalPending).toBe(1);
  });

  it("times a resolved approval from its approval-decision to its approved/rejected verdict, by requestId", () => {
    const data = computeDashboardData(
      baseInput({
        endpoint: chain([
          rec({ decision: "approval", requestId: "req-2", timestamp: "2026-09-19T00:00:00.000Z" }),
          rec({ decision: "approved", requestId: "req-2", agent: "approval-workflow", timestamp: "2026-09-19T00:30:00.000Z" }),
        ]),
      }),
    );

    const endpoint = data.humans.gateways.find((g) => g.gateway === "endpoint")!;
    expect(endpoint.resolvedCount).toBe(1);
    expect(endpoint.medianTimeToDecisionMs).toBe(30 * 60 * 1000);
    expect(endpoint.pendingCount).toBe(0);
  });

  it("never produces approval stats for mdm or knowledge, which never emit an approval decision", () => {
    const data = computeDashboardData(baseInput());
    expect(data.humans.gateways.map((g) => g.gateway).sort()).toEqual(["endpoint", "identity"]);
  });
});

describe("computeDashboardData() — stopped", () => {
  it("tallies deny rules and triage.unsupported as refusal reasons, most frequent first", () => {
    const data = computeDashboardData(
      baseInput({
        identity: chain([
          rec({ decision: "denied", rules: ["deny.break_glass_user"] }),
          rec({ decision: "denied", rules: ["deny.break_glass_user"] }),
          rec({ decision: "denied", rules: ["deny.group_not_managed"] }),
        ]),
        orchestrator: chain([rec({ decision: "denied", agent: "orchestrator", rules: ["triage.unsupported"] })]),
      }),
    );

    // Equal counts break ties by chain-iteration order (orchestrator before the four gateways) —
    // a deterministic, if arbitrary, tiebreak, not a claim that one matters more than the other.
    expect(data.stopped.refusalReasons).toEqual([
      { rule: "deny.break_glass_user", count: 2 },
      { rule: "triage.unsupported", count: 1 },
      { rule: "deny.group_not_managed", count: 1 },
    ]);
  });

  it("keeps triage operational failures out of refusalReasons entirely", () => {
    const data = computeDashboardData(
      baseInput({
        orchestrator: chain([
          rec({ decision: "denied", agent: "orchestrator", rules: ["triage.invalid_output"] }),
          rec({ decision: "denied", agent: "orchestrator", rules: ["triage.request_failed"] }),
        ]),
      }),
    );

    expect(data.stopped.refusalReasons).toEqual([]);
    expect(data.stopped.classifierFailures.sort((a, b) => a.rule.localeCompare(b.rule))).toEqual([
      { rule: "triage.invalid_output", count: 1 },
      { rule: "triage.request_failed", count: 1 },
    ]);
  });

  it("counts a password-reset-worded request routed to the endpoint category, and not a plain one", () => {
    const data = computeDashboardData(
      baseInput({
        orchestrator: chain([
          rec({
            decision: "routed",
            agent: "orchestrator",
            parameters: { requestText: "please reset my password, I'm locked out", category: "endpoint" },
          }),
          rec({
            decision: "routed",
            agent: "orchestrator",
            parameters: { requestText: "is printer-3 online", category: "endpoint" },
          }),
          rec({
            decision: "routed",
            agent: "orchestrator",
            // Same wording, wrong category: identity's own "reset" (e.g. group membership) must not count.
            parameters: { requestText: "reset my password please", category: "identity" },
          }),
        ]),
      }),
    );

    expect(data.stopped.passwordReset.count).toBe(1);
    expect(data.stopped.passwordReset.note).toMatch(/deny\.password_reset_never_automated/);
  });

  it("PASSWORD_RESET_REQUEST_PATTERN matches common phrasings, including reversed word order", () => {
    expect(PASSWORD_RESET_REQUEST_PATTERN.test("I forgot my password")).toBe(true);
    expect(PASSWORD_RESET_REQUEST_PATTERN.test("can you reset alice's password")).toBe(true);
    expect(PASSWORD_RESET_REQUEST_PATTERN.test("please do a password reset for bob")).toBe(true);
    expect(PASSWORD_RESET_REQUEST_PATTERN.test("is the printer on the third floor working")).toBe(false);
  });
});

describe("computeDashboardData() — cost", () => {
  it("breaks usage down per component rather than only as one total", () => {
    const data = computeDashboardData(
      baseInput({
        orchestrator: chain([
          rec({ decision: "model_usage", agent: "orchestrator", result: { model: "claude-haiku-4-5-20251001", inputTokens: 1_000_000, outputTokens: 100_000 } }),
        ]),
        identity: chain([
          rec({ decision: "model_usage", agent: "identity-agent", result: { model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 100_000 } }),
        ]),
      }),
    );

    const triage = data.cost.components.find((c) => c.component === "triage")!;
    const identityAgent = data.cost.components.find((c) => c.component === "identity-agent")!;
    // haiku: $1 in + $0.5 out = $1.50; sonnet: $2 in + $1 out = $3.00.
    expect(triage.costUsd).toBeCloseTo(1.5, 6);
    expect(identityAgent.costUsd).toBeCloseTo(3.0, 6);
    expect(data.cost.totalCostUsd).toBeCloseTo(4.5, 6);
  });

  it("reads rationale usage from result.usage, not from a model_usage record, and skips a failed generation with none", () => {
    const data = computeDashboardData(
      baseInput({
        identity: chain([
          rec({ decision: "rationale", result: { approvalId: "a1", model: "claude-opus-5", rationale: "text", usage: { inputTokens: 200, outputTokens: 100 } } }),
          rec({ decision: "rationale", result: { approvalId: "a2", error: "timeout" } }),
        ]),
      }),
    );

    const rationale = data.cost.components.find((c) => c.component === "rationale")!;
    expect(rationale.inputTokens).toBe(200);
    expect(rationale.outputTokens).toBe(100);
  });

  it("names an unpriced model's usage instead of silently costing it at zero", () => {
    const data = computeDashboardData(
      baseInput({
        mdm: chain([
          rec({ decision: "model_usage", agent: "mdm-agent", result: { model: "some-future-model", inputTokens: 500, outputTokens: 500 } }),
        ]),
      }),
    );

    const mdmAgent = data.cost.components.find((c) => c.component === "mdm-agent")!;
    expect(mdmAgent.costUsd).toBe(0);
    expect(mdmAgent.unpriced).toEqual([{ model: "some-future-model", count: 1, inputTokens: 500, outputTokens: 500 }]);
  });

  it("counts a decision with zero model_usage records in its chain toward noModelCallShare", () => {
    const data = computeDashboardData(
      baseInput({
        endpoint: chain([
          // An unauthenticated/malformed call straight to the gateway: denied, no agent turn, no model_usage record at all.
          rec({ decision: "denied", requestId: "req-raw", agent: "unknown", rules: ["deny.missing_token"] }),
          // A normal, agent-mediated decision: has its own model_usage sibling under the same requestId.
          rec({ decision: "autonomous", requestId: "req-normal", tool: "list_endpoints", result: null }),
          rec({ decision: "autonomous", requestId: "req-normal", tool: "list_endpoints", result: { status: "ok" } }),
          rec({ decision: "model_usage", requestId: "req-normal", agent: "endpoint-agent", result: { model: "claude-sonnet-5", inputTokens: 10, outputTokens: 10 } }),
        ]),
      }),
    );

    expect(data.cost.noModelCallShare).toBe(0.5);
  });

  it("computes average cost per request from total priced cost and the total number of orchestrator requests", () => {
    const data = computeDashboardData(
      baseInput({
        orchestrator: chain([rec({ decision: "routed", agent: "orchestrator" }), rec({ decision: "denied", agent: "orchestrator", rules: ["triage.unsupported"] })]),
        identity: chain([
          rec({ decision: "model_usage", agent: "identity-agent", result: { model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 0 } }),
        ]),
      }),
    );

    expect(data.cost.totalRequests).toBe(2);
    expect(data.cost.averageCostPerRequestUsd).toBeCloseTo(1.0, 6); // $2 total / 2 requests
  });

  it("does not estimate a monthly total from under a day of observed history", () => {
    const data = computeDashboardData(
      baseInput({
        orchestrator: chain([
          rec({ decision: "routed", agent: "orchestrator", timestamp: "2026-09-19T00:00:00.000Z" }),
          rec({ decision: "routed", agent: "orchestrator", timestamp: "2026-09-19T02:00:00.000Z" }),
        ]),
      }),
    );

    expect(data.cost.estimatedMonthlyCostUsd).toBeNull();
  });
});
