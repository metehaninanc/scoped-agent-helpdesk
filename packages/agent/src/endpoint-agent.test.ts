import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runEndpointAgent, type RunQuery } from "./endpoint-agent.js";
import { DEFAULT_AGENT_MODEL } from "./models.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FAKE_TOKEN = "fake-endpoint-gateway-token";
const getAccessToken = async (): Promise<string> => FAKE_TOKEN;

const assistantToolUse = (name: string): SDKMessage =>
  ({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name, input: {} }] } }) as unknown as SDKMessage;
const assistantText = (text: string): SDKMessage =>
  ({ type: "assistant", message: { content: [{ type: "text", text }] } }) as unknown as SDKMessage;
const DEFAULT_MODEL_USAGE = { "claude-sonnet-5": { inputTokens: 120, outputTokens: 40 } };
const resultSuccess = (
  text: string,
  modelUsage: Record<string, { inputTokens: number; outputTokens: number }> = DEFAULT_MODEL_USAGE,
): SDKMessage => ({ type: "result", subtype: "success", result: text, modelUsage }) as unknown as SDKMessage;

async function* stream(messages: SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  for (const message of messages) yield message;
}

interface AuditRow {
  requestId: string;
  decision: string;
  parameters: string;
  result: string | null;
}

function rows(dbPath: string): AuditRow[] {
  const db = new DatabaseSync(dbPath);
  const out = db.prepare("SELECT requestId, decision, parameters, result FROM audit ORDER BY id").all() as unknown as AuditRow[];
  db.close();
  return out;
}

