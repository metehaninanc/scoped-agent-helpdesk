/**
 * The two agents must not be able to reach each other's tools. This is a weaker control than
 * Stage B's: today it holds because identity-agent.ts and mdm-agent.ts are separate files that
 * each name only their own gateway's tools, and nothing enforces that separation beyond a
 * reviewer reading both files and this test catching a regression. Stage B replaces it with
 * something a reviewer does not have to trust: an audience-bound token that Entra itself
 * refuses to honour against the wrong gateway (see README, "Sprint 2, Stage A: gateway
 * credential isolation" and prove-isolation.ts, which demonstrates that stronger claim at the
 * credential layer, not the allowlist layer this file checks).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runIdentityAgent, type RunQuery as IdentityRunQuery } from "./identity-agent.js";
import { runMdmAgent, type RunQuery as MdmRunQuery } from "./mdm-agent.js";

const resultSuccess = (text: string): SDKMessage => ({ type: "result", subtype: "success", result: text }) as unknown as SDKMessage;
const getAccessToken = async (): Promise<string> => "fake-token";

async function* stream(messages: SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  for (const message of messages) yield message;
}

describe("the two agents' allowlists and prompts are disjoint", () => {
  let dir: string;
  let identityDbPath: string;
  let mdmDbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-agent-boundary-"));
    identityDbPath = join(dir, "identity-helpdesk.db");
    mdmDbPath = join(dir, "mdm-helpdesk.db");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("gives the identity agent no MDM tool and the MDM agent no identity tool", async () => {
    const identityRunQuery = vi.fn<IdentityRunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));
    const mdmRunQuery = vi.fn<MdmRunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runIdentityAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath: identityDbPath, runQuery: identityRunQuery, getAccessToken });
    await runMdmAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath: mdmDbPath, runQuery: mdmRunQuery, getAccessToken });

    const identityTools = identityRunQuery.mock.calls[0]![0].options.allowedTools!;
    const mdmTools = mdmRunQuery.mock.calls[0]![0].options.allowedTools!;

    expect(identityTools.length).toBeGreaterThan(0);
    expect(mdmTools.length).toBeGreaterThan(0);

    for (const tool of mdmTools) expect(identityTools).not.toContain(tool);
    for (const tool of identityTools) expect(mdmTools).not.toContain(tool);

    // Not merely disjoint by accident: each names only its own gateway's MCP server.
    expect(identityTools.every((t) => t.startsWith("mcp__identity-gateway__"))).toBe(true);
    expect(mdmTools.every((t) => t.startsWith("mcp__mdm-gateway__"))).toBe(true);
  });

  it("gives each agent its own system prompt text, not a shared constant", async () => {
    const identityRunQuery = vi.fn<IdentityRunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));
    const mdmRunQuery = vi.fn<MdmRunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runIdentityAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath: identityDbPath, runQuery: identityRunQuery, getAccessToken });
    await runMdmAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath: mdmDbPath, runQuery: mdmRunQuery, getAccessToken });

    const identityPrompt = String(identityRunQuery.mock.calls[0]![0].options.systemPrompt);
    const mdmPrompt = String(mdmRunQuery.mock.calls[0]![0].options.systemPrompt);

    expect(identityPrompt).not.toBe(mdmPrompt);
    // Each names its own domain, not the other's: a shared prompt describing both would blur
    // exactly the line this test exists to keep sharp.
    expect(identityPrompt.toLowerCase()).not.toContain("device");
    expect(mdmPrompt.toLowerCase()).not.toContain("group membership");
  });

  it("connects each agent to its own gateway's URL, never the other's", async () => {
    const identityRunQuery = vi.fn<IdentityRunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));
    const mdmRunQuery = vi.fn<MdmRunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runIdentityAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath: identityDbPath, runQuery: identityRunQuery, getAccessToken });
    await runMdmAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath: mdmDbPath, runQuery: mdmRunQuery, getAccessToken });

    const identityServer = identityRunQuery.mock.calls[0]![0].options.mcpServers!["identity-gateway"] as { url: string };
    const mdmServer = mdmRunQuery.mock.calls[0]![0].options.mcpServers!["mdm-gateway"] as { url: string };

    expect(identityServer.url).not.toBe(mdmServer.url);
  });
});
