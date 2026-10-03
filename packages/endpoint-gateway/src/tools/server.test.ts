import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApprovalStore, openDatabase } from "@helpdesk/gateway-core";
import { HandoffStore } from "@helpdesk/handoff-core";
import { AuditLog } from "@helpdesk/audit-core";
import { Rule, type PolicyConfig } from "../policy/types.js";
import { createEndpointService } from "../stub/endpoint-service.js";
import type { GatewayDeps } from "./handler.js";
import { GATEWAY_NAME, createGatewayServer } from "./server.js";

// sessionFromExtra() itself is generic MCP wiring, tested once in @helpdesk/gateway-core
// (SPRINT3.md, 3.2); this file tests only what is this gateway's own.

const ENDPOINT = "ep-front-desk-01";
const config: PolicyConfig = {};

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> => {
  const [first] = result.content as { type: string; text: string }[];
  return JSON.parse(first!.text) as Record<string, unknown>;
};

describe("gateway MCP server", () => {
  let audit: AuditLog;
  let approvals: ApprovalStore;
  let client: Client;
  let deps: GatewayDeps;

  beforeEach(async () => {
    const db = openDatabase(":memory:");
    audit = new AuditLog(db);
    approvals = new ApprovalStore(db);
    deps = {
      audit,
      approvals,
      handoffs: new HandoffStore(db, audit),
      stub: createEndpointService({ seed: [{ id: ENDPOINT, hostname: "front-desk-01", status: "online", lastCheckInAt: "2026-09-19T00:00:00.000Z" }] }),
      config,
    };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createGatewayServer(deps).connect(serverTransport);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    audit.close();
  });

  it("identifies itself and advertises the four SPRINT3.md tools plus hand_off, each with a closed schema and no ids", async () => {
    expect(client.getServerVersion()?.name).toBe(GATEWAY_NAME);

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toEqual(["list_endpoints", "get_endpoint", "reboot_endpoint", "reset_password", "hand_off"]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description).not.toContain(ENDPOINT);
    }
  });

  it("runs hand_off end to end, autonomous, and audits both the tool call and the handoff's own creation (SPRINT4.md, section 2)", async () => {
    const result = await client.callTool({ name: "hand_off", arguments: { reason: "needs a replacement device" } });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatchObject({ status: "handed_off", handoffId: expect.any(String) });
    expect(audit.list().map((r) => r.decision)).toEqual(["autonomous", "handoff", "autonomous"]);
  });

  it("runs an autonomous read end to end and audits it twice", async () => {
    const result = await client.callTool({ name: "list_endpoints", arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatchObject({ status: "ok", endpoints: [{ id: ENDPOINT }] });
    expect(audit.list().map((r) => [r.decision, r.result === null])).toEqual([
      ["autonomous", true],
      ["autonomous", false],
    ]);
  });

  it("returns pending_approval as a normal result and leaves an approval record", async () => {
    const result = await client.callTool({ name: "reboot_endpoint", arguments: { endpointId: ENDPOINT } });

    expect(result.isError).toBeFalsy();
    const body = textOf(result);
    expect(body.status).toBe("pending_approval");
    expect(approvals.get(body.approvalId as string)?.status).toBe("pending");
  });

  it("denies reset_password with its own named rule, end to end, and leaves no approval record", async () => {
    const result = await client.callTool({ name: "reset_password", arguments: { userPrincipalName: "alice@contoso.com" } });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatchObject({ status: "denied", rules: [Rule.DenyPasswordResetNeverAutomated] });
    expect(approvals.listPending()).toEqual([]);
    expect(audit.list()).toHaveLength(1);
    expect(audit.list()[0]).toMatchObject({ tool: "reset_password", decision: "denied", rules: [Rule.DenyPasswordResetNeverAutomated] });
  });

  it("audits a malformed call instead of letting the protocol layer reject it", async () => {
    const result = await client.callTool({ name: "get_endpoint", arguments: { endpointId: 7 } });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
    expect(audit.list()).toHaveLength(1);
  });

  it("audits a call to a tool that does not exist", async () => {
    const result = await client.callTool({ name: "delete_endpoint", arguments: {} });

    expect(textOf(result)).toMatchObject({ status: "denied", rules: [Rule.DenyUnknownTool] });
    expect(audit.list()[0]).toMatchObject({ tool: "delete_endpoint", decision: "denied" });
  });

  it("audits a call with no arguments at all", async () => {
    const result = await client.callTool({ name: "get_endpoint" });

    expect(textOf(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
    expect(audit.list()).toHaveLength(1);
  });

  it("reports an audit failure as gateway_unavailable and does nothing", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const broken: GatewayDeps = {
      ...deps,
      audit: {
        append: () => {
          throw new Error("disk full");
        },
      },
    };
    await createGatewayServer(broken).connect(serverTransport);
    const brokenClient = new Client({ name: "test-client", version: "0.0.0" });
    await brokenClient.connect(clientTransport);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      const result = await brokenClient.callTool({ name: "list_endpoints", arguments: {} });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatchObject({ status: "error", code: "gateway_unavailable" });
      expect(stderr).toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      await brokenClient.close();
    }
  });
});
