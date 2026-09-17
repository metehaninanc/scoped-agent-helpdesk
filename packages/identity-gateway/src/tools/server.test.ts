import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApprovalStore } from "../approvals/store.js";
import { AuditLog } from "@helpdesk/audit-core";
import { openDatabase } from "../db.js";
import { Rule, type PolicyConfig } from "../policy/types.js";
import type { GatewayDeps } from "./handler.js";
import { GATEWAY_NAME, createGatewayServer, sessionFromExtra, type ToolCallExtra } from "./server.js";

const MARKETING = "20a26e53-1cbd-48e3-8cc4-8d86cece7a6a";
const ALICE = "alice@contoso.com";

const config: PolicyConfig = {
  breakGlassUsers: ["breakglass1@contoso.com"],
  managedGroups: [{ id: MARKETING, displayName: "Marketing" }],
  directoryRoleIds: [],
};

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> => {
  const [first] = result.content as { type: string; text: string }[];
  return JSON.parse(first!.text) as Record<string, unknown>;
};

describe("sessionFromExtra()", () => {
  const extra = (over: Partial<ToolCallExtra>): ToolCallExtra => ({ signal: new AbortController().signal, ...over }) as ToolCallExtra;

  it("takes the agent identity from the validated token's client id, never a header", () => {
    const session = sessionFromExtra(
      extra({
        authInfo: { token: "x", clientId: "22222222-2222-4222-8222-222222222222", scopes: ["Gateway.Invoke"] },
        requestInfo: { headers: { "x-actor": "alice@contoso.com", "x-request-id": "req-1" } },
      }),
    );
    expect(session).toEqual({ actor: "alice@contoso.com", agent: "22222222-2222-4222-8222-222222222222", requestId: "req-1" });
  });

  it("takes actor and requestId from headers, never from authInfo", () => {
    const session = sessionFromExtra(
      extra({
        authInfo: { token: "x", clientId: "22222222-2222-4222-8222-222222222222", scopes: [] },
        requestInfo: { headers: { "x-actor": "bob@contoso.com", "x-request-id": "req-2", "x-other": "ignored" } },
      }),
    );
    expect(session.actor).toBe("bob@contoso.com");
    expect(session.requestId).toBe("req-2");
  });

  it("falls back to a placeholder when authInfo or requestInfo is absent, rather than throwing", () => {
    expect(sessionFromExtra(extra({}))).toEqual({ actor: "unknown", agent: "unknown", requestId: "unknown" });
  });

  it("takes the first value when a header repeats", () => {
    const session = sessionFromExtra(extra({ requestInfo: { headers: { "x-actor": ["first@contoso.com", "second@contoso.com"] } } }));
    expect(session.actor).toBe("first@contoso.com");
  });
});

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
      graph: {
        listUserGroups: vi.fn(async () => [{ id: MARKETING, displayName: "Marketing" }]),
        addUserToGroup: vi.fn(async () => ({ alreadyMember: false })),
        removeUserFromGroup: vi.fn(async () => undefined),
      },
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

  it("identifies itself and advertises exactly the four tools with closed schemas and no ids", async () => {
    expect(client.getServerVersion()?.name).toBe(GATEWAY_NAME);

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toEqual([
      "list_user_groups",
      "list_managed_groups",
      "add_user_to_group",
      "remove_user_from_group",
    ]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description).not.toContain(MARKETING);
    }
  });

  it("serves the allowlist through list_managed_groups and audits the lookup", async () => {
    const result = await client.callTool({ name: "list_managed_groups", arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toEqual({ status: "ok", groups: [{ id: MARKETING, displayName: "Marketing" }] });
    expect(audit.list().map((r) => [r.tool, r.decision])).toEqual([
      ["list_managed_groups", "autonomous"],
      ["list_managed_groups", "autonomous"],
    ]);
  });

  it("runs an autonomous call end to end and audits it twice", async () => {
    const result = await client.callTool({ name: "list_user_groups", arguments: { userPrincipalName: ALICE } });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toEqual({ status: "ok", groups: [{ id: MARKETING, displayName: "Marketing" }] });
    expect(audit.list().map((r) => [r.decision, r.result === null])).toEqual([
      ["autonomous", true],
      ["autonomous", false],
    ]);
  });

  it("returns pending_approval as a normal result and leaves an approval record", async () => {
    const result = await client.callTool({
      name: "add_user_to_group",
      arguments: { userPrincipalName: ALICE, groupId: MARKETING },
    });

    expect(result.isError).toBeFalsy();
    const body = textOf(result);
    expect(body.status).toBe("pending_approval");
    expect(approvals.get(body.approvalId as string)?.status).toBe("pending");
  });

  it("audits a malformed call instead of letting the protocol layer reject it", async () => {
    const result = await client.callTool({ name: "list_user_groups", arguments: { userPrincipalName: "not a upn" } });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
    expect(audit.list()).toHaveLength(1);
    expect(audit.list()[0]).toMatchObject({ decision: "denied", parameters: { userPrincipalName: "not a upn" } });
  });

  it("audits a call to a tool that does not exist", async () => {
    const result = await client.callTool({ name: "delete_user", arguments: { userPrincipalName: ALICE } });

    expect(textOf(result)).toMatchObject({ status: "denied", rules: [Rule.DenyUnknownTool] });
    expect(audit.list()[0]).toMatchObject({ tool: "delete_user", decision: "denied" });
  });

  it("audits a call with no arguments at all", async () => {
    const result = await client.callTool({ name: "list_user_groups" });

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
      const result = await brokenClient.callTool({ name: "list_user_groups", arguments: { userPrincipalName: ALICE } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatchObject({ status: "error", code: "gateway_unavailable" });
      expect(deps.graph.listUserGroups).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      await brokenClient.close();
    }
  });
});
