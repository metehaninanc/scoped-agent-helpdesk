import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditLog } from "@helpdesk/audit-core";
import { openDatabase } from "@helpdesk/gateway-core";
import { HandoffStore } from "@helpdesk/handoff-core";
import { GraphError, type DeviceSummary } from "@helpdesk/identity-gateway";

import { Rule, type PolicyConfig } from "../policy/types.js";
import { handleToolCall, type GatewayDeps, type SessionContext } from "./handler.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const config: PolicyConfig = {};

const session: SessionContext = {
  actor: "helpdesk.operator@contoso.com",
  agent: "mdm-agent",
  requestId: "req-1",
  requestText: "test request",
};

const payload = (result: Awaited<ReturnType<typeof handleToolCall>>): Record<string, unknown> => {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  return JSON.parse(first.text) as Record<string, unknown>;
};

describe("handleToolCall()", () => {
  let audit: AuditLog;
  let graph: {
    listDevices: ReturnType<typeof vi.fn<() => Promise<DeviceSummary[]>>>;
    getDevice: ReturnType<typeof vi.fn<(id: string) => Promise<DeviceSummary>>>;
  };
  let deps: GatewayDeps;
  let t: number;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    t = Date.UTC(2026, 8, 17, 12, 0, 0);
    const now = () => new Date((t += 1000));
    audit = new AuditLog(db, { now });
    graph = {
      listDevices: vi.fn<() => Promise<DeviceSummary[]>>(async () => [
        { id: DEVICE, displayName: "alice-laptop", operatingSystem: "Windows", isCompliant: true },
      ]),
      getDevice: vi.fn<(id: string) => Promise<DeviceSummary>>(async (id) => ({
        id,
        displayName: "alice-laptop",
        operatingSystem: "Windows",
        isCompliant: true,
      })),
    };
    deps = { audit, graph, handoffs: new HandoffStore(db, audit, { now }), config, now };
  });

  afterEach(() => {
    audit.close();
  });

  describe("call order", () => {
    it("commits the audit record before Graph is called", async () => {
      let recordsWhenGraphRan = -1;
      graph.listDevices.mockImplementation(async () => {
        recordsWhenGraphRan = audit.list().length;
        return [];
      });

      await handleToolCall("list_devices", {}, session, deps);

      expect(recordsWhenGraphRan).toBe(1);
      expect(audit.list()[0]).toMatchObject({ decision: "autonomous", tool: "list_devices", result: null });
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

      await expect(handleToolCall("list_devices", {}, session, broken)).rejects.toThrow("disk full");
      expect(graph.listDevices).not.toHaveBeenCalled();
    });

    it("leaves evidence of the decision even when Graph crashes mid-execution", async () => {
      graph.listDevices.mockRejectedValue(new Error("socket hang up"));

      const result = await handleToolCall("list_devices", {}, session, deps);

      expect(result.isError).toBe(true);
      const records = audit.list();
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ decision: "autonomous", result: null });
      expect(records[1]).toMatchObject({ decision: "autonomous", result: { status: "error", code: "unknown", message: "socket hang up" } });
    });
  });

  describe("autonomous: list_devices", () => {
    it("calls Graph, returns the devices, and writes decision and result records", async () => {
      const result = await handleToolCall("list_devices", {}, session, deps);

      expect(result.isError).toBeFalsy();
      expect(payload(result)).toEqual({
        status: "ok",
        devices: [{ id: DEVICE, displayName: "alice-laptop", operatingSystem: "Windows", isCompliant: true }],
      });

      const records = audit.list();
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ requestId: "req-1", tool: "list_devices", decision: "autonomous", rules: [], result: null });
      expect(records[1]).toMatchObject({ tool: "list_devices", decision: "autonomous" });
    });

    it("treats a missing arguments object as the empty parameter set", async () => {
      const result = await handleToolCall("list_devices", undefined, session, deps);
      expect(payload(result)).toMatchObject({ status: "ok" });
    });

    it("denies and audits a call that smuggles parameters in", async () => {
      const result = await handleToolCall("list_devices", { deviceId: DEVICE }, session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
      expect(audit.list()).toHaveLength(1);
    });

    it("reports a Graph error as a tool error and records it", async () => {
      graph.listDevices.mockRejectedValue(new GraphError(403, "Authorization_RequestDenied", "Insufficient privileges."));

      const result = await handleToolCall("list_devices", {}, session, deps);

      expect(result.isError).toBe(true);
      expect(payload(result)).toEqual({ status: "error", code: "Authorization_RequestDenied", message: "Insufficient privileges." });
    });
  });

  describe("autonomous: get_device", () => {
    it("calls Graph with the given id and returns the device", async () => {
      const result = await handleToolCall("get_device", { deviceId: DEVICE }, session, deps);

      expect(result.isError).toBeFalsy();
      expect(payload(result)).toEqual({
        status: "ok",
        device: { id: DEVICE, displayName: "alice-laptop", operatingSystem: "Windows", isCompliant: true },
      });
      expect(graph.getDevice).toHaveBeenCalledWith(DEVICE);
    });

    it("reports a Graph 404 as a tool error rather than a policy denial", async () => {
      graph.getDevice.mockRejectedValue(new GraphError(404, "Request_ResourceNotFound", "Resource does not exist."));

      const result = await handleToolCall("get_device", { deviceId: DEVICE }, session, deps);

      expect(payload(result)).toMatchObject({ status: "error", code: "Request_ResourceNotFound" });
    });

    it("denies a malformed device id instead of calling Graph", async () => {
      const result = await handleToolCall("get_device", { deviceId: "alice-laptop" }, session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
      expect(graph.getDevice).not.toHaveBeenCalled();
    });
  });

  describe("denied", () => {
    it("audits an unknown tool as a denial and calls nothing", async () => {
      const result = await handleToolCall("remove_device", {}, session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyUnknownTool] });
      expect(audit.list()[0]).toMatchObject({ tool: "remove_device", decision: "denied" });
      expect(graph.listDevices).not.toHaveBeenCalled();
      expect(graph.getDevice).not.toHaveBeenCalled();
    });

    it("audits an identity-gateway tool name as unknown here too", async () => {
      const result = await handleToolCall("add_user_to_group", {}, session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyUnknownTool] });
    });

    it("survives arguments that are not an object", async () => {
      const result = await handleToolCall("get_device", "not-an-object", session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
      expect(audit.list()[0]).toMatchObject({ decision: "denied", parameters: "not-an-object" });
    });
  });

  describe("no approval path", () => {
    it("fails loudly instead of silently executing, if decide() ever returns approval", async () => {
      const decide = vi.fn().mockReturnValue({ outcome: "approval", rules: [] });
      const result = await handleToolCall("list_devices", {}, session, { ...deps, decide });

      expect(result.isError).toBe(true);
      expect(payload(result)).toMatchObject({ status: "error", code: "unsupported" });
      expect(graph.listDevices).not.toHaveBeenCalled();
    });
  });

  it("stamps every record with the session's requestId, actor and agent", async () => {
    const other: SessionContext = { actor: "bob@contoso.com", agent: "other-agent", requestId: "req-9", requestText: "test request" };
    await handleToolCall("list_devices", {}, other, deps);

    for (const record of audit.list()) {
      expect(record).toMatchObject({ requestId: "req-9", actor: "bob@contoso.com", agent: "other-agent" });
    }
  });
});
