import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db.js";
import { ApprovalStore, type ApprovalCreateInput } from "./store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const input = (overrides: Partial<ApprovalCreateInput> = {}): ApprovalCreateInput => ({
  requestId: "req-1",
  actor: "helpdesk.operator@contoso.com",
  tool: "add_user_to_group",
  params: { userPrincipalName: "alice@contoso.com", groupId: "20a26e53-1cbd-48e3-8cc4-8d86cece7a6a" },
  rules: ["approval.add_user_to_group"],
  ...overrides,
});

describe("ApprovalStore", () => {
  let store: ApprovalStore;
  let t = Date.UTC(2026, 8, 15, 12, 0, 0);

  beforeEach(() => {
    store = new ApprovalStore(openDatabase(":memory:"), { now: () => new Date((t += 1000)) });
  });

  afterEach(() => {
    store.close();
  });

  it("creates a pending record with a fresh uuid and the facts as given", () => {
    const record = store.create(input());

    expect(record.id).toMatch(UUID);
    expect(record).toMatchObject({
      status: "pending",
      requestId: "req-1",
      actor: "helpdesk.operator@contoso.com",
      tool: "add_user_to_group",
      params: { userPrincipalName: "alice@contoso.com", groupId: "20a26e53-1cbd-48e3-8cc4-8d86cece7a6a" },
      rules: ["approval.add_user_to_group"],
      rationale: null,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
    });
    expect(record.createdAt).toBe("2026-09-15T12:00:01.000Z");
  });

  it("reads a record back by id, and null for an unknown id", () => {
    const created = store.create(input());
    expect(store.get(created.id)).toEqual(created);
    expect(store.get("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("stores a rationale when one is supplied at creation", () => {
    const record = store.create(input({ rationale: "What is requested: ..." }));
    expect(store.get(record.id)?.rationale).toBe("What is requested: ...");
  });

  it("lists pending records oldest first", () => {
    const a = store.create(input({ requestId: "req-a" }));
    const b = store.create(input({ requestId: "req-b" }));
    expect(store.listPending().map((r) => r.id)).toEqual([a.id, b.id]);
  });

  it("gives every record its own id even for identical facts", () => {
    const a = store.create(input());
    const b = store.create(input());
    expect(a.id).not.toBe(b.id);
  });

  describe("setRationale()", () => {
    it("attaches generated text to a pending record, verbatim", () => {
      const record = store.create(input());
      const text = "What is being requested\n  odd   spacing kept\n\n";

      store.setRationale(record.id, text);

      expect(store.get(record.id)?.rationale).toBe(text);
    });

    it("throws for an unknown id", () => {
      expect(() => store.setRationale("00000000-0000-4000-8000-000000000000", "x")).toThrow(/not found/);
    });
  });

  describe("recordVerdict()", () => {
    it("moves a pending record to approved with the approver, time and note", () => {
      const record = store.create(input());

      const updated = store.recordVerdict(record.id, {
        status: "approved",
        decidedBy: "approver@contoso.com",
        decisionNote: "Confirmed with the team lead.",
      });

      expect(updated).toMatchObject({
        id: record.id,
        status: "approved",
        decidedBy: "approver@contoso.com",
        decisionNote: "Confirmed with the team lead.",
      });
      // The clock ticks one second per call: created on one tick, decided on the next.
      expect(Date.parse(updated.decidedAt!) - Date.parse(record.createdAt)).toBe(1000);
      expect(store.get(record.id)).toEqual(updated);
      expect(store.listPending()).toEqual([]);
    });

    it("moves a pending record to rejected", () => {
      const record = store.create(input());
      store.recordVerdict(record.id, { status: "rejected", decidedBy: "approver@contoso.com", decisionNote: "No." });
      expect(store.get(record.id)?.status).toBe("rejected");
    });

    it("refuses to decide a record twice", () => {
      const record = store.create(input());
      store.recordVerdict(record.id, { status: "approved", decidedBy: "approver@contoso.com", decisionNote: "ok" });

      expect(() =>
        store.recordVerdict(record.id, { status: "rejected", decidedBy: "other@contoso.com", decisionNote: "no" }),
      ).toThrow(/not pending/);
      expect(store.get(record.id)?.decidedBy).toBe("approver@contoso.com");
    });

    it("throws for an unknown id", () => {
      expect(() =>
        store.recordVerdict("00000000-0000-4000-8000-000000000000", {
          status: "approved",
          decidedBy: "approver@contoso.com",
          decisionNote: "ok",
        }),
      ).toThrow(/not pending/);
    });
  });
});
