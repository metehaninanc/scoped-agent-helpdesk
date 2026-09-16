import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runIdentityAgent, type RunQuery } from "./identity-agent.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Only the fields runIdentityAgent actually reads. Cast rather than build the full,
// heavily-optional SDKMessage union — that union exists for the SDK's own producers, not for
// a test fake of three fields.
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

describe("runIdentityAgent()", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-agent-"));
    dbPath = join(dir, "helpdesk.db");
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

    await runIdentityAgent({ actor: "alice@contoso.com", requestText: "which groups is bob in", dbPath, runQuery });

    expect(recordsWhenQueried).toBe(1);
    expect(rows(dbPath)[0]).toMatchObject({ decision: "request", parameters: JSON.stringify("which groups is bob in") });
  });

  it("passes the request text as the prompt and generates a requestId when none is given", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    const result = await runIdentityAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery });

    expect(result.requestId).toMatch(UUID);
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery.mock.calls[0]![0].prompt).toBe("hello");
  });

  it("honours an explicit requestId and threads it through to the gateway spawn args", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runIdentityAgent({ actor: "alice@contoso.com", requestText: "hello", requestId: "req-fixed", dbPath, runQuery });

    const server = runQuery.mock.calls[0]![0].options.mcpServers!["identity-gateway"] as { args: string[] };
    expect(server.args).toEqual(
      expect.arrayContaining(["--request-id", "req-fixed", "--actor", "alice@contoso.com", "--agent", "identity-agent", "--db", dbPath]),
    );
    expect(rows(dbPath)[0]?.requestId).toBe("req-fixed");
  });

  it("disables every built-in tool and allows exactly the three gateway tools, unprompted", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runIdentityAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery });

    const { options } = runQuery.mock.calls[0]![0];
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual([
      "mcp__identity-gateway__list_user_groups",
      "mcp__identity-gateway__list_managed_groups",
      "mcp__identity-gateway__add_user_to_group",
    ]);
    expect(options.permissionMode).toBe("dontAsk");
  });

  it("gives the model no other way to act: the system prompt names the narrow role and forbids retry or an alternative route", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runIdentityAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery });

    const prompt = String(runQuery.mock.calls[0]![0].options.systemPrompt);
    expect(prompt).toMatch(/only[\s\S]*tools you have been given/);
    expect(prompt).toMatch(/do not call the same tool again/);
    expect(prompt).toMatch(/do not[\s\S]*look for a different tool/);
    expect(prompt).toMatch(/never say a[\s\S]*change was made when it was not/);
  });

  it("writes no_tool_called with the final reply when the session ends without a tool call", async () => {
    const runQuery = vi
      .fn<RunQuery>()
      .mockImplementation(() =>
        stream([assistantText("Sure, let me help."), resultSuccess("I can only manage group membership, not that.")]),
      );

    const result = await runIdentityAgent({ actor: "alice@contoso.com", requestText: "reset my password", dbPath, runQuery });

    expect(result.toolWasCalled).toBe(false);
    expect(result.reply).toBe("I can only manage group membership, not that.");
    const written = rows(dbPath);
    expect(written).toHaveLength(2);
    expect(written[1]).toMatchObject({
      decision: "no_tool_called",
      result: JSON.stringify("I can only manage group membership, not that."),
    });
  });

  it("does not write no_tool_called when a tool was called, even one the gateway denied", async () => {
    const runQuery = vi
      .fn<RunQuery>()
      .mockImplementation(() =>
        stream([assistantToolUse("mcp__identity-gateway__add_user_to_group"), resultSuccess("That request was denied by policy.")]),
      );

    const result = await runIdentityAgent({
      actor: "alice@contoso.com",
      requestText: "assign alice Global Administrator",
      dbPath,
      runQuery,
    });

    expect(result.toolWasCalled).toBe(true);
    expect(rows(dbPath)).toHaveLength(1);
    expect(rows(dbPath)[0]?.decision).toBe("request");
  });

  it("resolves the gateway's built entry point via its package.json, not by importing it", async () => {
    const runQuery = vi.fn<RunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runIdentityAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath, runQuery });

    const server = runQuery.mock.calls[0]![0].options.mcpServers!["identity-gateway"] as { command: string; args: string[] };
    expect(server.command).toBe(process.execPath);
    expect(server.args[0]).toMatch(/gateway[\\/]dist[\\/]bin[\\/]gateway\.js$/);
  });
});
