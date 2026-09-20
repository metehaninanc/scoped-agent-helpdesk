import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditLog } from "@helpdesk/audit-core";
import { ApprovalStore, openDatabase } from "@helpdesk/gateway-core";

import { Rule, type PolicyConfig } from "../policy/types.js";
import { createEndpointService, type EndpointService } from "../stub/endpoint-service.js";
import { handleToolCall, type GatewayDeps, type SessionContext } from "./handler.js";

const ENDPOINT = "ep-front-desk-01";
const config: PolicyConfig = {};

const session: SessionContext = {
  actor: "helpdesk.operator@contoso.com",
  agent: "endpoint-agent",
  requestId: "req-1",
};

const payload = (result: Awaited<ReturnType<typeof handleToolCall>>): Record<string, unknown> => {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  return JSON.parse(first.text) as Record<string, unknown>;
};

describe("handleToolCall()", () => {
  let audit: AuditLog;
  let approvals: ApprovalStore;
  let stub: EndpointService;
  let deps: GatewayDeps;
  let t: number;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    t = Date.UTC(2026, 8, 19, 12, 0, 0);
    const now = () => new Date((t += 1000));
    audit = new AuditLog(db, { now });
    approvals = new ApprovalStore(db, { now });
    stub = createEndpointService({
      now,
      seed: [{ id: ENDPOINT, hostname: "front-desk-01", status: "online", lastCheckInAt: now().toISOString() }],
    });
    deps = { audit, approvals, stub, config, now };
  });

  afterEach(() => {
    audit.close();
  });

  describe("autonomous: list_endpoints", () => {
    it("returns the fleet and writes decision and result records", async () => {
      const result = await handleToolCall("list_endpoints", {}, session, deps);

      expect(result.isError).toBeFalsy();
      expect(payload(result)).toMatchObject({ status: "ok", endpoints: [{ id: ENDPOINT }] });

      const records = audit.list();
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ requestId: "req-1", tool: "list_endpoints", decision: "autonomous", rules: [] });
    });

    it("treats a missing arguments object as the empty parameter set", async () => {
      const result = await handleToolCall("list_endpoints", undefined, session, deps);
      expect(payload(result)).toMatchObject({ status: "ok" });
    });

    it("denies and audits a call that smuggles parameters in, without touching the stub", async () => {
      const result = await handleToolCall("list_endpoints", { endpointId: ENDPOINT }, session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
      expect(audit.list()).toHaveLength(1);
    });
  });

  describe("autonomous: get_endpoint", () => {
    it("returns the endpoint by id", async () => {
      const result = await handleToolCall("get_endpoint", { endpointId: ENDPOINT }, session, deps);
      expect(payload(result)).toMatchObject({ status: "ok", endpoint: { id: ENDPOINT, hostname: "front-desk-01" } });
    });

    it("returns null for an unknown id rather than an error", async () => {
      const result = await handleToolCall("get_endpoint", { endpointId: "ep-does-not-exist" }, session, deps);
      expect(payload(result)).toEqual({ status: "ok", endpoint: null });
    });
  });

  describe("approval: reboot_endpoint", () => {
    it("creates a pending approval and never touches the stub", async () => {
      const result = await handleToolCall("reboot_endpoint", { endpointId: ENDPOINT }, session, deps);

      expect(payload(result)).toMatchObject({ status: "pending_approval" });
      expect(approvals.listPending()).toHaveLength(1);
      expect(approvals.listPending()[0]).toMatchObject({
        requestId: "req-1",
        actor: "helpdesk.operator@contoso.com",
        tool: "reboot_endpoint",
        params: { endpointId: ENDPOINT },
        rules: [Rule.ApprovalRebootEndpoint],
        rationale: null,
      });

      const endpoint = await stub.getEndpoint(ENDPOINT);
      expect(endpoint?.status).toBe("online");
    });

    it("audits the approval decision before creating the record", async () => {
      await handleToolCall("reboot_endpoint", { endpointId: ENDPOINT }, session, deps);
      expect(audit.list()).toHaveLength(1);
      expect(audit.list()[0]).toMatchObject({ decision: "approval", rules: [Rule.ApprovalRebootEndpoint] });
    });
  });

  describe("denied: reset_password, never automated", () => {
    it("denies it by its own named rule and points to SSPR, then the manager", async () => {
      const result = await handleToolCall("reset_password", { userPrincipalName: "alice@contoso.com" }, session, deps);

      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyPasswordResetNeverAutomated] });
      const message = (payload(result) as { message: string }).message;
      expect(message).toContain("Self-Service Password Reset");
      expect(message).toContain("your manager if SSPR is not available");
    });

    it("audits the refusal and calls nothing", async () => {
      await handleToolCall("reset_password", { userPrincipalName: "alice@contoso.com" }, session, deps);

      expect(audit.list()).toHaveLength(1);
      expect(audit.list()[0]).toMatchObject({
        tool: "reset_password",
        decision: "denied",
        rules: [Rule.DenyPasswordResetNeverAutomated],
      });
    });

    it.each(["alice@contoso.com", "it.manager@contoso.com", "someone.else@contoso.com"])(
      "denies it for %s the same way — no target user reaches a different outcome",
      async (userPrincipalName) => {
        const result = await handleToolCall("reset_password", { userPrincipalName }, session, deps);
        expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyPasswordResetNeverAutomated] });
      },
    );
  });

  describe("denied", () => {
    it("audits an unknown tool as a denial and calls nothing", async () => {
      const result = await handleToolCall("delete_endpoint", {}, session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyUnknownTool] });
      expect(audit.list()[0]).toMatchObject({ tool: "delete_endpoint", decision: "denied" });
    });

    it("survives arguments that are not an object", async () => {
      const result = await handleToolCall("get_endpoint", "not-an-object", session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
      expect(audit.list()[0]).toMatchObject({ decision: "denied", parameters: "not-an-object" });
    });
  });

  it("stamps every record with the session's requestId, actor and agent", async () => {
    const other: SessionContext = { actor: "bob@contoso.com", agent: "other-agent", requestId: "req-9" };
    await handleToolCall("list_endpoints", {}, other, deps);

    for (const record of audit.list()) {
      expect(record).toMatchObject({ requestId: "req-9", actor: "bob@contoso.com", agent: "other-agent" });
    }
  });
});
