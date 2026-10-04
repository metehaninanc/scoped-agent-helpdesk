/**
 * The four agents must not be able to reach each other's tools. This is a weaker control than
 * Stage B's: today it holds because identity-agent.ts, mdm-agent.ts, knowledge-agent.ts and
 * endpoint-agent.ts are separate files that each name only their own gateway's tools, and nothing
 * enforces that separation beyond a reviewer reading all four files and this test catching a
 * regression. Stage B replaces it with something a reviewer does not have to trust: an
 * audience-bound token that Entra itself refuses to honour against the wrong gateway (see README,
 * "Sprint 2, Stage A: gateway credential isolation" and prove-isolation.ts, which demonstrates
 * that stronger claim at the credential layer, not the allowlist layer this file checks — extended
 * to the knowledge agent in SPRINT3.md, 3.3, and to the endpoint agent in 3.4).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "./db.js";
import { runEndpointAgent, type RunQuery as EndpointRunQuery } from "./endpoint-agent.js";
import { runIdentityAgent, type RunQuery as IdentityRunQuery } from "./identity-agent.js";
import { runKnowledgeAgent, type RunQuery as KnowledgeRunQuery } from "./knowledge-agent.js";
import { runMdmAgent, type RunQuery as MdmRunQuery } from "./mdm-agent.js";

const resultSuccess = (text: string): SDKMessage => ({ type: "result", subtype: "success", result: text }) as unknown as SDKMessage;
const getAccessToken = async (): Promise<string> => "fake-token";

async function* stream(messages: SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  for (const message of messages) yield message;
}

describe("the four agents' allowlists and prompts are disjoint", () => {
  let dir: string;
  let identityDbPath: string;
  let mdmDbPath: string;
  let knowledgeDbPath: string;
  let endpointDbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-agent-boundary-"));
    identityDbPath = join(dir, "identity-helpdesk.db");
    mdmDbPath = join(dir, "mdm-helpdesk.db");
    knowledgeDbPath = join(dir, "knowledge-helpdesk.db");
    endpointDbPath = join(dir, "endpoint-helpdesk.db");
    // Standing in for each gateway, which in production always creates its own chain first.
    for (const path of [identityDbPath, mdmDbPath, knowledgeDbPath, endpointDbPath]) openDatabase(path, { create: true }).close();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function runAllFour() {
    const identityRunQuery = vi.fn<IdentityRunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));
    const mdmRunQuery = vi.fn<MdmRunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));
    const knowledgeRunQuery = vi.fn<KnowledgeRunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));
    const endpointRunQuery = vi.fn<EndpointRunQuery>().mockImplementation(() => stream([resultSuccess("ok")]));

    await runIdentityAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath: identityDbPath, runQuery: identityRunQuery, getAccessToken });
    await runMdmAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath: mdmDbPath, runQuery: mdmRunQuery, getAccessToken });
    await runKnowledgeAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath: knowledgeDbPath, runQuery: knowledgeRunQuery, getAccessToken });
    await runEndpointAgent({ actor: "alice@contoso.com", requestText: "hello", dbPath: endpointDbPath, runQuery: endpointRunQuery, getAccessToken });

    return { identityRunQuery, mdmRunQuery, knowledgeRunQuery, endpointRunQuery };
  }

  it("gives each agent no other agent's tool", async () => {
    const { identityRunQuery, mdmRunQuery, knowledgeRunQuery, endpointRunQuery } = await runAllFour();

    const identityTools = identityRunQuery.mock.calls[0]![0].options.allowedTools!;
    const mdmTools = mdmRunQuery.mock.calls[0]![0].options.allowedTools!;
    const knowledgeTools = knowledgeRunQuery.mock.calls[0]![0].options.allowedTools!;
    const endpointTools = endpointRunQuery.mock.calls[0]![0].options.allowedTools!;

    expect(identityTools.length).toBeGreaterThan(0);
    expect(mdmTools.length).toBeGreaterThan(0);
    expect(knowledgeTools.length).toBeGreaterThan(0);
    expect(endpointTools.length).toBeGreaterThan(0);

    const allTools = [identityTools, mdmTools, knowledgeTools, endpointTools];
    for (let i = 0; i < allTools.length; i++) {
      for (let j = 0; j < allTools.length; j++) {
        if (i === j) continue;
        for (const tool of allTools[i]!) expect(allTools[j]).not.toContain(tool);
      }
    }

    // Not merely disjoint by accident: each names only its own gateway's MCP server.
    expect(identityTools.every((t) => t.startsWith("mcp__identity-gateway__"))).toBe(true);
    expect(mdmTools.every((t) => t.startsWith("mcp__mdm-gateway__"))).toBe(true);
    expect(knowledgeTools.every((t) => t.startsWith("mcp__knowledge-gateway__"))).toBe(true);
    expect(endpointTools.every((t) => t.startsWith("mcp__endpoint-gateway__"))).toBe(true);
  });

  it("gives each agent its own system prompt text, not a shared constant", async () => {
    const { identityRunQuery, mdmRunQuery, knowledgeRunQuery, endpointRunQuery } = await runAllFour();

    const identityPrompt = String(identityRunQuery.mock.calls[0]![0].options.systemPrompt);
    const mdmPrompt = String(mdmRunQuery.mock.calls[0]![0].options.systemPrompt);
    const knowledgePrompt = String(knowledgeRunQuery.mock.calls[0]![0].options.systemPrompt);
    const endpointPrompt = String(endpointRunQuery.mock.calls[0]![0].options.systemPrompt);

    expect(new Set([identityPrompt, mdmPrompt, knowledgePrompt, endpointPrompt]).size).toBe(4);
    // Each names its own domain, not the others': a shared prompt describing more than one would
    // blur exactly the line this test exists to keep sharp.
    expect(identityPrompt.toLowerCase()).not.toContain("device");
    expect(mdmPrompt.toLowerCase()).not.toContain("group membership");
    expect(knowledgePrompt.toLowerCase()).not.toContain("group membership");
    // reboot/SSPR language is the endpoint agent's own signature: nothing else should carry it,
    // and it should not accidentally omit it either.
    expect(endpointPrompt.toLowerCase()).toContain("reboot");
    expect(identityPrompt.toLowerCase()).not.toContain("reboot");
    expect(mdmPrompt.toLowerCase()).not.toContain("reboot");
    expect(knowledgePrompt.toLowerCase()).not.toContain("reboot");
  });

  it("connects each agent to its own gateway's URL, never another's", async () => {
    const { identityRunQuery, mdmRunQuery, knowledgeRunQuery, endpointRunQuery } = await runAllFour();

    const identityServer = identityRunQuery.mock.calls[0]![0].options.mcpServers!["identity-gateway"] as { url: string };
    const mdmServer = mdmRunQuery.mock.calls[0]![0].options.mcpServers!["mdm-gateway"] as { url: string };
    const knowledgeServer = knowledgeRunQuery.mock.calls[0]![0].options.mcpServers!["knowledge-gateway"] as { url: string };
    const endpointServer = endpointRunQuery.mock.calls[0]![0].options.mcpServers!["endpoint-gateway"] as { url: string };

    expect(new Set([identityServer.url, mdmServer.url, knowledgeServer.url, endpointServer.url]).size).toBe(4);
  });

  describe("HELPDESK_AGENT_AUTH, the same way in all four", () => {
    afterEach(() => vi.unstubAllEnvs());

    const initReporting = (apiKeySource: string): SDKMessage => ({ type: "system", subtype: "init", apiKeySource }) as unknown as SDKMessage;

    it("leaves every agent's subprocess environment unset by default, so the API key reaches it as before", async () => {
      vi.stubEnv("HELPDESK_AGENT_AUTH", "");
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
      const { identityRunQuery, mdmRunQuery, knowledgeRunQuery, endpointRunQuery } = await runAllFour();

      for (const run of [identityRunQuery, mdmRunQuery, knowledgeRunQuery, endpointRunQuery]) {
        expect(run.mock.calls[0]![0].options.env).toBeUndefined();
      }
    });

    it("withholds the API key from every agent's subprocess in session mode, and only from theirs", async () => {
      vi.stubEnv("HELPDESK_AGENT_AUTH", "session");
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
      const { identityRunQuery, mdmRunQuery, knowledgeRunQuery, endpointRunQuery } = await runAllFour();

      for (const run of [identityRunQuery, mdmRunQuery, knowledgeRunQuery, endpointRunQuery]) {
        const env = run.mock.calls[0]![0].options.env!;
        expect(env).toBeDefined();
        expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
        expect(env.HELPDESK_AGENT_AUTH).toBe("session");
      }
      // The in-process callers (triage, the rationale generator) read the key from process.env.
      expect(process.env.ANTHROPIC_API_KEY).toBe("sk-test");
    });

    it("fails an agent call that reports it authenticated with an API key while session mode is on, naming the mismatch", async () => {
      vi.stubEnv("HELPDESK_AGENT_AUTH", "session");
      const bad = () => stream([initReporting("ANTHROPIC_API_KEY"), resultSuccess("ok")]);
      const common = { actor: "alice@contoso.com", requestText: "hello", getAccessToken };

      await expect(runIdentityAgent({ ...common, dbPath: identityDbPath, runQuery: vi.fn<IdentityRunQuery>().mockImplementation(bad) })).rejects.toThrow("Agent auth path mismatch");
      await expect(runMdmAgent({ ...common, dbPath: mdmDbPath, runQuery: vi.fn<MdmRunQuery>().mockImplementation(bad) })).rejects.toThrow("Agent auth path mismatch");
      await expect(runKnowledgeAgent({ ...common, dbPath: knowledgeDbPath, runQuery: vi.fn<KnowledgeRunQuery>().mockImplementation(bad) })).rejects.toThrow("Agent auth path mismatch");
      await expect(runEndpointAgent({ ...common, dbPath: endpointDbPath, runQuery: vi.fn<EndpointRunQuery>().mockImplementation(bad) })).rejects.toThrow("Agent auth path mismatch");
    });

    it("lets an agent call through that reports the login session, in session mode", async () => {
      vi.stubEnv("HELPDESK_AGENT_AUTH", "session");
      const ok = () => stream([initReporting("none"), resultSuccess("ok")]);
      const result = await runIdentityAgent({
        actor: "alice@contoso.com",
        requestText: "hello",
        getAccessToken,
        dbPath: identityDbPath,
        runQuery: vi.fn<IdentityRunQuery>().mockImplementation(ok),
      });
      expect(result.reply).toBe("ok");
    });
  });
});
