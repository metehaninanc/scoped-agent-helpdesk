import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuditLog } from "@helpdesk/audit-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "./db.js";
import { OrchestratorAudit } from "./orchestrator-audit.js";

describe("OrchestratorAudit", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-orchestrator-audit-"));
    dbPath = join(dir, "nested", "orchestrator.db");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the database and its parent directory", () => {
    const audit = new OrchestratorAudit(dbPath);
    audit.appendRouted({
      requestId: "req-1",
      actor: "alice@contoso.com",
      requestText: "which groups is bob in",
      category: "identity",
      invokedAgent: "identity-agent",
    });
    audit.close();

    const log = new AuditLog(openDatabase(dbPath));
    expect(log.list()).toHaveLength(1);
    log.close();
  });

  it("writes a routed record naming the category and the agent invoked, as orchestrator, never the agent's own name", () => {
    const audit = new OrchestratorAudit(dbPath);
    audit.appendRouted({
      requestId: "req-1",
      actor: "alice@contoso.com",
      requestText: "which groups is bob in",
      category: "identity",
      invokedAgent: "identity-agent",
    });
    audit.close();

    const log = new AuditLog(openDatabase(dbPath));
    const [record] = log.list();
    expect(record).toMatchObject({
      requestId: "req-1",
      actor: "alice@contoso.com",
      agent: "orchestrator",
      tool: null,
      decision: "routed",
      parameters: { requestText: "which groups is bob in", category: "identity" },
      rules: [],
      result: { invokedAgent: "identity-agent" },
    });
    log.close();
  });

  it("writes a denied record for an explicit not_it classification, with no detail", () => {
    const audit = new OrchestratorAudit(dbPath);
    audit.appendNotRouted({
      requestId: "req-1",
      actor: "alice@contoso.com",
      requestText: "reset my printer",
      rule: "triage.not_it",
    });
    audit.close();

    const log = new AuditLog(openDatabase(dbPath));
    const [record] = log.list();
    expect(record).toMatchObject({
      agent: "orchestrator",
      decision: "denied",
      rules: ["triage.not_it"],
      parameters: { requestText: "reset my printer" },
      result: null,
    });
    expect((record!.parameters as { detail?: string }).detail).toBeUndefined();
    log.close();
  });

  it("writes a denied record for an explicit needs_human classification", () => {
    const audit = new OrchestratorAudit(dbPath);
    audit.appendNotRouted({
      requestId: "req-1",
      actor: "alice@contoso.com",
      requestText: "my laptop screen is cracked",
      rule: "triage.needs_human",
    });
    audit.close();

    const log = new AuditLog(openDatabase(dbPath));
    const [record] = log.list();
    expect(record).toMatchObject({
      agent: "orchestrator",
      decision: "denied",
      rules: ["triage.needs_human"],
      parameters: { requestText: "my laptop screen is cracked" },
      result: null,
    });
    log.close();
  });

  it("writes the notItTeam as the detail when decision one named a team", () => {
    const audit = new OrchestratorAudit(dbPath);
    audit.appendNotRouted({
      requestId: "req-1",
      actor: "alice@contoso.com",
      requestText: "the heater in my office is broken",
      rule: "triage.not_it",
      detail: "facilities",
    });
    audit.close();

    const log = new AuditLog(openDatabase(dbPath));
    const [record] = log.list();
    expect((record!.parameters as { detail?: string }).detail).toBe("facilities");
    log.close();
  });

  it("writes a denied record with the failure detail when triage itself failed", () => {
    const audit = new OrchestratorAudit(dbPath);
    audit.appendNotRouted({
      requestId: "req-1",
      actor: "alice@contoso.com",
      requestText: "which groups is bob in",
      rule: "triage.invalid_output",
      detail: 'Triage response did not name a known category: {"category": "endpoint"}',
    });
    audit.close();

    const log = new AuditLog(openDatabase(dbPath));
    const [record] = log.list();
    expect(record).toMatchObject({
      decision: "denied",
      rules: ["triage.invalid_output"],
      parameters: {
        requestText: "which groups is bob in",
        detail: 'Triage response did not name a known category: {"category": "endpoint"}',
      },
    });
    log.close();
  });

  it("writes a model_usage record for triage's own classification call", () => {
    const audit = new OrchestratorAudit(dbPath);
    audit.appendUsage({ requestId: "req-1", actor: "alice@contoso.com", model: "claude-haiku-4-5-20251001", inputTokens: 40, outputTokens: 6 });
    audit.close();

    const log = new AuditLog(openDatabase(dbPath));
    const [record] = log.list();
    expect(record).toMatchObject({
      agent: "orchestrator",
      tool: null,
      decision: "model_usage",
      parameters: null,
      rules: [],
      result: { model: "claude-haiku-4-5-20251001", inputTokens: 40, outputTokens: 6 },
    });
    log.close();
  });

  it("chains multiple records from this writer alone", () => {
    const audit = new OrchestratorAudit(dbPath);
    audit.appendUsage({ requestId: "req-1", actor: "alice@contoso.com", model: "claude-haiku-4-5-20251001", inputTokens: 40, outputTokens: 6 });
    audit.appendRouted({
      requestId: "req-1",
      actor: "alice@contoso.com",
      requestText: "which groups is bob in",
      category: "identity",
      invokedAgent: "identity-agent",
    });
    audit.close();

    const log = new AuditLog(openDatabase(dbPath));
    expect(log.verifyChain()).toBeNull();
    log.close();
  });
});
