import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGatewayServer } from "./server.js";
import type { SessionContext } from "./session.js";
import type { ToolCallResult } from "./tool-call.js";

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> => {
  const [first] = result.content as { type: string; text: string }[];
  return JSON.parse(first!.text) as Record<string, unknown>;
};

describe("createGatewayServer()", () => {
  let client: Client;
  let onToolCall: ReturnType<typeof vi.fn<(tool: string, args: unknown, session: SessionContext) => Promise<ToolCallResult>>>;

  async function connect(handler: typeof onToolCall): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createGatewayServer({
      name: "test-gateway",
      version: "9.9.9",
      listTools: () => [{ name: "echo", description: "Echoes its input.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }],
      onToolCall: handler,
    }).connect(serverTransport);
    const c = new Client({ name: "test-client", version: "0.0.0" });
    await c.connect(clientTransport);
    return c;
  }

  beforeEach(() => {
    onToolCall = vi.fn(async () => ({ content: [{ type: "text" as const, text: JSON.stringify({ status: "ok" }) }] }));
  });

  afterEach(async () => {
    await client?.close();
  });

  it("advertises the name, version and tools this gateway supplied", async () => {
    client = await connect(onToolCall);

    expect(client.getServerVersion()).toMatchObject({ name: "test-gateway", version: "9.9.9" });
    const { tools } = await client.listTools();
    expect(tools).toEqual([{ name: "echo", description: "Echoes its input.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }]);
  });

  it("derives the session from the request and hands it to onToolCall, along with the tool name and arguments", async () => {
    client = await connect(onToolCall);

    await client.callTool({ name: "echo", arguments: { value: "hi" } });

    expect(onToolCall).toHaveBeenCalledWith("echo", { value: "hi" }, { actor: "unknown", agent: "unknown", requestId: "unknown" });
  });

  it("passes through onToolCall's content and isError unchanged", async () => {
    onToolCall.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ status: "denied", rules: ["x"] }) }], isError: false });
    client = await connect(onToolCall);

    const result = await client.callTool({ name: "echo", arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toEqual({ status: "denied", rules: ["x"] });
  });

  it("reports an error onToolCall throws as gateway_unavailable rather than crashing the server", async () => {
    onToolCall.mockRejectedValue(new Error("disk full"));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      client = await connect(onToolCall);
      const result = await client.callTool({ name: "echo", arguments: {} });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatchObject({ status: "error", code: "gateway_unavailable" });
      expect(stderr).toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });
});
