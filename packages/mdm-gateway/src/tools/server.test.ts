import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditLog } from "@helpdesk/audit-core";
import { openDatabase } from "@helpdesk/gateway";

import { Rule, type PolicyConfig } from "../policy/types.js";
import type { GatewayDeps, SessionContext } from "./handler.js";
import { GATEWAY_NAME, createGatewayServer } from "./server.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const config: PolicyConfig = {};
const session: SessionContext = { actor: "helpdesk.operator@contoso.com", agent: "mdm-agent", requestId: "req-1" };

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> => {
  const [first] = result.content as { type: string; text: string }[];
  return JSON.parse(first!.text) as Record<string, unknown>;
};

describe("MDM gateway MCP server", () => {
  let audit: AuditLog;
  let client: Client;
  let deps: GatewayDeps;

  beforeEach(async () => {
    const db = openDatabase(":memory:");
    audit = new AuditLog(db);
    deps = {
      audit,
      graph: {
        listDevices: vi.fn(async () => [{ id: DEVICE, displayName: "alice-laptop", operatingSystem: "Windows", isCompliant: true }]),
        getDevice: vi.fn(async () => ({ id: DEVICE, displayName: "alice-laptop", operatingSystem: "Windows", isCompliant: true })),
      },
      config,
    };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createGatewayServer(session, deps).connect(serverTransport);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    audit.close();
  });

  it("identifies itself and advertises exactly the two tools with closed schemas and no ids", async () => {
    expect(client.getServerVersion()?.name).toBe(GATEWAY_NAME);

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toEqual(["list_devices", "get_device"]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("runs an autonomous call end to end and audits it twice", async () => {
    const result = await client.callTool({ name: "list_devices", arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toEqual({
      status: "ok",
      devices: [{ id: DEVICE, displayName: "alice-laptop", operatingSystem: "Windows", isCompliant: true }],
    });
    expect(audit.list().map((r) => [r.decision, r.result === null])).toEqual([
      ["autonomous", true],
      ["autonomous", false],
    ]);
  });

  it("looks up one device by id", async () => {
    const result = await client.callTool({ name: "get_device", arguments: { deviceId: DEVICE } });
    expect(textOf(result)).toEqual({
      status: "ok",
      device: { id: DEVICE, displayName: "alice-laptop", operatingSystem: "Windows", isCompliant: true },
    });
  });

  it("audits a malformed call instead of letting the protocol layer reject it", async () => {
    const result = await client.callTool({ name: "get_device", arguments: { deviceId: "not-a-guid" } });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
    expect(audit.list()).toHaveLength(1);
  });

  it("audits a call to a tool that does not exist", async () => {
    const result = await client.callTool({ name: "delete_device", arguments: {} });

    expect(textOf(result)).toMatchObject({ status: "denied", rules: [Rule.DenyUnknownTool] });
    expect(audit.list()[0]).toMatchObject({ tool: "delete_device", decision: "denied" });
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
    await createGatewayServer(session, broken).connect(serverTransport);
    const brokenClient = new Client({ name: "test-client", version: "0.0.0" });
    await brokenClient.connect(clientTransport);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      const result = await brokenClient.callTool({ name: "list_devices", arguments: {} });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatchObject({ status: "error", code: "gateway_unavailable" });
      expect(deps.graph.listDevices).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      await brokenClient.close();
    }
  });
});
