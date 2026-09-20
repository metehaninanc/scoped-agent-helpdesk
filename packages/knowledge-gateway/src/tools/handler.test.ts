import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditLog } from "@helpdesk/audit-core";
import { openDatabase } from "@helpdesk/gateway-core";

import type { SearchResult } from "../search.js";
import { Rule, type PolicyConfig } from "../policy/types.js";
import { handleToolCall, type GatewayDeps, type SessionContext } from "./handler.js";

const PASSAGE: SearchResult = {
  sourceTitle: "Learn about group types",
  heading: "Group types",
  text: "Security groups are used to manage access to shared resources.",
  sourceUrl: "https://github.com/MicrosoftDocs/entra-docs/blob/abc123/docs/fundamentals/concept-learn-about-groups.md",
};

const config: PolicyConfig = {};

const session: SessionContext = {
  actor: "helpdesk.operator@contoso.com",
  agent: "knowledge-agent",
  requestId: "req-1",
};

const payload = (result: Awaited<ReturnType<typeof handleToolCall>>): Record<string, unknown> => {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  return JSON.parse(first.text) as Record<string, unknown>;
};

describe("handleToolCall()", () => {
  let audit: AuditLog;
  let search: ReturnType<typeof vi.fn<(query: string) => SearchResult[]>>;
  let deps: GatewayDeps;
  let t: number;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    t = Date.UTC(2026, 8, 19, 12, 0, 0);
    const now = () => new Date((t += 1000));
    audit = new AuditLog(db, { now });
    search = vi.fn<(query: string) => SearchResult[]>(() => [PASSAGE]);
    deps = { audit, search, config, now };
  });

  afterEach(() => {
    audit.close();
  });

  describe("call order", () => {
    it("commits the audit record before the corpus is searched", async () => {
      let recordsWhenSearched = -1;
      search.mockImplementation((query: string) => {
        recordsWhenSearched = audit.list().length;
        return query ? [PASSAGE] : [];
      });

      await handleToolCall("search_documentation", { query: "groups" }, session, deps);

      expect(recordsWhenSearched).toBe(1);
      expect(audit.list()[0]).toMatchObject({ decision: "autonomous", tool: "search_documentation", result: null });
    });

    it("refuses to act at all if the audit record cannot be written", async () => {
      const broken: GatewayDeps = {
        ...deps,
        audit: {
          append: () => {
            throw new Error("disk full");
          },
        },
      };

      await expect(handleToolCall("search_documentation", { query: "groups" }, session, broken)).rejects.toThrow("disk full");
      expect(search).not.toHaveBeenCalled();
    });

    it("leaves evidence of the decision even when the search implementation throws", async () => {
      search.mockImplementation(() => {
        throw new Error("index not loaded");
      });

      const result = await handleToolCall("search_documentation", { query: "groups" }, session, deps);

      expect(result.isError).toBe(true);
      const records = audit.list();
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ decision: "autonomous", result: null });
      expect(records[1]).toMatchObject({ decision: "autonomous", result: { status: "error", code: "unknown", message: "index not loaded" } });
    });
  });

  describe("autonomous: search_documentation", () => {
    it("searches the corpus, returns the passages, and writes decision and result records", async () => {
      const result = await handleToolCall("search_documentation", { query: "what are group types" }, session, deps);

      expect(result.isError).toBeFalsy();
      expect(payload(result)).toEqual({ status: "ok", passages: [PASSAGE] });
      expect(search).toHaveBeenCalledWith("what are group types");

      const records = audit.list();
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        requestId: "req-1",
        actor: session.actor,
        agent: "knowledge-agent",
        tool: "search_documentation",
        parameters: { query: "what are group types" },
        decision: "autonomous",
        rules: [],
        result: null,
      });
      expect(records[1]).toMatchObject({ decision: "autonomous", result: { status: "ok", passages: [PASSAGE] } });
    });

    it("returns an empty passages array as a normal, successful result — not an error", async () => {
      search.mockReturnValue([]);
      const result = await handleToolCall("search_documentation", { query: "printer toner" }, session, deps);

      expect(result.isError).toBeFalsy();
      expect(payload(result)).toEqual({ status: "ok", passages: [] });
    });

    it("denies and audits a call missing the query parameter", async () => {
      const result = await handleToolCall("search_documentation", {}, session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
      expect(audit.list()).toHaveLength(1);
      expect(search).not.toHaveBeenCalled();
    });

    it("denies and audits a call that smuggles extra parameters in", async () => {
      const result = await handleToolCall("search_documentation", { query: "groups", extra: true }, session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
      expect(search).not.toHaveBeenCalled();
    });
  });

  describe("denied", () => {
    it("audits an unknown tool as a denial and calls nothing", async () => {
      const result = await handleToolCall("delete_documentation", {}, session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyUnknownTool] });
      expect(audit.list()[0]).toMatchObject({ tool: "delete_documentation", decision: "denied" });
      expect(search).not.toHaveBeenCalled();
    });

    it("survives arguments that are not an object", async () => {
      const result = await handleToolCall("search_documentation", "groups", session, deps);
      expect(payload(result)).toMatchObject({ status: "denied", rules: [Rule.DenyMalformedParameters] });
      expect(audit.list()[0]).toMatchObject({ decision: "denied", parameters: "groups" });
    });
  });

  it("has no approval path reachable: this gateway supplies no onApproval at all", async () => {
    const decide = vi.fn().mockReturnValue({ outcome: "approval", rules: [] });
    const result = await handleToolCall("search_documentation", { query: "groups" }, session, { ...deps, decide });

    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({ status: "error", code: "unsupported" });
    expect(search).not.toHaveBeenCalled();
  });

  it("stamps every record with the session's requestId, actor and agent", async () => {
    const other: SessionContext = { actor: "bob@contoso.com", agent: "other-agent", requestId: "req-9" };
    await handleToolCall("search_documentation", { query: "groups" }, other, deps);

    for (const record of audit.list()) {
      expect(record).toMatchObject({ requestId: "req-9", actor: "bob@contoso.com", agent: "other-agent" });
    }
  });
});
