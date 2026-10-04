import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditInput, AuditRecord } from "@helpdesk/audit-core";

import { HandoffError, HandoffStore, type HandoffCreateInput } from "./store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** This package takes no position on how a database is opened — a caller concern, the same rule
 * @helpdesk/audit-core follows. See that package's own audit-log.test.ts for the same pattern. */
function openTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  return db;
}

function fakeAudit() {
  const records: AuditInput[] = [];
  return {
    records,
    append: vi.fn((input: AuditInput): AuditRecord => {
      records.push(input);
      return {
        id: records.length,
        timestamp: new Date().toISOString(),
        requestId: input.requestId,
        actor: input.actor,
        agent: input.agent,
        tool: input.tool ?? null,
        parameters: input.parameters,
        decision: input.decision,
        rules: [...(input.rules ?? [])],
        result: input.result ?? null,
        prevHash: "x",
        hash: "y",
      };
    }),
  };
}

const input = (overrides: Partial<HandoffCreateInput> = {}): HandoffCreateInput => ({
  requestId: "req-1",
  actor: "alice@contoso.com",
  requestText: "my laptop screen is cracked",
  createdBy: "orchestrator",
  reason: "needs a replacement device",
  ...overrides,
});

describe("HandoffStore", () => {
  let db: DatabaseSync;
  let audit: ReturnType<typeof fakeAudit>;
  let store: HandoffStore;
  let t = Date.UTC(2026, 8, 15, 12, 0, 0);

  beforeEach(() => {
    db = openTestDb();
    audit = fakeAudit();
    store = new HandoffStore(db, audit, { now: () => new Date((t += 1000)) });
  });

  afterEach(() => {
    store.close();
  });

  describe("create()", () => {
    it("creates an open record with a fresh uuid and the facts as given", () => {
      const record = store.create(input());

      expect(record.id).toMatch(UUID);
      expect(record).toMatchObject({
        status: "open",
        requestId: "req-1",
        actor: "alice@contoso.com",
        requestText: "my laptop screen is cracked",
        createdBy: "orchestrator",
        reason: "needs a replacement device",
        takenBy: null,
        takenAt: null,
        resolvedBy: null,
        resolvedAt: null,
        resolutionNote: null,
      });
      expect(record.createdAt).toBe("2026-09-15T12:00:01.000Z");
    });

    it("audits a handoff record before the row exists, carrying the reason and requestText", () => {
      let rowExistedDuringAudit: boolean | null = null;
      let audited: AuditInput | null = null;
      audit.append.mockImplementationOnce((inp: AuditInput) => {
        // The row can't exist yet: its id is generated before create() calls audit.append(), but
        // the INSERT itself runs only after this call returns.
        const anyRow = db.prepare("SELECT 1 FROM handoffs").get();
        rowExistedDuringAudit = anyRow !== undefined;
        audited = inp;
        return {
          id: 1,
          timestamp: "t",
          requestId: inp.requestId,
          actor: inp.actor,
          agent: inp.agent,
          tool: inp.tool ?? null,
          parameters: inp.parameters,
          decision: inp.decision,
          rules: [...(inp.rules ?? [])],
          result: inp.result ?? null,
          prevHash: "x",
          hash: "y",
        };
      });

      store.create(input());

      expect(rowExistedDuringAudit).toBe(false);
      expect(audited).toMatchObject({
        requestId: "req-1",
        actor: "alice@contoso.com",
        agent: "orchestrator",
        tool: null,
        decision: "handoff",
        parameters: { requestText: "my laptop screen is cracked", reason: "needs a replacement device" },
        rules: [],
      });
    });

    it("reads a record back by id, and null for an unknown id", () => {
      const created = store.create(input());
      expect(store.get(created.id)).toEqual(created);
      expect(store.get("00000000-0000-4000-8000-000000000000")).toBeNull();
    });
  });

  describe("take()", () => {
    it("moves an open handoff to taken, with no note required", () => {
      const created = store.create(input());

      const taken = store.take(created.id, "helpdesk.operator@contoso.com");

      expect(taken).toMatchObject({ status: "taken", takenBy: "helpdesk.operator@contoso.com" });
      expect(taken.takenAt).not.toBeNull();
    });

    it("audits handoff_taken, naming who and the handoffId, with no note field at all", () => {
      const created = store.create(input());
      audit.records.length = 0;

      store.take(created.id, "helpdesk.operator@contoso.com");

      expect(audit.records).toHaveLength(1);
      expect(audit.records[0]).toMatchObject({
        actor: "helpdesk.operator@contoso.com",
        decision: "handoff_taken",
        parameters: null,
        result: { handoffId: created.id },
      });
    });

    it("throws not_found for an unknown id", () => {
      expect(() => store.take("00000000-0000-4000-8000-000000000000", "op@contoso.com")).toThrow(HandoffError);
    });

    it("refuses to take an already-taken handoff (decided/moved at most once)", () => {
      const created = store.create(input());
      store.take(created.id, "op1@contoso.com");

      const failure = (() => {
        try {
          store.take(created.id, "op2@contoso.com");
          return null;
        } catch (e) {
          return e;
        }
      })();

      expect(failure).toBeInstanceOf(HandoffError);
      expect((failure as InstanceType<typeof HandoffError>).code).toBe("not_open");
    });

    it("refuses to take an already-resolved handoff", () => {
      const created = store.create(input());
      store.take(created.id, "op@contoso.com");
      store.resolve(created.id, "op@contoso.com", "replaced the device");

      expect(() => store.take(created.id, "op2@contoso.com")).toThrow(HandoffError);
    });
  });

  describe("resolve()", () => {
    it("moves a taken handoff to resolved, with the trimmed note", () => {
      const created = store.create(input());
      store.take(created.id, "op@contoso.com");

      const resolved = store.resolve(created.id, "op@contoso.com", "  replaced the device  ");

      expect(resolved).toMatchObject({ status: "resolved", resolvedBy: "op@contoso.com", resolutionNote: "replaced the device" });
      expect(resolved.resolvedAt).not.toBeNull();
    });

    it("audits handoff_resolved with the resolution note", () => {
      const created = store.create(input());
      store.take(created.id, "op@contoso.com");
      audit.records.length = 0;

      store.resolve(created.id, "op@contoso.com", "replaced the device");

      expect(audit.records).toHaveLength(1);
      expect(audit.records[0]).toMatchObject({
        decision: "handoff_resolved",
        result: { handoffId: created.id, resolutionNote: "replaced the device" },
      });
    });

    it("requires a non-empty note, and writes nothing when it is missing", () => {
      const created = store.create(input());
      store.take(created.id, "op@contoso.com");
      audit.records.length = 0;

      const failure = (() => {
        try {
          store.resolve(created.id, "op@contoso.com", "   ");
          return null;
        } catch (e) {
          return e;
        }
      })();

      expect(failure).toBeInstanceOf(HandoffError);
      expect((failure as InstanceType<typeof HandoffError>).code).toBe("note_required");
      expect(audit.records).toHaveLength(0);
      expect(store.get(created.id)?.status).toBe("taken");
    });

    it("refuses to resolve a handoff that was never taken", () => {
      const created = store.create(input());

      const failure = (() => {
        try {
          store.resolve(created.id, "op@contoso.com", "a note");
          return null;
        } catch (e) {
          return e;
        }
      })();

      expect(failure).toBeInstanceOf(HandoffError);
      expect((failure as InstanceType<typeof HandoffError>).code).toBe("not_taken");
    });

    it("refuses to resolve an already-resolved handoff", () => {
      const created = store.create(input());
      store.take(created.id, "op@contoso.com");
      store.resolve(created.id, "op@contoso.com", "first note");

      expect(() => store.resolve(created.id, "op@contoso.com", "second note")).toThrow(HandoffError);
    });
  });

  describe("urgent", () => {
    it("is false unless asked for, and is written to the audit record when it is", () => {
      const plain = store.create(input({ requestId: "req-plain" }));
      const flagged = store.create(input({ requestId: "req-flagged", urgent: true }));

      expect(plain.urgent).toBe(false);
      expect(flagged.urgent).toBe(true);
      expect(store.get(flagged.id)?.urgent).toBe(true);
      expect(audit.records[0]?.parameters).toMatchObject({ urgent: false });
      expect(audit.records[1]?.parameters).toMatchObject({ urgent: true });
    });

    it("is added in place to a handoffs table that predates it, and old rows read as not urgent", () => {
      const legacy = openTestDb();
      legacy.exec(`CREATE TABLE handoffs (
        id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, requestId TEXT NOT NULL, actor TEXT NOT NULL,
        requestText TEXT NOT NULL, createdBy TEXT NOT NULL, reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'taken', 'resolved')),
        takenBy TEXT, takenAt TEXT, resolvedBy TEXT, resolvedAt TEXT, resolutionNote TEXT)`);
      legacy
        .prepare("INSERT INTO handoffs VALUES ('old-1', '2026-09-01T00:00:00.000Z', 'r', 'a@x', 'text', 'orchestrator', 'why', 'open', NULL, NULL, NULL, NULL, NULL)")
        .run();

      const migrated = new HandoffStore(legacy, fakeAudit());
      expect(migrated.get("old-1")?.urgent).toBe(false);
      const fresh = migrated.create(input({ urgent: true }));
      expect(migrated.listOpen().map((r) => r.id)).toEqual([fresh.id, "old-1"]);
      // Opening it a second time does not try to add the column again.
      expect(() => new HandoffStore(legacy, fakeAudit())).not.toThrow();
      migrated.close();
    });
  });

  describe("listOpen() / listActive()", () => {
    it("lists only open records, oldest first", () => {
      const a = store.create(input({ requestId: "req-a" }));
      const b = store.create(input({ requestId: "req-b" }));
      store.take(b.id, "op@contoso.com");

      expect(store.listOpen().map((r) => r.id)).toEqual([a.id]);
    });

    it("puts an urgent handoff above every older non-urgent one, whatever its age", () => {
      const old = store.create(input({ requestId: "req-old" }));
      const older = store.create(input({ requestId: "req-older" }));
      const urgent = store.create(input({ requestId: "req-urgent", urgent: true }));

      expect(store.listOpen().map((r) => r.id)).toEqual([urgent.id, old.id, older.id]);
      expect(store.listActive().map((r) => r.id)).toEqual([urgent.id, old.id, older.id]);
    });

    it("keeps oldest-first order inside each urgency, and an urgent item stays on top once taken", () => {
      const a = store.create(input({ requestId: "req-a" }));
      const u1 = store.create(input({ requestId: "req-u1", urgent: true }));
      const b = store.create(input({ requestId: "req-b" }));
      const u2 = store.create(input({ requestId: "req-u2", urgent: true }));
      store.take(u1.id, "op@contoso.com");

      expect(store.listActive().map((r) => r.id)).toEqual([u1.id, u2.id, a.id, b.id]);
      expect(store.listOpen().map((r) => r.id)).toEqual([u2.id, a.id, b.id]);
    });

    it("lists open and taken together, but never resolved", () => {
      const open = store.create(input({ requestId: "req-open" }));
      const taken = store.create(input({ requestId: "req-taken" }));
      store.take(taken.id, "op@contoso.com");
      const resolved = store.create(input({ requestId: "req-resolved" }));
      store.take(resolved.id, "op@contoso.com");
      store.resolve(resolved.id, "op@contoso.com", "done");

      expect(store.listActive().map((r) => r.id)).toEqual([open.id, taken.id]);
    });
  });
});
