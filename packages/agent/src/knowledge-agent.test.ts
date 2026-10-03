import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "./db.js";
import { runKnowledgeAgent, type RunQuery } from "./knowledge-agent.js";
import { DEFAULT_AGENT_MODEL } from "./models.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FAKE_TOKEN = "fake-knowledge-gateway-token";
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

describe("runKnowledgeAgent()", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-knowledge-agent-"));
    dbPath = join(dir, "knowledge-helpdesk.db");
    // Standing in for the gateway, which in production always creates this chain first.
    openDatabase(dbPath, { create: true }).close();
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

    await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "what are the group types", dbPath, runQuery, getAccessToken });

    expect(recordsWhenQueried).toBe(1);
    expect(rows(dbPath)[0]).toMatchObject({ decision: "request", parameters: JSON.stringify("what are the group types") });
  });

  it("passes the request text as the prompt and generates a requestId when none is given", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    const result = await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    expect(result.requestId).toMatch(UUID);
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery.mock.calls[0]![0].prompt).toBe("hello");
  });

  it("honours an explicit requestId and sends it to the gateway as a header, not a tool parameter", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "hello", requestId: "req-fixed", dbPath, runQuery, getAccessToken });

    const server = runQuery.mock.calls[0]![0].options.mcpServers!["knowledge-gateway"] as { headers: Record<string, string> };
    expect(server.headers["x-request-id"]).toBe("req-fixed");
    expect(server.headers["x-actor"]).toBe("alice@contoso.com");
    expect(rows(dbPath)[0]?.requestId).toBe("req-fixed");
  });

  it("sends the raw request text as its own header too, the same way as x-actor (SPRINT4.md, section 2 — hand_off's own use of it)", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "what are the group types", dbPath, runQuery, getAccessToken });

    const server = runQuery.mock.calls[0]![0].options.mcpServers!["knowledge-gateway"] as { headers: Record<string, string> };
    expect(server.headers["x-request-text"]).toBe("what are the group types");
  });

  it("disables every built-in tool and allows exactly the two knowledge-gateway tools, unprompted", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    const { options } = runQuery.mock.calls[0]![0];
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual(["mcp__knowledge-gateway__search_documentation", "mcp__knowledge-gateway__hand_off"]);
    expect(options.permissionMode).toBe("dontAsk");
  });

  it("pins the model rather than letting the CLI resolve its own default", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    expect(runQuery.mock.calls[0]![0].options.model).toBe(DEFAULT_AGENT_MODEL);
  });

  it("states the actor's own UPN as a fact in the system prompt", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "how do groups work", dbPath, runQuery, getAccessToken });

    const prompt = String(runQuery.mock.calls[0]![0].options.systemPrompt);
    expect(prompt).toContain("alice@contoso.com");
  });

  it("gives the model no other way to act, and forbids claiming an action was performed", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    const prompt = String(runQuery.mock.calls[0]![0].options.systemPrompt).replace(/\s+/g, " ");
    expect(prompt).toMatch(/only[\s\S]*search_documentation tool/);
    expect(prompt).toContain("cite that passage's source document and heading");
    expect(prompt).toContain("say plainly that you don't know");
    expect(prompt).toContain("Never claim to have performed an action");
  });

  it("writes no_tool_called with the final reply when the session ends without a tool call", async () => {
    const runQuery = vi
      .fn<RunQuery>()
      .mockImplementation(() =>
        stream([assistantText("Let me check the documentation."), resultSuccess("I don't have documentation on that topic.")]),
      );

    const result = await runKnowledgeAgent({
      actor: "alice@contoso.com",
      requestText: "what's the return policy for a Surface device",
      dbPath,
      runQuery,
      getAccessToken,
    });

    expect(result.toolWasCalled).toBe(false);
    expect(result.reply).toBe("I don't have documentation on that topic.");
    const written = rows(dbPath);
    expect(written.map((r) => r.decision)).toEqual(["request", "no_tool_called", "model_usage"]);
  });

  it("does not write no_tool_called when a tool was called", async () => {
    const runQuery = vi
      .fn<RunQuery>()
      .mockImplementation(() => stream([assistantToolUse("mcp__knowledge-gateway__search_documentation"), resultSuccess("Security groups...")]));

    const result = await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "what are group types", dbPath, runQuery, getAccessToken });

    expect(result.toolWasCalled).toBe(true);
    expect(rows(dbPath).map((r) => r.decision)).toEqual(["request", "model_usage"]);
  });

  it("connects to the gateway over HTTP with a bearer token, never a spawned subprocess", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    const server = runQuery.mock.calls[0]![0].options.mcpServers!["knowledge-gateway"] as {
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

    await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken: trackedGetAccessToken });

    expect(order).toEqual(["token", "query"]);
  });

  describe("token usage", () => {
    it("records the model's token usage after a session that called a tool", async () => {
      const runQuery = vi.fn<RunQuery>().mockImplementation(() =>
        stream([
          assistantToolUse("mcp__knowledge-gateway__search_documentation"),
          resultSuccess("Security groups are used to manage access.", { "claude-sonnet-5": { inputTokens: 500, outputTokens: 80 } }),
        ]),
      );

      await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "what are group types", dbPath, runQuery, getAccessToken });

      const usageRow = rows(dbPath).find((r) => r.decision === "model_usage");
      expect(usageRow).toMatchObject({ result: JSON.stringify({ model: "claude-sonnet-5", inputTokens: 500, outputTokens: 80 }) });
    });

    it("records usage alongside no_tool_called when the session ends without a tool call", async () => {
      const runQuery = vi.fn<RunQuery>().mockImplementation(() =>
        stream([resultSuccess("I don't know.", { "claude-sonnet-5": { inputTokens: 300, outputTokens: 20 } })]),
      );

      await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "unrelated question", dbPath, runQuery, getAccessToken });

      expect(rows(dbPath).map((r) => r.decision)).toEqual(["request", "no_tool_called", "model_usage"]);
    });

    it("writes no usage record when the result carried none", async () => {
      const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok", {})]));

      await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

      expect(rows(dbPath).some((r) => r.decision === "model_usage")).toBe(false);
    });
  });
});
