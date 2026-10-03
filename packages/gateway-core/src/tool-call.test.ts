import { AuditLog } from "@helpdesk/audit-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "./db.js";
import type { SessionContext } from "./session.js";
import { runToolCall, type ErrorOutput, type RunToolCallDeps } from "./tool-call.js";

// A minimal fake gateway: one autonomous tool ("read"), one approval-gated tool ("write"),
// everything else unknown. Exercises the generic call order without any real gateway's schemas.

type RuleId = "deny.unknown_tool" | "deny.malformed_parameters" | "deny.blocked" | "approval.write" | "autonomous.read";
type Validated = { tool: "read" | "write"; params: { value: string } };
type Ok = { status: "ok"; echoed: string };

function decide(request: { tool: string; params: unknown }): { outcome: "autonomous" | "approval" | "denied"; rules: RuleId[] } | { outcome: "autonomous" } {
  const params = request.params as { value?: unknown };
  if (request.tool !== "read" && request.tool !== "write") return { outcome: "denied", rules: ["deny.unknown_tool"] };
  if (typeof params.value !== "string") return { outcome: "denied", rules: ["deny.malformed_parameters"] };
  if (params.value === "blocked") return { outcome: "denied", rules: ["deny.blocked"] };
  if (request.tool === "write") return { outcome: "approval", rules: ["approval.write"] };
  return { outcome: "autonomous" };
}

function parse(request: { tool: string; params: unknown }): { ok: true; request: Validated } | { ok: false } {
  if (request.tool !== "read" && request.tool !== "write") return { ok: false };
  const params = request.params as { value?: unknown };
  if (typeof params.value !== "string") return { ok: false };
  return { ok: true, request: { tool: request.tool, params: { value: params.value } } };
}

const session: SessionContext = { actor: "alice@contoso.com", agent: "test-agent", requestId: "req-1", requestText: "test request" };

const payload = (result: Awaited<ReturnType<typeof runToolCall>>): Record<string, unknown> => {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  return JSON.parse(first.text) as Record<string, unknown>;
};

