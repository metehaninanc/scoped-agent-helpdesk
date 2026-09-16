import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// This is the one place the agent package's tests import AuditLog from the gateway package,
// and only to prove interoperability: that SessionAudit's independent hash-chain
// implementation produces rows the gateway's own AuditLog and verifyChain() accept as part of
// the same chain. It is exported from @helpdesk/gateway for exactly this test (see the comment
// on that export); production code in this package never imports it (see session-audit.ts).
import { AuditLog } from "@helpdesk/gateway";

import { SessionAudit } from "./session-audit.js";

describe("SessionAudit", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-session-audit-"));
    dbPath = join(dir, "nested", "helpdesk.db");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the database and its parent directory", () => {
    const audit = new SessionAudit(dbPath);
    audit.append({ requestId: "req-1", actor: "alice@contoso.com", agent: "identity-agent", decision: "request", content: "hi" });
    audit.close();

    const log = new AuditLog(AuditLogDb(dbPath));
    expect(log.list()).toHaveLength(1);
    log.close();
  });

  it("writes a request record with the request text as parameters and no result", () => {
    const audit = new SessionAudit(dbPath);
    audit.append({
      requestId: "req-1",
      actor: "alice@contoso.com",
      agent: "identity-agent",
      decision: "request",
      content: "which groups is bob in",
    });
    audit.close();

    const log = new AuditLog(AuditLogDb(dbPath));
    const [record] = log.list();
    expect(record).toMatchObject({
      requestId: "req-1",
      actor: "alice@contoso.com",
      agent: "identity-agent",
      tool: null,
      decision: "request",
      parameters: "which groups is bob in",
      rules: [],
      result: null,
    });
    log.close();
  });

  it("writes a no_tool_called record with the reply as the result", () => {
    const audit = new SessionAudit(dbPath);
    audit.append({ requestId: "req-1", actor: "alice@contoso.com", agent: "identity-agent", decision: "no_tool_called", content: "I can only manage group membership." });
    audit.close();

    const log = new AuditLog(AuditLogDb(dbPath));
    const [record] = log.list();
    expect(record).toMatchObject({ decision: "no_tool_called", tool: null, parameters: null, result: "I can only manage group membership." });
    log.close();
  });

  it("chains multiple records from this writer alone", () => {
    const audit = new SessionAudit(dbPath);
    audit.append({ requestId: "req-1", actor: "alice@contoso.com", agent: "identity-agent", decision: "request", content: "x" });
    audit.append({ requestId: "req-2", actor: "bob@contoso.com", agent: "identity-agent", decision: "no_tool_called", content: "y" });
    audit.close();

    const log = new AuditLog(AuditLogDb(dbPath));
    expect(log.verifyChain()).toBeNull();
    log.close();
  });

  describe("interoperability with the gateway's AuditLog", () => {
    it("produces a chain the gateway's verifyChain() accepts when the two writers interleave", () => {
      const log = new AuditLog(AuditLogDb(dbPath));
      log.append({ requestId: "req-1", actor: "alice@contoso.com", agent: "identity-agent", tool: null, parameters: "ignored", decision: "request" });
      log.close();

      // The agent's writer picks up where the gateway's own AuditLog left off...
      const audit = new SessionAudit(dbPath);
      audit.append({ requestId: "req-1", actor: "alice@contoso.com", agent: "identity-agent", decision: "no_tool_called", content: "done" });
      audit.close();

      // ...and the gateway can append after the agent's writer, into the same chain.
      const log2 = new AuditLog(AuditLogDb(dbPath));
      log2.append({ requestId: "req-2", actor: "bob@contoso.com", agent: "identity-agent", tool: "list_user_groups", parameters: {}, decision: "autonomous" });

      const records = log2.list();
      expect(records.map((r) => [r.decision, r.agent])).toEqual([
        ["request", "identity-agent"],
        ["no_tool_called", "identity-agent"],
        ["autonomous", "identity-agent"],
      ]);
      expect(log2.verifyChain()).toBeNull();
      log2.close();
    });

    it("head marker set by one writer is read correctly by the other", () => {
      const audit = new SessionAudit(dbPath);
      audit.append({ requestId: "req-1", actor: "alice@contoso.com", agent: "identity-agent", decision: "request", content: "x" });
      audit.close();

      const log = new AuditLog(AuditLogDb(dbPath));
      expect(log.head()).toEqual({ lastId: 1, lastHash: log.list()[0]!.hash });
      log.append({ requestId: "req-1", actor: "alice@contoso.com", agent: "identity-agent", tool: null, parameters: null, decision: "no_tool_called" });
      expect(log.verifyChain()).toBeNull();
      log.close();
    });
  });
});

// AuditLog's constructor takes a DatabaseSync, not a path; this opens the same file the same
// way SessionAudit does, so both sides of the interop tests see one physical database.
function AuditLogDb(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
