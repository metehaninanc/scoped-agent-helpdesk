import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db.js";
import { AuditLog, verifyChain } from "./audit-log.js";
import { GENESIS_HASH, computeHash } from "./hash.js";
import type { AuditInput } from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** A clock that ticks one second per call, so timestamps are deterministic and distinct. */
function fixedClock(start = Date.UTC(2026, 8, 15, 12, 0, 0)) {
  let t = start;
  return () => new Date((t += 1000));
}

const decision = (overrides: Partial<AuditInput> = {}): AuditInput => ({
  requestId: "req-1",
  actor: "helpdesk.operator@contoso.com",
  agent: "identity-agent",
  tool: "list_user_groups",
  parameters: { userPrincipalName: "alice@contoso.com" },
  decision: "autonomous",
  rules: [],
  ...overrides,
});

const requestRecord = (requestId: string): AuditInput => ({
  requestId,
  actor: "helpdesk.operator@contoso.com",
  agent: "identity-agent",
  tool: null,
  parameters: { text: "which groups is alice in", actor: "helpdesk.operator@contoso.com" },
  decision: "request",
  rules: [],
});

/** Simulate an attacker with direct database access: the triggers are the first thing to go. */
function disarmTriggers(log: AuditLog) {
  log.db.exec("DROP TRIGGER audit_no_update; DROP TRIGGER audit_no_delete;");
}

// ---------------------------------------------------------------------------