describe("runToolCall()", () => {
  let audit: AuditLog;
  let execute: ReturnType<typeof vi.fn<(request: Validated) => Promise<Ok>>>;
  let deps: RunToolCallDeps<Record<string, never>, RuleId, Validated, Ok>;

  beforeEach(() => {
    audit = new AuditLog(openDatabase(":memory:"));
    execute = vi.fn(async (request: Validated) => ({ status: "ok" as const, echoed: request.params.value }));
    deps = {
      audit,
      decide: decide as RunToolCallDeps<Record<string, never>, RuleId, Validated, Ok>["decide"],
      config: {},
      parse,
      execute,
      deniedMessageSuffix: "Nothing happened.",
    };
  });

  afterEach(() => {
    audit.close();
  });

  it("commits the audit record before execute() runs", async () => {
    let recordsWhenExecuted = -1;
    execute.mockImplementation(async (request) => {
      recordsWhenExecuted = audit.list().length;
      return { status: "ok", echoed: request.params.value };
    });

    await runToolCall("read", { value: "hi" }, session, deps);

    expect(recordsWhenExecuted).toBe(1);
    expect(audit.list()[0]).toMatchObject({ decision: "autonomous", tool: "read", result: null });
  });

  it("denies and audits an unknown tool without calling execute()", async () => {
    const result = await runToolCall("delete_everything", {}, session, deps);

    expect(payload(result)).toMatchObject({ status: "denied", rules: ["deny.unknown_tool"] });
    expect(audit.list()[0]).toMatchObject({ tool: "delete_everything", decision: "denied", rules: ["deny.unknown_tool"] });
    expect(execute).not.toHaveBeenCalled();
  });

  it("denies and audits malformed input rather than throwing", async () => {
    const result = await runToolCall("read", { value: 42 }, session, deps);

    expect(payload(result)).toMatchObject({ status: "denied", rules: ["deny.malformed_parameters"] });
    expect(audit.list()[0]).toMatchObject({ decision: "denied", parameters: { value: 42 } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("denies and audits arguments that are not an object, rather than throwing", async () => {
    const result = await runToolCall("read", "not-an-object", session, deps);
    expect(payload(result)).toMatchObject({ status: "denied", rules: ["deny.malformed_parameters"] });
  });

  it("treats a missing arguments object as the empty parameter set", async () => {
    const result = await runToolCall("read", undefined, session, deps);
    expect(payload(result)).toMatchObject({ status: "denied", rules: ["deny.malformed_parameters"] });
  });

  it("runs the autonomous branch and writes a second audit record with the result", async () => {
    const result = await runToolCall("read", { value: "hi" }, session, deps);

    expect(payload(result)).toEqual({ status: "ok", echoed: "hi" });
    const records = audit.list();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ decision: "autonomous", rules: [], result: null });
    expect(records[1]).toMatchObject({ decision: "autonomous", result: { status: "ok", echoed: "hi" } });
  });

  it("converts a thrown error with the default describeError when the backend fails", async () => {
    execute.mockRejectedValue(new Error("backend exploded"));

    const result = await runToolCall("read", { value: "hi" }, session, deps);

    expect(result.isError).toBe(true);
    expect(payload(result)).toEqual({ status: "error", code: "unknown", message: "backend exploded" });
    expect(audit.list()[1]?.result).toEqual({ status: "error", code: "unknown", message: "backend exploded" });
  });

  it("uses a supplied describeError for a backend-specific error taxonomy", async () => {
    class BackendError extends Error {
      constructor(readonly code: string) {
        super(`backend: ${code}`);
      }
    }
    execute.mockRejectedValue(new BackendError("not_found"));
    const describeError = (error: unknown): ErrorOutput =>
      error instanceof BackendError ? { status: "error", code: error.code, message: error.message } : { status: "error", code: "unknown", message: String(error) };

    const result = await runToolCall("read", { value: "hi" }, session, { ...deps, describeError });

    expect(payload(result)).toEqual({ status: "error", code: "not_found", message: "backend: not_found" });
  });

  it("fails loudly rather than executing, when a decision is 'approval' and no onApproval is supplied", async () => {
    const result = await runToolCall("write", { value: "hi" }, session, deps);

    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({ status: "error", code: "unsupported" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("calls onApproval when supplied, after the decision audit record is already committed", async () => {
    let recordsWhenApproved = -1;
    const onApproval = vi.fn(async () => {
      recordsWhenApproved = audit.list().length;
      return { status: "pending_approval" as const, approvalId: "app-1" };
    });

    const result = await runToolCall("write", { value: "hi" }, session, { ...deps, onApproval });

    expect(result.isError).toBeFalsy();
    expect(payload(result)).toEqual({ status: "pending_approval", approvalId: "app-1" });
    expect(recordsWhenApproved).toBe(1);
    expect(onApproval).toHaveBeenCalledWith({ tool: "write", params: { value: "hi" } }, ["approval.write"], session);
  });

  it("reports onApproval's own error output as an error", async () => {
    const onApproval = vi.fn(async () => ({ status: "error" as const, code: "approval_store_unavailable", message: "disk full" }));

    const result = await runToolCall("write", { value: "hi" }, session, { ...deps, onApproval });

    expect(result.isError).toBe(true);
    expect(payload(result)).toEqual({ status: "error", code: "approval_store_unavailable", message: "disk full" });
  });

  it("denies a deny-tier match even though decide's outcome comes before checking parsed.ok", async () => {
    const result = await runToolCall("read", { value: "blocked" }, session, deps);
    expect(payload(result)).toMatchObject({ status: "denied", rules: ["deny.blocked"] });
  });

  it("refuses to act at all if the audit record cannot be written", async () => {
    const broken = { ...deps, audit: { append: () => { throw new Error("disk full"); } } };
    await expect(runToolCall("read", { value: "hi" }, session, broken)).rejects.toThrow("disk full");
    expect(execute).not.toHaveBeenCalled();
  });

  it("stamps every record with the session's requestId, actor and agent", async () => {
    const other: SessionContext = { actor: "bob@contoso.com", agent: "other-agent", requestId: "req-9", requestText: "test request" };
    await runToolCall("read", { value: "hi" }, other, deps);

    for (const record of audit.list()) {
      expect(record).toMatchObject({ requestId: "req-9", actor: "bob@contoso.com", agent: "other-agent" });
    }
  });

  it("passes the session actor and the clock into the policy context", async () => {
    const t = Date.UTC(2026, 8, 15, 12, 0, 0);
    const decideSpy = vi.fn().mockReturnValue({ outcome: "denied", rules: ["deny.blocked"] });

    await runToolCall("read", { value: "hi" }, session, { ...deps, decide: decideSpy, now: () => new Date(t) });

    expect(decideSpy).toHaveBeenCalledWith(
      { tool: "read", params: { value: "hi" } },
      { actor: session.actor, agent: session.agent, timestamp: "2026-09-15T12:00:00.000Z" },
      {},
    );
  });

  it("uses the denied message suffix this gateway supplied", async () => {
    const result = await runToolCall("read", { value: "blocked" }, session, { ...deps, deniedMessageSuffix: "Custom suffix." });
    expect(payload(result)).toMatchObject({ message: "Refused by policy: deny.blocked. Custom suffix." });
  });
});
