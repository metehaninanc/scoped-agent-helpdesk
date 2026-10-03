import type { IncomingMessage, ServerResponse } from "node:http";

import type { TokenValidationResult } from "@helpdesk/gateway-core";
import { describe, expect, it, vi } from "vitest";

import { createRationaleListener, type RationaleListenerDeps } from "./rationale-listener.js";
import { RationaleRequestError } from "./rationale-workflow.js";

function fakeReq(overrides: { method?: string; url?: string; body?: unknown; rawBody?: string } = {}): IncomingMessage {
  const text = overrides.rawBody ?? (overrides.body === undefined ? "" : JSON.stringify(overrides.body));
  async function* chunks(): AsyncGenerator<Buffer> {
    if (text.length > 0) yield Buffer.from(text, "utf8");
  }
  const req = chunks() as unknown as IncomingMessage;
  Object.assign(req, { method: overrides.method ?? "POST", url: overrides.url ?? "/approvals/rationale", headers: {} });
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

function deps(overrides: Partial<RationaleListenerDeps> = {}): RationaleListenerDeps & { audit: { append: ReturnType<typeof vi.fn> } } {
  return {
    workflow: { request: vi.fn() },
    validator: { validate: vi.fn(async () => VALID_TOKEN) },
    audit: { append: vi.fn() },
    ...overrides,
  } as RationaleListenerDeps & { audit: { append: ReturnType<typeof vi.fn> } };
}

const VALID_BODY = { approvalId: "a1", requestedBy: "it.manager@contoso.com" };

const APPROVAL_WITH_RATIONALE = {
  id: "a1",
  createdAt: "2026-09-16T12:00:00.000Z",
  requestId: "req-1",
  actor: "helpdesk.operator@contoso.com",
  tool: "add_user_to_group",
  params: {},
  rules: ["approval.add_user_to_group"],
  rationale: "What is being requested\n...",
  status: "pending" as const,
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
};

describe("createRationaleListener()", () => {
  it("404s a request to a different path or method", async () => {
    const d = deps();
    const res = fakeRes();
    await createRationaleListener(d)(fakeReq({ url: "/other" }), res);
    expect(res.statusCode).toBe(404);

    const res2 = fakeRes();
    await createRationaleListener(d)(fakeReq({ method: "GET" }), res2);
    expect(res2.statusCode).toBe(404);
  });

  it("401s and audits a rejected token, never reaching the workflow", async () => {
    const d = deps({ validator: { validate: vi.fn(async (): Promise<TokenValidationResult> => ({ ok: false, reason: "audience_mismatch" })) } });
    const res = fakeRes();

    await createRationaleListener(d)(fakeReq({ body: VALID_BODY }), res);

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body ?? "{}")).toMatchObject({ code: "token_audience_mismatch" });
    expect(d.workflow.request).not.toHaveBeenCalled();
    expect(d.audit.append).toHaveBeenCalledWith(expect.objectContaining({ decision: "denied", rules: ["deny.audience_mismatch"] }));
  });

  it("400s malformed JSON without touching the workflow", async () => {
    const d = deps();
    const res = fakeRes();

    await createRationaleListener(d)(fakeReq({ rawBody: "not json" }), res);

    expect(res.statusCode).toBe(400);
    expect(d.workflow.request).not.toHaveBeenCalled();
  });

  it("400s a body missing required fields", async () => {
    const d = deps();
    const res = fakeRes();

    await createRationaleListener(d)(fakeReq({ body: { approvalId: "a1" } }), res);

    expect(res.statusCode).toBe(400);
    expect(d.workflow.request).not.toHaveBeenCalled();
  });

  it("passes a well-formed, authenticated request straight to the workflow and returns the updated approval", async () => {
    const d = deps({ workflow: { request: vi.fn(async () => APPROVAL_WITH_RATIONALE) } });
    const res = fakeRes();

    await createRationaleListener(d)(fakeReq({ body: VALID_BODY }), res);

    expect(d.workflow.request).toHaveBeenCalledWith(VALID_BODY);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? "{}")).toEqual(APPROVAL_WITH_RATIONALE);
    expect(d.audit.append).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_requester", 400],
    ["not_found", 404],
    ["not_pending", 409],
    ["already_generated", 409],
    ["generation_failed", 502],
  ] as const)("maps RationaleRequestError code %s to status %d", async (code, status) => {
    const d = deps({
      workflow: {
        request: vi.fn(async () => {
          throw new RationaleRequestError(code, `boom: ${code}`);
        }),
      },
    });
    const res = fakeRes();

    await createRationaleListener(d)(fakeReq({ body: VALID_BODY }), res);

    expect(res.statusCode).toBe(status);
    expect(JSON.parse(res.body ?? "{}")).toEqual({ code, message: `boom: ${code}` });
  });

  it("lets an unexpected error propagate rather than swallowing it", async () => {
    const d = deps({
      workflow: {
        request: vi.fn(async () => {
          throw new Error("disk full");
        }),
      },
    });

    await expect(createRationaleListener(d)(fakeReq({ body: VALID_BODY }), fakeRes())).rejects.toThrow("disk full");
  });

  it("serves a custom path when configured", async () => {
    const d = deps();
    const res = fakeRes();

    await createRationaleListener({ ...d, path: "/custom" })(fakeReq({ url: "/approvals/rationale" }), res);

    expect(res.statusCode).toBe(404);
  });
});
