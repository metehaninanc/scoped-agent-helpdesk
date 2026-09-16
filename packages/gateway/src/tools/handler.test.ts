import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RationaleGenerator } from "../approvals/rationale.js";
import { ApprovalStore } from "../approvals/store.js";
import { AuditLog } from "@helpdesk/audit-core";
import { openDatabase } from "../db.js";
import { GraphError, type AddMemberResult, type GroupSummary } from "../graph/client.js";
import { Rule, type PolicyConfig } from "../policy/types.js";
import { handleToolCall, type GatewayDeps, type SessionContext } from "./handler.js";

// ---------------------------------------------------------------------------

const MARKETING = "20a26e53-1cbd-48e3-8cc4-8d86cece7a6a";
const UNMANAGED = "33333333-3333-4333-8333-333333333333";
const GLOBAL_ADMIN_ROLE = "62e90394-69f5-4237-9190-012177145e10";
const ALICE = "alice@contoso.com";
const BREAK_GLASS = "breakglass1@contoso.com";

const config: PolicyConfig = {
  breakGlassUsers: [BREAK_GLASS],
  managedGroups: [{ id: MARKETING, displayName: "Marketing" }],
  directoryRoleIds: [GLOBAL_ADMIN_ROLE],
};

const session: SessionContext = {
  actor: "helpdesk.operator@contoso.com",
  agent: "identity-agent",
  requestId: "req-1",
};

/** Parse the JSON the tool hands back to the model. */
const payload = (result: Awaited<ReturnType<typeof handleToolCall>>): Record<string, unknown> => {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  return JSON.parse(first.text) as Record<string, unknown>;
};

