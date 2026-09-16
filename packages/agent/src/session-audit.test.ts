import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuditLog } from "@helpdesk/audit-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "./db.js";
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

    const log = new AuditLog(openDatabase(dbPath));
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

    const log = new AuditLog(openDatabase(dbPath));
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
    audit.append({
      requestId: "req-1",
      actor: "alice@contoso.com",
      agent: "identity-agent",
      decision: "no_tool_called",
      content: "I can only manage group membership.",
    });
    audit.close();

    const log = new AuditLog(openDatabase(dbPath));
    const [record] = log.list();
    expect(record).toMatchObject({ decision: "no_tool_called", tool: null, parameters: null, result: "I can only manage group membership." });
    log.close();
  });

  it("chains multiple records from this writer alone", () => {
    const audit = new SessionAudit(dbPath);
    audit.append({ requestId: "req-1", actor: "alice@contoso.com", agent: "identity-agent", decision: "request", content: "x" });
    audit.append({ requestId: "req-2", actor: "bob@contoso.com", agent: "identity-agent", decision: "no_tool_called", content: "y" });
    audit.close();

    const log = new AuditLog(openDatabase(dbPath));
    expect(log.verifyChain()).toBeNull();
    log.close();
  });

  it("interleaves correctly with records written by a separate AuditLog on the same file", () => {
    // Standing in for the gateway subprocess, which writes to this same file over the course
    // of one session. Both sides go through @helpdesk/audit-core's AuditLog now, so this is a
    // same-file concurrency check, not a cross-implementation interop check.
    const gatewaySide = new AuditLog(openDatabase(dbPath));
    gatewaySide.append({ requestId: "req-1", actor: "alice@contoso.com", agent: "identity-agent", tool: null, parameters: "ignored", decision: "request" });
    gatewaySide.close();

    const audit = new SessionAudit(dbPath);
    audit.append({ requestId: "req-1", actor: "alice@contoso.com", agent: "identity-agent", decision: "no_tool_called", content: "done" });
    audit.close();

    const log = new AuditLog(openDatabase(dbPath));
    log.append({ requestId: "req-2", actor: "bob@contoso.com", agent: "identity-agent", tool: "list_user_groups", parameters: {}, decision: "autonomous" });
    expect(log.list().map((r) => r.decision)).toEqual(["request", "no_tool_called", "autonomous"]);
    expect(log.verifyChain()).toBeNull();
    log.close();
  });
});
