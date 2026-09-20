import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EndpointAgentResult } from "./endpoint-agent.js";
import type { IdentityAgentResult } from "./identity-agent.js";
import type { KnowledgeAgentResult } from "./knowledge-agent.js";
import type { MdmAgentResult } from "./mdm-agent.js";
import { routeRequest } from "./orchestrator.js";
import { TriageError, type TriageCategory, type TriageResult } from "./triage.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type IdentityCall = (input: { actor: string; requestText: string; requestId: string; dbPath?: string }) => Promise<IdentityAgentResult>;
type MdmCall = (input: { actor: string; requestText: string; requestId: string; dbPath?: string }) => Promise<MdmAgentResult>;
type KnowledgeCall = (input: { actor: string; requestText: string; requestId: string; dbPath?: string }) => Promise<KnowledgeAgentResult>;
type EndpointCall = (input: { actor: string; requestText: string; requestId: string; dbPath?: string }) => Promise<EndpointAgentResult>;

interface AuditRow {
  requestId: string;
  actor: string;
  agent: string;
  decision: string;
  rules: string;
  parameters: string;
  result: string | null;
}

function rows(dbPath: string): AuditRow[] {
  const db = new DatabaseSync(dbPath);
  const out = db.prepare("SELECT requestId, actor, agent, decision, rules, parameters, result FROM audit ORDER BY id").all() as unknown as AuditRow[];
  db.close();
  return out;
}

const classifyResult = (category: TriageCategory, overrides: Partial<TriageResult> = {}): TriageResult => ({
  category,
  partiallyOutOfScope: false,
  model: "claude-haiku-4-5-20251001",
  usage: { inputTokens: 40, outputTokens: 6 },
  ...overrides,
});

