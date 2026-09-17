import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runMdmAgent, type RunQuery } from "./mdm-agent.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FAKE_TOKEN = "fake-mdm-gateway-token";
const getAccessToken = async (): Promise<string> => FAKE_TOKEN;

const assistantToolUse = (name: string): SDKMessage =>
  ({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name, input: {} }] } }) as unknown as SDKMessage;
const assistantText = (text: string): SDKMessage =>
  ({ type: "assistant", message: { content: [{ type: "text", text }] } }) as unknown as SDKMessage;
const resultSuccess = (text: string): SDKMessage => ({ type: "result", subtype: "success", result: text }) as unknown as SDKMessage;

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

describe("runMdmAgent()", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-mdm-agent-"));
    dbPath = join(dir, "mdm-helpdesk.db");
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

    await runMdmAgent({ actor: "alice@contoso.com", requestText: "list the devices in the tenant", dbPath, runQuery, getAccessToken });

    expect(recordsWhenQueried).toBe(1);
    expect(rows(dbPath)[0]).toMatchObject({ decision: "request", parameters: JSON.stringify("list the devices in the tenant") });
  });

  it("passes the request text as the prompt and generates a requestId when none is given", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    const result = await runMdmAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    expect(result.requestId).toMatch(UUID);
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery.mock.calls[0]![0].prompt).toBe("hello");
  });

  it("honours an explicit requestId and sends it to the gateway as a header, not a tool parameter", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runMdmAgent({ actor: "alice@contoso.com", requestText: "hello", requestId: "req-fixed", dbPath, runQuery, getAccessToken });

    const server = runQuery.mock.calls[0]![0].options.mcpServers!["mdm-gateway"] as { headers: Record<string, string> };
    expect(server.headers["x-request-id"]).toBe("req-fixed");
    expect(server.headers["x-actor"]).toBe("alice@contoso.com");
    expect(rows(dbPath)[0]?.requestId).toBe("req-fixed");
  });

  it("disables every built-in tool and allows exactly the two mdm-gateway tools, unprompted", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runMdmAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    const { options } = runQuery.mock.calls[0]![0];
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual(["mcp__mdm-gateway__list_devices", "mcp__mdm-gateway__get_device"]);
    expect(options.permissionMode).toBe("dontAsk");
  });

  it("gives the model no other way to act: the system prompt names the narrow role and forbids retry or an alternative route", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runMdmAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    const prompt = String(runQuery.mock.calls[0]![0].options.systemPrompt);
    expect(prompt).toMatch(/only[\s\S]*tools you have been given/);
    expect(prompt).toMatch(/do not call the same tool again/);
    expect(prompt).toMatch(/do not[\s\S]*look for a different tool/);
    expect(prompt).toContain("no write tools at all");
  });

  it("writes no_tool_called with the final reply when the session ends without a tool call", async () => {
    const runQuery = vi
      .fn<RunQuery>()
      .mockImplementation(() =>
        stream([assistantText("Sure, let me help."), resultSuccess("I can only look up devices, not that.")]),
      );

    const result = await runMdmAgent({ actor: "alice@contoso.com", requestText: "wipe alice's laptop", dbPath, runQuery, getAccessToken });

    expect(result.toolWasCalled).toBe(false);
    expect(result.reply).toBe("I can only look up devices, not that.");
    const written = rows(dbPath);
    expect(written).toHaveLength(2);
    expect(written[1]).toMatchObject({ decision: "no_tool_called", result: JSON.stringify("I can only look up devices, not that.") });
  });

  it("does not write no_tool_called when a tool was called, even one the gateway denied", async () => {
    const runQuery = vi
      .fn<RunQuery>()
      .mockImplementation(() => stream([assistantToolUse("mcp__mdm-gateway__get_device"), resultSuccess("That request was denied by policy.")]));

    const result = await runMdmAgent({ actor: "alice@contoso.com", requestText: "look up device x", dbPath, runQuery, getAccessToken });

    expect(result.toolWasCalled).toBe(true);
    expect(rows(dbPath)).toHaveLength(1);
    expect(rows(dbPath)[0]?.decision).toBe("request");
  });

  it("connects to the gateway over HTTP with a bearer token, never a spawned subprocess", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runMdmAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken });

    const server = runQuery.mock.calls[0]![0].options.mcpServers!["mdm-gateway"] as {
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

    await runMdmAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery, getAccessToken: trackedGetAccessToken });

    expect(order).toEqual(["token", "query"]);
  });
});