describe("runEndpointAgent()", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-endpoint-agent-"));
    dbPath = join(dir, "endpoint-helpdesk.db");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the request record before the model is ever called", async () => {
    let recordsWhenQueried = -1;
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => {
      recordsWhenQueried = rows(dbPath).length;
      return stream([resultSuccess("done")]);
    });

    await runEndpointAgent({ actor: "alice@contoso.com", requestText: "list the endpoints", dbPath, runQuery, getAccessToken });

    expect(recordsWhenQueried).toBe(1);
    expect(rows(dbPath)[0]).toMatchObject({ decision: "request", parameters: JSON.stringify("list the endpoints") });
  });

  it("passes the request text as the prompt and generates a requestId when none is given", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    const result = await runEndpointAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    expect(result.requestId).toMatch(UUID);
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery.mock.calls[0]![0].prompt).toBe("hello");
  });

  it("honours an explicit requestId and sends it to the gateway as a header, not a tool parameter", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runEndpointAgent({ actor: "alice@contoso.com", requestText: "hello", requestId: "req-fixed", dbPath, runQuery, getAccessToken });

    const server = runQuery.mock.calls[0]![0].options.mcpServers!["endpoint-gateway"] as { headers: Record<string, string> };
    expect(server.headers["x-request-id"]).toBe("req-fixed");
    expect(server.headers["x-actor"]).toBe("alice@contoso.com");
    expect(rows(dbPath)[0]?.requestId).toBe("req-fixed");
  });

  it("disables every built-in tool and allows exactly the four endpoint-gateway tools, unprompted, including reset_password", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runEndpointAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    const { options } = runQuery.mock.calls[0]![0];
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual([
      "mcp__endpoint-gateway__list_endpoints",
      "mcp__endpoint-gateway__get_endpoint",
      "mcp__endpoint-gateway__reboot_endpoint",
      "mcp__endpoint-gateway__reset_password",
    ]);
    expect(options.permissionMode).toBe("dontAsk");
  });

  it("pins the model rather than letting the CLI resolve its own default", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runEndpointAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    expect(runQuery.mock.calls[0]![0].options.model).toBe(DEFAULT_AGENT_MODEL);
  });

  it("tells the model reset_password is never automated, points to SSPR then the manager, and forbids claiming an unperformed action", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runEndpointAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    const prompt = String(runQuery.mock.calls[0]![0].options.systemPrompt).replace(/\s+/g, " ");
    expect(prompt).toContain("never resets a password through it or any other means, for anyone, under any circumstance");
    expect(prompt).toContain("Self-Service Password Reset");
    expect(prompt).toContain("their manager if SSPR is not available");
    expect(prompt).toContain("Do not retry it");
    expect(prompt).toContain("Never claim to have performed an action");
  });

  it("tells the model a pending approval on reboot_endpoint is the normal, successful outcome", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runEndpointAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    const prompt = String(runQuery.mock.calls[0]![0].options.systemPrompt).replace(/\s+/g, " ");
    expect(prompt).toContain("that is the normal, successful outcome of asking for a reboot, not a failure to retry around");
  });

  it("writes no_tool_called with the final reply when the session ends without a tool call", async () => {
    const runQuery = vi
      .fn<RunQuery>()
      .mockImplementation(() => stream([assistantText("Let me check that."), resultSuccess("I can't reset passwords through this system.")]));

    const result = await runEndpointAgent({
      actor: "alice@contoso.com",
      requestText: "reset alice's password",
      dbPath,
      runQuery,
      getAccessToken,
    });

    expect(result.toolWasCalled).toBe(false);
    expect(result.reply).toBe("I can't reset passwords through this system.");
    const written = rows(dbPath);
    expect(written.map((r) => r.decision)).toEqual(["request", "no_tool_called", "model_usage"]);
  });

  it("does not write no_tool_called when a tool was called, even reset_password (denied downstream, not here)", async () => {
    const runQuery = vi
      .fn<RunQuery>()
      .mockImplementation(() =>
        stream([assistantToolUse("mcp__endpoint-gateway__reset_password"), resultSuccess("This system cannot reset passwords.")]),
      );

    const result = await runEndpointAgent({ actor: "alice@contoso.com", requestText: "reset alice's password", dbPath, runQuery, getAccessToken });

    expect(result.toolWasCalled).toBe(true);
    expect(rows(dbPath).map((r) => r.decision)).toEqual(["request", "model_usage"]);
  });

  it("connects to the gateway over HTTP with a bearer token, never a spawned subprocess", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runEndpointAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    const server = runQuery.mock.calls[0]![0].options.mcpServers!["endpoint-gateway"] as {
      type: string;
      url: string;
      headers: Record<string, string>;
    };
    expect(server.type).toBe("http");
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(server.headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it("mints the token before the query starts, and never once the model is already running", async () => {
    const order: string[] = [];
    const trackedGetAccessToken = async (): Promise<string> => {
      order.push("token");
      return FAKE_TOKEN;
    };
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => {
      order.push("query");
      return stream([resultSuccess("ok")]);
    });

    await runEndpointAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken: trackedGetAccessToken });

    expect(order).toEqual(["token", "query"]);
  });

  describe("token usage", () => {
    it("records the model's token usage after a session that called a tool", async () => {
      const runQuery = vi.fn<RunQuery>().mockImplementation(() =>
        stream([
          assistantToolUse("mcp__endpoint-gateway__list_endpoints"),
          resultSuccess("Three endpoints are online.", { "claude-sonnet-5": { inputTokens: 500, outputTokens: 80 } }),
        ]),
      );

      await runEndpointAgent({ actor: "alice@contoso.com", requestText: "list the endpoints", dbPath, runQuery, getAccessToken });

      const usageRow = rows(dbPath).find((r) => r.decision === "model_usage");
      expect(usageRow).toMatchObject({ result: JSON.stringify({ model: "claude-sonnet-5", inputTokens: 500, outputTokens: 80 }) });
    });

    it("records usage alongside no_tool_called when the session ends without a tool call", async () => {
      const runQuery = vi.fn<RunQuery>().mockImplementation(() =>
        stream([resultSuccess("I can't do that.", { "claude-sonnet-5": { inputTokens: 300, outputTokens: 20 } })]),
      );

      await runEndpointAgent({ actor: "alice@contoso.com", requestText: "unrelated request", dbPath, runQuery, getAccessToken });

      expect(rows(dbPath).map((r) => r.decision)).toEqual(["request", "no_tool_called", "model_usage"]);
    });

    it("writes no usage record when the result carried none", async () => {
      const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok", {})]));

      await runEndpointAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

      expect(rows(dbPath).some((r) => r.decision === "model_usage")).toBe(false);
    });
  });
});