describe("AuditLog", () => {
  let log: AuditLog;

  beforeEach(() => {
    log = new AuditLog(openDatabase(":memory:"), { now: fixedClock() });
  });

  afterEach(() => {
    log.close();
  });

  describe("append()", () => {
    it("writes the first record against the genesis hash", () => {
      const record = log.append(requestRecord("req-1"));

      expect(record.id).toBe(1);
      expect(record.prevHash).toBe(GENESIS_HASH);
      expect(record.hash).toMatch(SHA256_HEX);
      expect(record.timestamp).toBe("2026-09-15T12:00:01.000Z");
    });

    it("links each record to the hash of the previous one", () => {
      const first = log.append(requestRecord("req-1"));
      const second = log.append(decision());
      const third = log.append(decision({ result: [{ id: "g1", displayName: "Marketing" }] }));

      expect(second.id).toBe(2);
      expect(second.prevHash).toBe(first.hash);
      expect(third.id).toBe(3);
      expect(third.prevHash).toBe(second.hash);
      expect(new Set([first.hash, second.hash, third.hash]).size).toBe(3);
    });

    it("round-trips parameters, rules and result as JSON", () => {
      const record = log.append(
        decision({
          decision: "denied",
          rules: ["deny.break_glass_user", "deny.group_not_managed"],
          parameters: { userPrincipalName: "breakglass1@contoso.com", groupId: "g1" },
          result: { error: "refused" },
        }),
      );

      expect(record.parameters).toEqual({ userPrincipalName: "breakglass1@contoso.com", groupId: "g1" });
      expect(record.rules).toEqual(["deny.break_glass_user", "deny.group_not_managed"]);
      expect(record.result).toEqual({ error: "refused" });
    });

    it("stores null for result until execution, and null tool on request records", () => {
      const req = log.append(requestRecord("req-1"));
      const dec = log.append(decision());

      expect(req.tool).toBeNull();
      expect(req.result).toBeNull();
      expect(dec.tool).toBe("list_user_groups");
      expect(dec.result).toBeNull();
    });

    it("accepts a no_tool_called record carrying the reply", () => {
      log.append(requestRecord("req-4"));
      const closed = log.append({
        ...requestRecord("req-4"),
        decision: "no_tool_called",
        result: { reply: "I cannot assign directory roles." },
      });

      expect(closed.decision).toBe("no_tool_called");
      expect(closed.result).toEqual({ reply: "I cannot assign directory roles." });
    });

    it("rejects a decision value outside the schema", () => {
      expect(() => log.append(decision({ decision: "maybe" as AuditInput["decision"] }))).toThrow(/decision/);
    });

    it.each(["request", "autonomous", "approval", "denied", "no_tool_called", "rationale", "approved", "rejected"] as const)(
      "accepts the %s event kind",
      (kind) => {
        expect(() => log.append(decision({ decision: kind, tool: null }))).not.toThrow();
      },
    );

    it("extends the accepted event kinds on an existing database without rebuilding the table", () => {
      // Simulate a database created by an older build that knew fewer kinds: replace the
      // enum trigger with a narrower one, then run the schema again.
      log.db.exec(`
        DROP TRIGGER audit_decision_enum;
        CREATE TRIGGER audit_decision_enum BEFORE INSERT ON audit
        WHEN NEW.decision NOT IN ('request', 'autonomous')
        BEGIN SELECT RAISE(ABORT, 'audit.decision is not a known event kind'); END;`);
      expect(() => log.append(decision({ decision: "rejected" }))).toThrow(/decision/);

      const reopened = new AuditLog(log.db, { now: fixedClock() });
      expect(() => reopened.append(decision({ decision: "rejected" }))).not.toThrow();
      expect(reopened.verifyChain()).toBeNull();
    });

    it("leaves the chain intact after a rejected append", () => {
      log.append(requestRecord("req-1"));
      expect(() => log.append(decision({ decision: "maybe" as AuditInput["decision"] }))).toThrow();
      const next = log.append(decision());

      expect(next.id).toBe(2);
      expect(log.verifyChain()).toBeNull();
    });

    it("computes the hash over the stored row, id and prevHash included", () => {
      const record = log.append(decision());
      const row = log.rows()[0]!;

      expect(computeHash(row)).toBe(record.hash);
      expect(computeHash({ ...row, id: 99 })).not.toBe(record.hash);
      expect(computeHash({ ...row, prevHash: "0".repeat(64).replace(/0$/, "1") })).not.toBe(record.hash);
      expect(computeHash({ ...row, parameters: "{}" })).not.toBe(record.hash);
    });
  });

  describe("reads", () => {
    it("lists every record in id order", () => {
      log.append(requestRecord("req-1"));
      log.append(decision());
      log.append(requestRecord("req-2"));

      expect(log.list().map((r) => [r.id, r.requestId, r.decision])).toEqual([
        [1, "req-1", "request"],
        [2, "req-1", "autonomous"],
        [3, "req-2", "request"],
      ]);
    });

    it("correlates all records of one request by requestId", () => {
      log.append(requestRecord("req-1"));
      log.append(requestRecord("req-2"));
      log.append(decision({ requestId: "req-1" }));
      log.append(decision({ requestId: "req-1", result: [] }));

      expect(log.byRequest("req-1").map((r) => r.id)).toEqual([1, 3, 4]);
      expect(log.byRequest("nope")).toEqual([]);
    });
  });

  describe("append only", () => {
    it("refuses UPDATE at the database level", () => {
      log.append(decision());
      expect(() => log.db.exec("UPDATE audit SET actor = 'mallory@contoso.com' WHERE id = 1")).toThrow(
        /append only/,
      );
    });

    it("refuses DELETE at the database level", () => {
      log.append(decision());
      expect(() => log.db.exec("DELETE FROM audit WHERE id = 1")).toThrow(/append only/);
    });
  });

  describe("verifyChain()", () => {
    it("returns null for an empty log", () => {
      expect(log.verifyChain()).toBeNull();
    });

    it("returns null for an intact chain", () => {
      for (let i = 0; i < 5; i++) log.append(decision({ requestId: `req-${i}` }));
      expect(log.verifyChain()).toBeNull();
      expect(verifyChain(log.db)).toBeNull();
    });

    it("detects a modified record, even with the triggers gone", () => {
      for (let i = 0; i < 5; i++) {
        log.append(decision({ requestId: `req-${i}`, decision: "denied", rules: ["deny.group_not_managed"] }));
      }
      disarmTriggers(log);
      // Rewrite history: the denial becomes an autonomous call that never needed approval.
      log.db.exec("UPDATE audit SET decision = 'autonomous', rules = '[]' WHERE id = 3");

      expect(log.rows()[2]?.decision).toBe("autonomous");
      expect(log.verifyChain()).toEqual({ index: 2, id: 3, reason: "hash_mismatch" });
    });

    it("detects a record whose hash was recomputed but whose successor still points at the old one", () => {
      for (let i = 0; i < 3; i++) log.append(decision({ requestId: `req-${i}` }));
      disarmTriggers(log);
      // A smarter attacker fixes the tampered row's own hash. The next row still disagrees.
      const row = { ...log.rows()[1]!, actor: "mallory@contoso.com" };
      log.db
        .prepare("UPDATE audit SET actor = ?, hash = ? WHERE id = 2")
        .run(row.actor, computeHash(row));

      expect(log.verifyChain()).toEqual({ index: 2, id: 3, reason: "prev_hash_mismatch" });
    });

    it("detects a deleted record in the middle", () => {
      for (let i = 0; i < 5; i++) log.append(decision({ requestId: `req-${i}` }));
      disarmTriggers(log);
      log.db.exec("DELETE FROM audit WHERE id = 3");

      expect(log.verifyChain()).toEqual({ index: 2, id: 4, reason: "prev_hash_mismatch" });
    });

    it("detects a deleted head", () => {
      for (let i = 0; i < 3; i++) log.append(decision({ requestId: `req-${i}` }));
      disarmTriggers(log);
      log.db.exec("DELETE FROM audit WHERE id = 1");

      expect(log.verifyChain()).toEqual({ index: 0, id: 2, reason: "prev_hash_mismatch" });
    });

    it("detects a deleted tail once anything is appended after it", () => {
      for (let i = 0; i < 3; i++) log.append(decision({ requestId: `req-${i}` }));
      disarmTriggers(log);
      log.db.exec("DELETE FROM audit WHERE id = 3");
      const appended = log.append(decision({ requestId: "req-after" }));

      // The id sequence does not go backwards, so the gap where record 3 was is visible.
      expect(appended.id).toBe(4);
      expect(log.verifyChain()).toEqual({ index: 2, id: 4, reason: "id_gap" });
    });

    it("detects a deleted tail with nothing after it, via the head marker", () => {
      for (let i = 0; i < 3; i++) log.append(decision({ requestId: `req-${i}` }));
      disarmTriggers(log);
      log.db.exec("DELETE FROM audit WHERE id = 3");

      // The chain itself is intact up to record 2; only the marker knows record 3 existed.
      expect(log.verifyChain()).toEqual({ index: 2, id: 3, reason: "tail_truncated" });
    });

    it("detects a wiped table via the head marker", () => {
      for (let i = 0; i < 3; i++) log.append(decision({ requestId: `req-${i}` }));
      disarmTriggers(log);
      log.db.exec("DELETE FROM audit");

      expect(log.verifyChain()).toEqual({ index: 0, id: 3, reason: "tail_truncated" });
    });

    it("detects a tail rewritten with a recomputed hash, which no successor can catch", () => {
      for (let i = 0; i < 3; i++) log.append(decision({ requestId: `req-${i}` }));
      disarmTriggers(log);
      const row = { ...log.rows()[2]!, actor: "mallory@contoso.com" };
      log.db.prepare("UPDATE audit SET actor = ?, hash = ? WHERE id = 3").run(row.actor, computeHash(row));

      expect(log.verifyChain()).toEqual({ index: 2, id: 3, reason: "tail_truncated" });
    });

    it("detects a removed head marker when records exist", () => {
      for (let i = 0; i < 3; i++) log.append(decision({ requestId: `req-${i}` }));
      log.db.exec("DELETE FROM audit_head");

      expect(log.verifyChain()).toEqual({ index: 2, id: 3, reason: "tail_truncated" });
    });

    it("does NOT detect a tail deletion when the marker is rewritten to match; that is what anchoring is for", () => {
      for (let i = 0; i < 3; i++) log.append(decision({ requestId: `req-${i}` }));
      disarmTriggers(log);
      const survivor = log.rows()[1]!;
      log.db.exec("DELETE FROM audit WHERE id = 3");
      log.db.prepare("UPDATE audit_head SET lastId = ?, lastHash = ?").run(survivor.id, survivor.hash);

      expect(log.verifyChain()).toBeNull();
    });
  });

  describe("head marker", () => {
    it("is absent on an empty log and tracks the tail after every append", () => {
      expect(log.head()).toBeNull();

      const first = log.append(decision());
      expect(log.head()).toEqual({ lastId: 1, lastHash: first.hash });

      const second = log.append(decision());
      expect(log.head()).toEqual({ lastId: 2, lastHash: second.hash });
    });

    it("is not moved by a rejected append", () => {
      const first = log.append(decision());
      expect(() => log.append(decision({ decision: "maybe" as AuditInput["decision"] }))).toThrow();

      expect(log.head()).toEqual({ lastId: 1, lastHash: first.hash });
      expect(log.verifyChain()).toBeNull();
    });
  });
});

describe("AuditLog on disk", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-audit-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the database file and its parent directory, and survives reopen", () => {
    const path = join(dir, "nested", "helpdesk.db");

    const first = AuditLog.open(path, { now: fixedClock() });
    first.append(requestRecord("req-1"));
    first.append(decision());
    first.close();

    const second = AuditLog.open(path);
    expect(second.list().map((r) => r.id)).toEqual([1, 2]);
    expect(second.verifyChain()).toBeNull();
    const third = second.append(decision({ result: [] }));
    expect(third.id).toBe(3);
    expect(second.verifyChain()).toBeNull();
    second.close();
  });

  it("keeps one chain when two connections append to the same file", () => {
    const path = join(dir, "helpdesk.db");
    const a = AuditLog.open(path, { now: fixedClock() });
    const b = AuditLog.open(path, { now: fixedClock() });

    for (let i = 0; i < 4; i++) {
      a.append(decision({ requestId: `a-${i}` }));
      b.append(decision({ requestId: `b-${i}` }));
    }

    expect(a.list().map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a.verifyChain()).toBeNull();
    expect(b.verifyChain()).toBeNull();
    a.close();
    b.close();
  });
});
