import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import type { TokenValidationResult } from "../auth/verify-token.js";
import { createDecisionListener, type DecisionListenerDeps } from "./decision-listener.js";
import { ApprovalError } from "./workflow.js";

function fakeReq(overrides: { method?: string; url?: string; body?: unknown; rawBody?: string } = {}): IncomingMessage {
  const text = overrides.rawBody ?? (overrides.body === undefined ? "" : JSON.stringify(overrides.body));
  async function* chunks(): AsyncGenerator<Buffer> {
    if (text.length > 0) yield Buffer.from(text, "utf8");
  }
  const req = chunks() as unknown as IncomingMessage;
  Object.assign(req, { method: overrides.method ?? "POST", url: overrides.url ?? "/approvals/decide", headers: {} });
  return req;
}

interface FakeResponse {
  statusCode: number | undefined;
  body: string | undefined;
}

function fakeRes(): ServerResponse & FakeResponse {
  const res: FakeResponse & { writeHead: unknown; end: unknown } = {
    statusCode: undefined,
    body: undefined,
    writeHead(status: number) {
      res.statusCode = status;
      return res;
    },
    end(body?: string) {
      res.body = body;
    },
  };
  return res as unknown as ServerResponse & FakeResponse;
}

const VALID_TOKEN: TokenValidationResult = { ok: true, token: { clientId: "web-app", roles: ["Gateway.Invoke"], expiresAt: 0 } };

function deps(overrides: Partial<DecisionListenerDeps> = {}): DecisionListenerDeps & { audit: { append: ReturnType<typeof vi.fn> } } {
  return {
    workflow: { decide: vi.fn() },
    validator: { validate: vi.fn(async () => VALID_TOKEN) },
    audit: { append: vi.fn() },
    ...overrides,
  } as DecisionListenerDeps & { audit: { append: ReturnType<typeof vi.fn> } };
}

const VALID_BODY = { approvalId: "a1", decidedBy: "it.manager@contoso.com", decision: "approved" as const, note: "ok" };

describe("createDecisionListener()", () => {
  it("404s a request to a different path or method", async () => {
    const d = deps();
    const res = fakeRes();
    await createDecisionListener(d)(fakeReq({ url: "/other" }), res);
    expect(res.statusCode).toBe(404);

    const res2 = fakeRes();
    await createDecisionListener(d)(fakeReq({ method: "GET" }), res2);
    expect(res2.statusCode).toBe(404);
  });

  it("401s and audits a rejected token, never reaching the workflow", async () => {
    const d = deps({ validator: { validate: vi.fn(async (): Promise<TokenValidationResult> => ({ ok: false, reason: "audience_mismatch" })) } });
    const res = fakeRes();

    await createDecisionListener(d)(fakeReq({ body: VALID_BODY }), res);

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body ?? "{}")).toMatchObject({ code: "token_audience_mismatch" });
    expect(d.workflow.decide).not.toHaveBeenCalled();
    expect(d.audit.append).toHaveBeenCalledWith(expect.objectContaining({ decision: "denied", rules: ["deny.audience_mismatch"] }));
  });

  it("400s malformed JSON without touching the workflow", async () => {
    const d = deps();
    const res = fakeRes();

    await createDecisionListener(d)(fakeReq({ rawBody: "not json" }), res);

    expect(res.statusCode).toBe(400);
    expect(d.workflow.decide).not.toHaveBeenCalled();
  });

  it("400s a body missing required fields", async () => {
    const d = deps();
    const res = fakeRes();

    await createDecisionListener(d)(fakeReq({ body: { approvalId: "a1" } }), res);

    expect(res.statusCode).toBe(400);
    expect(d.workflow.decide).not.toHaveBeenCalled();
  });

  it("passes a well-formed, authenticated request straight to the workflow and returns its outcome", async () => {
    const outcome = {
      approval: {
        id: "a1",
        createdAt: "2026-09-17T00:00:00.000Z",
        requestId: "req-1",
        actor: "helpdesk.operator@contoso.com",
        tool: "add_user_to_group",
        params: {},
        rules: ["approval.add_user_to_group"],
        rationale: null,
        status: "approved" as const,
        decidedBy: "it.manager@contoso.com",
        decidedAt: "2026-09-17T00:01:00.000Z",
        decisionNote: "ok",
      },
      execution: { status: "executed" as const },
    };
    const d = deps({ workflow: { decide: vi.fn(async () => outcome) } });
    const res = fakeRes();

    await createDecisionListener(d)(fakeReq({ body: VALID_BODY }), res);

    expect(d.workflow.decide).toHaveBeenCalledWith(VALID_BODY);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? "{}")).toEqual(outcome);
    expect(d.audit.append).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_approver", 400],
    ["invalid_decision", 400],
    ["note_required", 400],
    ["not_found", 404],
    ["not_pending", 409],
    ["self_approval", 403],
  ] as const)("maps ApprovalError code %s to status %d", async (code, status) => {
    const d = deps({
      workflow: {
        decide: vi.fn(async () => {
          throw new ApprovalError(code, `boom: ${code}`);
        }),
      },
    });
    const res = fakeRes();

    await createDecisionListener(d)(fakeReq({ body: VALID_BODY }), res);

    expect(res.statusCode).toBe(status);
    expect(JSON.parse(res.body ?? "{}")).toEqual({ code, message: `boom: ${code}` });
  });

  it("lets an unexpected error propagate rather than swallowing it", async () => {
    const d = deps({
      workflow: {
        decide: vi.fn(async () => {
          throw new Error("disk full");
        }),
      },
    });

    await expect(createDecisionListener(d)(fakeReq({ body: VALID_BODY }), fakeRes())).rejects.toThrow("disk full");
  });

  it("serves a custom path when configured", async () => {
    const d = deps();
    const res = fakeRes();

    await createDecisionListener({ ...d, path: "/custom" })(fakeReq({ url: "/approvals/decide" }), res);

    expect(res.statusCode).toBe(404);
  });
});