describe("routeRequest()", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-orchestrator-"));
    dbPath = join(dir, "orchestrator.db");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("generates a requestId when none is given, and uses it for both the audit record and the invoked agent", async () => {
    const classify = vi.fn().mockResolvedValue(classifyResult("identity"));
    const runIdentityAgent = vi.fn<IdentityCall>().mockImplementation(async () => ({
      requestId: "unused",
      toolWasCalled: true,
      reply: "Bob is in Marketing.",
    }));

    const result = await routeRequest({ actor: "alice@contoso.com", requestText: "which groups is bob in", dbPath, classify, runIdentityAgent });

    expect(result.requestId).toMatch(UUID);
    expect(runIdentityAgent).toHaveBeenCalledWith(expect.objectContaining({ requestId: result.requestId }));
    expect(rows(dbPath).every((r) => r.requestId === result.requestId)).toBe(true);
  });

  it("honours an explicit requestId", async () => {
    const classify = vi.fn().mockResolvedValue(classifyResult("mdm"));
    const runMdmAgent = vi.fn<MdmCall>().mockResolvedValue({ requestId: "req-fixed", toolWasCalled: true, reply: "No devices." });

    await routeRequest({ actor: "alice@contoso.com", requestText: "list devices", requestId: "req-fixed", dbPath, classify, runMdmAgent });

    expect(rows(dbPath).every((r) => r.requestId === "req-fixed")).toBe(true);
  });

  it("routes an identity classification to the identity agent with the raw request text, unchanged", async () => {
    const classify = vi.fn().mockResolvedValue(classifyResult("identity"));
    const runIdentityAgent = vi.fn<IdentityCall>().mockResolvedValue({
      requestId: "req-1",
      toolWasCalled: true,
      reply: "Bob is in Marketing.",
    });
    const runMdmAgent = vi.fn();

    const result = await routeRequest({
      actor: "alice@contoso.com",
      requestText: "which groups is bob in",
      requestId: "req-1",
      dbPath,
      classify,
      runIdentityAgent,
      runMdmAgent,
    });

    expect(runIdentityAgent).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "alice@contoso.com", requestText: "which groups is bob in" }),
    );
    expect(runMdmAgent).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "routed",
      category: "identity",
      agent: "identity-agent",
      requestId: "req-1",
      toolWasCalled: true,
      reply: "Bob is in Marketing.",
    });
  });

  it("routes an mdm classification to the mdm agent with the raw request text, unchanged", async () => {
    const classify = vi.fn().mockResolvedValue(classifyResult("mdm"));
    const runIdentityAgent = vi.fn();
    const runMdmAgent = vi.fn<MdmCall>().mockResolvedValue({
      requestId: "req-1",
      toolWasCalled: true,
      reply: "There are no devices registered.",
    });

    const result = await routeRequest({
      actor: "alice@contoso.com",
      requestText: "list the devices in the tenant",
      dbPath,
      classify,
      runIdentityAgent,
      runMdmAgent,
    });

    expect(runMdmAgent).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "alice@contoso.com", requestText: "list the devices in the tenant" }),
    );
    expect(runIdentityAgent).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "routed", category: "mdm", agent: "mdm-agent" });
  });

  it("passes no parameters extracted by triage to the invoked agent — only actor, requestText and requestId", async () => {
    const classify = vi.fn().mockResolvedValue(classifyResult("identity"));
    const runIdentityAgent = vi.fn<IdentityCall>().mockResolvedValue({ requestId: "req-1", toolWasCalled: false, reply: "ok" });

    await routeRequest({ actor: "alice@contoso.com", requestText: "which groups is bob in", dbPath, classify, runIdentityAgent });

    const [input] = runIdentityAgent.mock.calls[0]!;
    expect(Object.keys(input as object).sort()).toEqual(["actor", "requestId", "requestText"]);
  });

  it("writes the routed record before invoking the agent", async () => {
    let rowsWhenInvoked = -1;
    const classify = vi.fn().mockResolvedValue(classifyResult("identity"));
    const runIdentityAgent = vi.fn<IdentityCall>().mockImplementation(async () => {
      rowsWhenInvoked = rows(dbPath).length;
      return { requestId: "req-1", toolWasCalled: true, reply: "ok" };
    });

    await routeRequest({ actor: "alice@contoso.com", requestText: "which groups is bob in", dbPath, classify, runIdentityAgent });

    expect(rowsWhenInvoked).toBe(2); // model_usage (triage's call), then routed
  });

  it("writes a routed record naming the category and the agent invoked", async () => {
    const classify = vi.fn().mockResolvedValue(classifyResult("identity"));
    const runIdentityAgent = vi.fn<IdentityCall>().mockResolvedValue({ requestId: "req-1", toolWasCalled: true, reply: "ok" });

    await routeRequest({ actor: "alice@contoso.com", requestText: "which groups is bob in", dbPath, classify, runIdentityAgent });

    const routed = rows(dbPath).find((r) => r.decision === "routed");
    expect(routed).toMatchObject({
      agent: "orchestrator",
      parameters: JSON.stringify({ requestText: "which groups is bob in", category: "identity" }),
      result: JSON.stringify({ invokedAgent: "identity-agent" }),
    });
  });

  it("writes a model_usage record for triage's own call, with the model and usage it reported", async () => {
    const classify = vi.fn().mockResolvedValue(classifyResult("identity", { model: "claude-haiku-4-5-20251001", usage: { inputTokens: 55, outputTokens: 7 } }));
    const runIdentityAgent = vi.fn<IdentityCall>().mockResolvedValue({ requestId: "req-1", toolWasCalled: true, reply: "ok" });

    await routeRequest({ actor: "alice@contoso.com", requestText: "which groups is bob in", dbPath, classify, runIdentityAgent });

    const usage = rows(dbPath).find((r) => r.decision === "model_usage");
    expect(usage).toMatchObject({ result: JSON.stringify({ model: "claude-haiku-4-5-20251001", inputTokens: 55, outputTokens: 7 }) });
  });

  it("invokes no agent and reports unsupported when triage classifies it that way", async () => {
    const classify = vi.fn().mockResolvedValue(classifyResult("unsupported"));
    const runIdentityAgent = vi.fn();
    const runMdmAgent = vi.fn();

    const result = await routeRequest({
      actor: "alice@contoso.com",
      requestText: "reset my printer",
      dbPath,
      classify,
      runIdentityAgent,
      runMdmAgent,
    });

    expect(runIdentityAgent).not.toHaveBeenCalled();
    expect(runMdmAgent).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "unsupported", requestId: result.requestId, message: expect.any(String) });
    const denied = rows(dbPath).find((r) => r.decision === "denied");
    expect(denied).toMatchObject({ rules: JSON.stringify(["triage.unsupported"]) });
  });

  it("invokes no agent and reports triage_failed when the classifier's output does not name a known category", async () => {
    const classify = vi.fn().mockRejectedValue(new TriageError("invalid_output", "Triage response did not name a known category: garbage"));
    const runIdentityAgent = vi.fn();
    const runMdmAgent = vi.fn();

    const result = await routeRequest({
      actor: "alice@contoso.com",
      requestText: "which groups is bob in",
      dbPath,
      classify,
      runIdentityAgent,
      runMdmAgent,
    });

    expect(runIdentityAgent).not.toHaveBeenCalled();
    expect(runMdmAgent).not.toHaveBeenCalled();
    expect(result.status).toBe("triage_failed");
    const denied = rows(dbPath).find((r) => r.decision === "denied");
    expect(denied).toMatchObject({ rules: JSON.stringify(["triage.invalid_output"]) });
    expect((JSON.parse(denied!.parameters) as { detail: string }).detail).toContain("did not name a known category");
  });

  it("reports triage_failed with a distinct rule when the classification call itself fails, rather than the model's output being malformed", async () => {
    const classify = vi.fn().mockRejectedValue(new TriageError("api_error:500", "Triage request failed (500): internal error"));

    const result = await routeRequest({ actor: "alice@contoso.com", requestText: "which groups is bob in", dbPath, classify, runIdentityAgent: vi.fn() });

    expect(result.status).toBe("triage_failed");
    const denied = rows(dbPath).find((r) => r.decision === "denied");
    expect(denied).toMatchObject({ rules: JSON.stringify(["triage.request_failed"]) });
  });

  it("writes no model_usage record when triage failed before producing a usable result", async () => {
    const classify = vi.fn().mockRejectedValue(new Error("network exploded"));

    await routeRequest({ actor: "alice@contoso.com", requestText: "which groups is bob in", dbPath, classify, runIdentityAgent: vi.fn() });

    expect(rows(dbPath).some((r) => r.decision === "model_usage")).toBe(false);
  });

  it("passes an identityDbPath override through to the identity agent", async () => {
    const classify = vi.fn().mockResolvedValue(classifyResult("identity"));
    const runIdentityAgent = vi.fn<IdentityCall>().mockResolvedValue({ requestId: "req-1", toolWasCalled: true, reply: "ok" });

    await routeRequest({
      actor: "alice@contoso.com",
      requestText: "which groups is bob in",
      dbPath,
      identityDbPath: "/custom/identity.db",
      classify,
      runIdentityAgent,
    });

    expect(runIdentityAgent).toHaveBeenCalledWith(expect.objectContaining({ dbPath: "/custom/identity.db" }));
  });

  it("routes a knowledge classification to the knowledge agent with the raw request text, unchanged", async () => {
    const classify = vi.fn().mockResolvedValue(classifyResult("knowledge"));
    const runIdentityAgent = vi.fn();
    const runMdmAgent = vi.fn();
    const runKnowledgeAgent = vi.fn<KnowledgeCall>().mockResolvedValue({
      requestId: "req-1",
      toolWasCalled: true,
      reply: "Security groups and Microsoft 365 groups.",
    });

    const result = await routeRequest({
      actor: "alice@contoso.com",
      requestText: "what are the group types",
      requestId: "req-1",
      dbPath,
      classify,
      runIdentityAgent,
      runMdmAgent,
      runKnowledgeAgent,
    });

    expect(runKnowledgeAgent).toHaveBeenCalledWith(expect.objectContaining({ actor: "alice@contoso.com", requestText: "what are the group types" }));
    expect(runIdentityAgent).not.toHaveBeenCalled();
    expect(runMdmAgent).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "routed",
      category: "knowledge",
      agent: "knowledge-agent",
      requestId: "req-1",
      toolWasCalled: true,
      reply: "Security groups and Microsoft 365 groups.",
    });
  });

  it("passes a knowledgeDbPath override through to the knowledge agent", async () => {
    const classify = vi.fn().mockResolvedValue(classifyResult("knowledge"));
    const runKnowledgeAgent = vi.fn<KnowledgeCall>().mockResolvedValue({ requestId: "req-1", toolWasCalled: true, reply: "ok" });

    await routeRequest({
      actor: "alice@contoso.com",
      requestText: "what are the group types",
      dbPath,
      knowledgeDbPath: "/custom/knowledge.db",
      classify,
      runKnowledgeAgent,
    });

    expect(runKnowledgeAgent).toHaveBeenCalledWith(expect.objectContaining({ dbPath: "/custom/knowledge.db" }));
  });

  it("routes an endpoint classification to the endpoint agent with the raw request text, unchanged", async () => {
    const classify = vi.fn().mockResolvedValue(classifyResult("endpoint"));
    const runIdentityAgent = vi.fn();
    const runMdmAgent = vi.fn();
    const runKnowledgeAgent = vi.fn();
    const runEndpointAgent = vi.fn<EndpointCall>().mockResolvedValue({
      requestId: "req-1",
      toolWasCalled: true,
      reply: "This system cannot reset passwords; try Self-Service Password Reset.",
    });

    const result = await routeRequest({
      actor: "alice@contoso.com",
      requestText: "reset my password",
      requestId: "req-1",
      dbPath,
      classify,
      runIdentityAgent,
      runMdmAgent,
      runKnowledgeAgent,
      runEndpointAgent,
    });

    expect(runEndpointAgent).toHaveBeenCalledWith(expect.objectContaining({ actor: "alice@contoso.com", requestText: "reset my password" }));
    expect(runIdentityAgent).not.toHaveBeenCalled();
    expect(runMdmAgent).not.toHaveBeenCalled();
    expect(runKnowledgeAgent).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "routed",
      category: "endpoint",
      agent: "endpoint-agent",
      requestId: "req-1",
      toolWasCalled: true,
      reply: "This system cannot reset passwords; try Self-Service Password Reset.",
    });
  });

  it("passes an endpointDbPath override through to the endpoint agent", async () => {
    const classify = vi.fn().mockResolvedValue(classifyResult("endpoint"));
    const runEndpointAgent = vi.fn<EndpointCall>().mockResolvedValue({ requestId: "req-1", toolWasCalled: true, reply: "ok" });

    await routeRequest({
      actor: "alice@contoso.com",
      requestText: "list the endpoints",
      dbPath,
      endpointDbPath: "/custom/endpoint.db",
      classify,
      runEndpointAgent,
    });

    expect(runEndpointAgent).toHaveBeenCalledWith(expect.objectContaining({ dbPath: "/custom/endpoint.db" }));
  });

  describe("partiallyOutOfScope", () => {
    it("adds no note when triage says the whole request fit the category", async () => {
      const classify = vi.fn().mockResolvedValue(classifyResult("identity", { partiallyOutOfScope: false }));
      const runIdentityAgent = vi.fn<IdentityCall>().mockResolvedValue({ requestId: "req-1", toolWasCalled: true, reply: "ok" });

      const result = await routeRequest({ actor: "alice@contoso.com", requestText: "which groups is bob in", dbPath, classify, runIdentityAgent });

      expect(result).not.toHaveProperty("note");
    });

    it("adds a note to a routed result when triage flags part of the request as out of scope", async () => {
      const classify = vi.fn().mockResolvedValue(classifyResult("identity", { partiallyOutOfScope: true }));
      const runIdentityAgent = vi.fn<IdentityCall>().mockResolvedValue({ requestId: "req-1", toolWasCalled: true, reply: "Bob is in Marketing." });

      const result = await routeRequest({
        actor: "alice@contoso.com",
        requestText: "which groups is bob in, and also my laptop is slow",
        dbPath,
        classify,
        runIdentityAgent,
      });

      expect(result).toMatchObject({ status: "routed", reply: "Bob is in Marketing.", note: expect.any(String) });
    });

    it("adds a note to an unsupported result when triage flags part of the request as out of scope", async () => {
      const classify = vi.fn().mockResolvedValue(classifyResult("unsupported", { partiallyOutOfScope: true }));

      const result = await routeRequest({
        actor: "alice@contoso.com",
        requestText: "my laptop is slow and also am I in finance",
        dbPath,
        classify,
        runIdentityAgent: vi.fn(),
      });

      expect(result).toMatchObject({ status: "unsupported", note: expect.any(String) });
    });

    it("never routes or extracts anything based on partiallyOutOfScope — only the note text changes", async () => {
      const classify = vi.fn().mockResolvedValue(classifyResult("identity", { partiallyOutOfScope: true }));
      const runIdentityAgent = vi.fn<IdentityCall>().mockResolvedValue({ requestId: "req-1", toolWasCalled: true, reply: "ok" });

      await routeRequest({ actor: "alice@contoso.com", requestText: "which groups is bob in", dbPath, classify, runIdentityAgent });

      const [input] = runIdentityAgent.mock.calls[0]!;
      expect(Object.keys(input as object).sort()).toEqual(["actor", "requestId", "requestText"]);
    });
  });
});