describe("handleToolCall()", () => {
  let audit: AuditLog;
  let approvals: ApprovalStore;
  let graph: {
    listUserGroups: ReturnType<typeof vi.fn<(upn: string) => Promise<GroupSummary[]>>>;
    addUserToGroup: ReturnType<typeof vi.fn<(upn: string, groupId: string) => Promise<AddMemberResult>>>;
  };
  let deps: GatewayDeps;
  let t: number;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    t = Date.UTC(2026, 8, 15, 12, 0, 0);
    const now = () => new Date((t += 1000));
    audit = new AuditLog(db, { now });
    approvals = new ApprovalStore(db, { now });
    graph = {
      listUserGroups: vi.fn<(upn: string) => Promise<GroupSummary[]>>(async () => [{ id: MARKETING, displayName: "Marketing" }]),
      addUserToGroup: vi.fn<(upn: string, groupId: string) => Promise<AddMemberResult>>(async () => ({ alreadyMember: false })),
    };
    deps = { audit, approvals, graph, config, now };
  });

  afterEach(() => {
    audit.close();
  });

  // -------------------------------------------------------------------------

  describe("call order", () => {
    it("commits the audit record before Graph is called", async () => {
      let recordsWhenGraphRan = -1;
      let headWhenGraphRan: unknown;
      graph.listUserGroups.mockImplementation(async () => {
        recordsWhenGraphRan = audit.list().length;
        headWhenGraphRan = audit.head();
        return [];
      });

      await handleToolCall("list_user_groups", { userPrincipalName: ALICE }, session, deps);

      expect(recordsWhenGraphRan).toBe(1);
      expect(headWhenGraphRan).toEqual({ lastId: 1, lastHash: audit.list()[0]?.hash });
      expect(audit.list()[0]).toMatchObject({ decision: "autonomous", tool: "list_user_groups", result: null });
    });

    it("refuses to act at all if the audit record cannot be written", async () => {
      const broken: GatewayDeps = {
        ...deps,
        audit: {
          append: () => {
            throw new Error("disk full");
          },
        },
      };

      await expect(handleToolCall("list_user_groups", { userPrincipalName: ALICE }, session, broken)).rejects.toThrow(
        "disk full",
      );
      expect(graph.listUserGroups).not.toHaveBeenCalled();
    });

    it("leaves evidence of the decision even when Graph crashes mid-execution", async () => {
      graph.listUserGroups.mockRejectedValue(new Error("socket hang up"));

      const result = await handleToolCall("list_user_groups", { userPrincipalName: ALICE }, session, deps);

      expect(result.isError).toBe(true);
      const records = audit.list();
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ decision: "autonomous", result: null });
      expect(records[1]).toMatchObject({
        decision: "autonomous",
        result: { status: "error", code: "unknown", message: "socket hang up" },
      });
    });
  });

  // -------------------------------------------------------------------------

  describe("autonomous: list_user_groups", () => {
    it("calls Graph, returns the groups, and writes decision and result records", async () => {
      const result = await handleToolCall("list_user_groups", { userPrincipalName: ALICE }, session, deps);

      expect(result.isError).toBeFalsy();
      expect(payload(result)).toEqual({ status: "ok", groups: [{ id: MARKETING, displayName: "Marketing" }] });
      expect(graph.listUserGroups).toHaveBeenCalledWith(ALICE);

      const records = audit.list();
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        requestId: "req-1",
        actor: session.actor,
        agent: "identity-agent",
        tool: "list_user_groups",
        parameters: { userPrincipalName: ALICE },
        decision: "autonomous",
        rules: [],
        result: null,
      });
      expect(records[1]).toMatchObject({
        requestId: "req-1",
        tool: "list_user_groups",
        decision: "autonomous",
        result: { status: "ok", groups: [{ id: MARKETING, displayName: "Marketing" }] },
      });
    });

    it("reports a Graph error as a tool error and records it", async () => {
      graph.listUserGroups.mockRejectedValue(
        new GraphError(404, "Request_ResourceNotFound", "Resource 'alice@contoso.com' does not exist.", "req-abc"),
      );

      const result = await handleToolCall("list_user_groups", { userPrincipalName: ALICE }, session, deps);

      expect(result.isError).toBe(true);
      const expected = {
        status: "error",
        code: "Request_ResourceNotFound",
        message: "Resource 'alice@contoso.com' does not exist.",
        requestId: "req-abc",
      };
      expect(payload(result)).toEqual(expected);
      expect(audit.list()[1]?.result).toEqual(expected);
    });
  });

  // -------------------------------------------------------------------------

  describe("autonomous: list_managed_groups", () => {
    it("returns the allowlist from config, calls no Graph, and is audited twice like any tool", async () => {
      const result = await handleToolCall("list_managed_groups", {}, session, deps);

      expect(result.isError).toBeFalsy();
      expect(payload(result)).toEqual({ status: "ok", groups: [{ id: MARKETING, displayName: "Marketing" }] });
      expect(graph.listUserGroups).not.toHaveBeenCalled();
      expect(graph.addUserToGroup).not.toHaveBeenCalled();

      const records = audit.list();
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ tool: "list_managed_groups", decision: "autonomous", parameters: {}, result: null });
      expect(records[1]).toMatchObject({
        tool: "list_managed_groups",
        decision: "autonomous",
        result: { status: "ok", groups: [{ id: MARKETING, displayName: "Marketing" }] },
      });
    });

    it("treats a missing arguments object as the empty parameter set", async () => {
      const result = await handleToolCall("list_managed_groups", undefined, session, deps);
      expect(payload(result)).toMatchObject({ status: "ok" });
    });

    it("denies and audits a call that smuggles parameters in", async () => {
      const result = await handleToolCall("list_managed_groups", { groupId: MARKETING }, session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
      expect(audit.list()).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------

  describe("approval: add_user_to_group", () => {
    it("creates an approval record, calls nothing, and returns pending_approval", async () => {
      const result = await handleToolCall(
        "add_user_to_group",
        { userPrincipalName: ALICE, groupId: MARKETING },
        session,
        deps,
      );

      expect(result.isError).toBeFalsy();
      const body = payload(result);
      expect(body.status).toBe("pending_approval");
      expect(typeof body.approvalId).toBe("string");

      expect(graph.addUserToGroup).not.toHaveBeenCalled();
      expect(graph.listUserGroups).not.toHaveBeenCalled();

      const pending = approvals.listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        id: body.approvalId,
        requestId: "req-1",
        actor: session.actor,
        tool: "add_user_to_group",
        params: { userPrincipalName: ALICE, groupId: MARKETING },
        rules: [Rule.ApprovalAddUserToGroup],
        status: "pending",
      });

      const records = audit.list();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        decision: "approval",
        rules: [Rule.ApprovalAddUserToGroup],
        tool: "add_user_to_group",
        result: null,
      });
    });

    it("leaves the rationale empty and writes no rationale record when no generator is configured", async () => {
      const result = await handleToolCall("add_user_to_group", { userPrincipalName: ALICE, groupId: MARKETING }, session, deps);

      expect(approvals.get(payload(result).approvalId as string)?.rationale).toBeNull();
      expect(audit.list().map((r) => r.decision)).toEqual(["approval"]);
    });

    it("generates the rationale from the raw facts only, stores it verbatim, and audits it as supporting information", async () => {
      const generate = vi.fn<RationaleGenerator["generate"]>(async () => ({
        text: "What is being requested\n...verbatim, with  odd spacing ",
        model: "claude-opus-5",
        usage: { inputTokens: 210, outputTokens: 55 },
      }));

      const result = await handleToolCall(
        "add_user_to_group",
        { userPrincipalName: ALICE, groupId: MARKETING.toUpperCase() },
        session,
        { ...deps, rationale: { generate } },
      );
      const approvalId = payload(result).approvalId as string;

      // Exactly these facts. No conversation, no wording, no extra keys.
      expect(generate).toHaveBeenCalledTimes(1);
      const facts = generate.mock.calls[0]![0];
      expect(facts).toEqual({
        tool: "add_user_to_group",
        params: { userPrincipalName: ALICE, groupId: MARKETING.toUpperCase() },
        rules: [Rule.ApprovalAddUserToGroup],
        targetUser: ALICE,
        targetGroup: { id: MARKETING, displayName: "Marketing" },
        requestingUser: session.actor,
      });

      expect(approvals.get(approvalId)?.rationale).toBe("What is being requested\n...verbatim, with  odd spacing ");

      const records = audit.list();
      expect(records.map((r) => r.decision)).toEqual(["approval", "rationale"]);
      expect(records[1]).toMatchObject({
        requestId: "req-1",
        actor: session.actor,
        agent: "identity-agent",
        tool: "add_user_to_group",
        parameters: facts,
        rules: [],
        result: {
          approvalId,
          model: "claude-opus-5",
          rationale: "What is being requested\n...verbatim, with  odd spacing ",
          usage: { inputTokens: 210, outputTokens: 55 },
        },
      });
    });

    it("still returns pending_approval, with the approval intact, when the rationale call fails", async () => {
      const generate = vi.fn<RationaleGenerator["generate"]>(async () => {
        throw new Error("Rationale request failed (429): rate limited");
      });
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      try {
        const result = await handleToolCall(
          "add_user_to_group",
          { userPrincipalName: ALICE, groupId: MARKETING },
          session,
          { ...deps, rationale: { generate } },
        );

        expect(result.isError).toBeFalsy();
        const approvalId = payload(result).approvalId as string;
        expect(approvals.get(approvalId)).toMatchObject({ status: "pending", rationale: null });

        const records = audit.list();
        expect(records.map((r) => r.decision)).toEqual(["approval", "rationale"]);
        expect(records[1]?.result).toEqual({ approvalId, error: "Rationale request failed (429): rate limited" });
        expect(stderr).toHaveBeenCalled();
      } finally {
        stderr.mockRestore();
      }
    });

    it("writes the audit record before creating the approval record", async () => {
      let recordsWhenCreated = -1;
      const spying: GatewayDeps = {
        ...deps,
        approvals: {
          create: (input) => {
            recordsWhenCreated = audit.list().length;
            return approvals.create(input);
          },
          setRationale: (id, text) => approvals.setRationale(id, text),
        },
      };

      await handleToolCall("add_user_to_group", { userPrincipalName: ALICE, groupId: MARKETING }, session, spying);

      expect(recordsWhenCreated).toBe(1);
    });
  });

  // -------------------------------------------------------------------------

  describe("denied", () => {
    it.each([
      ["a directory role target", { userPrincipalName: ALICE, groupId: GLOBAL_ADMIN_ROLE }, Rule.DenyDirectoryRoleTarget],
      ["a break glass user", { userPrincipalName: BREAK_GLASS, groupId: MARKETING }, Rule.DenyBreakGlassUser],
      ["an unmanaged group", { userPrincipalName: ALICE, groupId: UNMANAGED }, Rule.DenyGroupNotManaged],
    ])("refuses %s naming the rule, calls nothing, and audits it", async (_label, params, rule) => {
      const result = await handleToolCall("add_user_to_group", params, session, deps);

      expect(result.isError).toBeFalsy();
      const body = payload(result);
      expect(body.status).toBe("denied");
      expect(body.rules).toContain(rule);
      expect(String(body.message)).toContain(rule);

      expect(graph.addUserToGroup).not.toHaveBeenCalled();
      expect(approvals.listPending()).toEqual([]);

      const records = audit.list();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ decision: "denied", tool: "add_user_to_group", parameters: params });
      expect(records[0]?.rules).toContain(rule);
    });

    it("refuses a break glass lookup too", async () => {
      const result = await handleToolCall("list_user_groups", { userPrincipalName: BREAK_GLASS }, session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyBreakGlassUser] });
      expect(graph.listUserGroups).not.toHaveBeenCalled();
    });

    it("audits malformed parameters as a denial, storing the raw input as evidence", async () => {
      const params = { userPrincipalName: ALICE, groupId: "Global Administrator" };
      const result = await handleToolCall("add_user_to_group", params, session, deps);

      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
      expect(audit.list()[0]).toMatchObject({ decision: "denied", parameters: params, rules: [Rule.DenyMalformedParameters] });
      expect(graph.addUserToGroup).not.toHaveBeenCalled();
    });

    it("audits an unknown tool as a denial", async () => {
      const result = await handleToolCall("remove_user_from_group", { userPrincipalName: ALICE }, session, deps);

      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyUnknownTool] });
      expect(audit.list()[0]).toMatchObject({ tool: "remove_user_from_group", decision: "denied" });
    });

    it("survives arguments that are not an object", async () => {
      const result = await handleToolCall("list_user_groups", "alice", session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
      expect(audit.list()[0]).toMatchObject({ decision: "denied", parameters: "alice" });
    });
  });

  // -------------------------------------------------------------------------

  it("stamps every record with the session's requestId, actor and agent", async () => {
    const other: SessionContext = { actor: "bob@contoso.com", agent: "other-agent", requestId: "req-9" };
    await handleToolCall("list_user_groups", { userPrincipalName: ALICE }, other, deps);

    for (const record of audit.list()) {
      expect(record).toMatchObject({ requestId: "req-9", actor: "bob@contoso.com", agent: "other-agent" });
    }
  });

  it("passes the session actor and the clock into the policy context", async () => {
    const decide = vi.fn().mockReturnValue({ outcome: "denied", rules: [Rule.DenyPolicyError] });
    await handleToolCall("list_user_groups", { userPrincipalName: ALICE }, session, { ...deps, decide });

    expect(decide).toHaveBeenCalledWith(
      { tool: "list_user_groups", params: { userPrincipalName: ALICE } },
      { actor: session.actor, agent: session.agent, timestamp: "2026-09-15T12:00:01.000Z" },
      config,
    );
  });
});
