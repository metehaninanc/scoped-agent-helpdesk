import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditLog } from "@helpdesk/audit-core";
import { openDatabase } from "@helpdesk/gateway-core";
import { HandoffStore } from "@helpdesk/handoff-core";

import type { SearchResult } from "../search.js";
import { Rule, type PolicyConfig } from "../policy/types.js";
import type { GatewayDeps } from "./handler.js";
import { GATEWAY_NAME, createGatewayServer } from "./server.js";

// sessionFromExtra() itself is generic MCP wiring, tested once in @helpdesk/gateway-core
// (SPRINT3.md, 3.2); this file tests only what is this gateway's own.

const PASSAGE: SearchResult = {
  sourceTitle: "Learn about group types",
  heading: "Group types",
  text: "Security groups are used to manage access to shared resources.",
  sourceUrl: "https://github.com/MicrosoftDocs/entra-docs/blob/abc123/docs/fundamentals/concept-learn-about-groups.md",
};
const config: PolicyConfig = {};

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> => {
  const [first] = result.content as { type: string; text: string }[];
  return JSON.parse(first!.text) as Record<string, unknown>;
};

describe("knowledge gateway MCP server", () => {
  let audit: AuditLog;
  let client: Client;
  let deps: GatewayDeps;

  beforeEach(async () => {
    const db = openDatabase(":memory:");
    audit = new AuditLog(db);
    deps = { audit, search: vi.fn(() => [PASSAGE]), handoffs: new HandoffStore(db, audit), config };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createGatewayServer(deps).connect(serverTransport);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    audit.close();
  });

  it("identifies itself and advertises search_documentation plus hand_off, each with a closed schema and no ids", async () => {
    expect(client.getServerVersion()?.name).toBe(GATEWAY_NAME);

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toEqual(["search_documentation", "hand_off"]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("runs an autonomous call end to end and audits it twice", async () => {
    const result = await client.callTool({ name: "search_documentation", arguments: { query: "group types" } });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toEqual({ status: "ok", passages: [PASSAGE] });
    expect(audit.list().map((r) => [r.decision, r.result === null])).toEqual([
      ["autonomous", true],
      ["autonomous", false],
    ]);
  });

  it("runs hand_off end to end, autonomous, and audits both the tool call and the handoff's own creation (SPRINT4.md, section 2)", async () => {
    const result = await client.callTool({ name: "hand_off", arguments: { reason: "needs a replacement device" } });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatchObject({ status: "handed_off", handoffId: expect.any(String) });
    // Three records, not two: runToolCall's own policy-decision record, then HandoffStore's own
    // `handoff` record (evidence before the queue row exists), then runToolCall's result record.
    expect(audit.list().map((r) => r.decision)).toEqual(["autonomous", "handoff", "autonomous"]);
  });

  it("audits a malformed call instead of letting the protocol layer reject it", async () => {
    const result = await client.callTool({ name: "search_documentation", arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
    expect(audit.list()).toHaveLength(1);
  });

  it("audits a call to a tool that does not exist", async () => {
    const result = await client.callTool({ name: "delete_documentation", arguments: {} });

    expect(textOf(result)).toMatchObject({ status: "denied", rules: [Rule.DenyUnknownTool] });
    expect(audit.list()[0]).toMatchObject({ tool: "delete_documentation", decision: "denied" });
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
      const result = await brokenClient.callTool({ name: "search_documentation", arguments: { query: "groups" } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatchObject({ status: "error", code: "gateway_unavailable" });
      expect(deps.search).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      await brokenClient.close();
    }
  });
});
