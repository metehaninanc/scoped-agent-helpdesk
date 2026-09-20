import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import type { TokenValidationResult } from "./auth/verify-token.js";
import { createRequestListener, type HttpGatewayDeps } from "./http-listener.js";

function fakeReq(overrides: { url?: string; headers?: Record<string, string | string[] | undefined> } = {}): IncomingMessage {
  return { url: overrides.url ?? "/mcp", headers: overrides.headers ?? {} } as unknown as IncomingMessage;
}

interface FakeResponse {
  statusCode: number | undefined;
  headers: Record<string, string> | undefined;
  body: string | undefined;
}

function fakeRes(): ServerResponse & FakeResponse {
  const res: FakeResponse & { writeHead: unknown; end: unknown } = {
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    writeHead(status: number, headers?: Record<string, string>) {
      res.statusCode = status;
      res.headers = headers;
      return res;
    },
    end(body?: string) {
      res.body = body;
    },
  };
  return res as unknown as ServerResponse & FakeResponse;
}

function deps(
  overrides: Partial<HttpGatewayDeps> = {},
): HttpGatewayDeps & { audit: { append: ReturnType<typeof vi.fn> }; handleRequest: ReturnType<typeof vi.fn> } {
  const handleRequest = vi.fn(async () => undefined);
  return {
    createTransport: vi.fn(async () => ({ handleRequest })),
    validator: { validate: vi.fn(async (): Promise<TokenValidationResult> => ({ ok: false, reason: "missing_token" })) },
    audit: { append: vi.fn() },
    handleRequest,
    ...overrides,
  } as HttpGatewayDeps & { audit: { append: ReturnType<typeof vi.fn> }; handleRequest: ReturnType<typeof vi.fn> };
}

describe("createRequestListener()", () => {
  it("404s a request to a different path, without touching the transport or the validator", async () => {
    const d = deps();
    const listener = createRequestListener(d);
    const res = fakeRes();

    await listener(fakeReq({ url: "/other" }), res);

    expect(res.statusCode).toBe(404);
    expect(d.handleRequest).not.toHaveBeenCalled();
    expect(d.validator.validate).not.toHaveBeenCalled();
    expect(d.audit.append).not.toHaveBeenCalled();
  });

  it("401s and audits a rejected token, naming the reason, never reaching the transport", async () => {
    const d = deps({ validator: { validate: vi.fn(async (): Promise<TokenValidationResult> => ({ ok: false, reason: "audience_mismatch" })) } });
    const listener = createRequestListener(d);
    const res = fakeRes();

    await listener(fakeReq({ headers: { authorization: "Bearer x", "x-actor": "alice@contoso.com", "x-request-id": "req-1" } }), res);

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body ?? "{}")).toMatchObject({ status: "error", code: "token_audience_mismatch" });
    expect(d.handleRequest).not.toHaveBeenCalled();
    expect(d.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req-1", actor: "alice@contoso.com", decision: "denied", rules: ["deny.audience_mismatch"] }),
    );
  });

  it("audits a rejected token as actor=unknown when the actor header is absent", async () => {
    const d = deps();
    await createRequestListener(d)(fakeReq(), fakeRes());

    expect(d.audit.append).toHaveBeenCalledWith(expect.objectContaining({ actor: "unknown", rules: ["deny.missing_token"] }));
  });

  it("generates a requestId when x-request-id is absent, so the rejection is still auditable", async () => {
    const d = deps();
    await createRequestListener(d)(fakeReq(), fakeRes());

    const call = d.audit.append.mock.calls[0]?.[0] as { requestId: string };
    expect(typeof call.requestId).toBe("string");
    expect(call.requestId.length).toBeGreaterThan(0);
  });

  it("400s and audits a valid token missing the x-actor header, never reaching the transport", async () => {
    const d = deps({
      validator: {
        validate: vi.fn(async (): Promise<TokenValidationResult> => ({ ok: true, token: { clientId: "agent-1", roles: ["Gateway.Invoke"], expiresAt: 0 } })),
      },
    });
    const res = fakeRes();

    await createRequestListener(d)(fakeReq({ headers: { authorization: "Bearer good", "x-request-id": "req-1" } }), res);

    expect(res.statusCode).toBe(400);
    expect(d.handleRequest).not.toHaveBeenCalled();
    expect(d.audit.append).toHaveBeenCalledWith(expect.objectContaining({ agent: "agent-1", rules: ["deny.missing_actor_header"] }));
  });

  it("passes a valid, fully-headered request straight to the transport and audits nothing itself", async () => {
    const d = deps({
      validator: {
        validate: vi.fn(async (): Promise<TokenValidationResult> => ({ ok: true, token: { clientId: "agent-1", roles: ["Gateway.Invoke"], expiresAt: 0 } })),
      },
    });
    const req = fakeReq({ headers: { authorization: "Bearer good", "x-actor": "alice@contoso.com", "x-request-id": "req-1" } });

    await createRequestListener(d)(req, fakeRes());

    expect(d.audit.append).not.toHaveBeenCalled();
    expect(d.handleRequest).toHaveBeenCalledTimes(1);
    expect((req as IncomingMessage & { auth?: unknown }).auth).toEqual({ token: "", clientId: "agent-1", scopes: ["Gateway.Invoke"] });
  });

  it("never attaches auth info or reaches the transport for a rejected token", async () => {
    const d = deps();
    const req = fakeReq({ headers: { "x-actor": "alice@contoso.com" } });

    await createRequestListener(d)(req, fakeRes());

    expect((req as IncomingMessage & { auth?: unknown }).auth).toBeUndefined();
  });

  it("takes the first value when a header repeats", async () => {
    const d = deps({
      validator: { validate: vi.fn(async (): Promise<TokenValidationResult> => ({ ok: true, token: { clientId: "agent-1", roles: [], expiresAt: 0 } })) },
    });
    const req = fakeReq({
      headers: { authorization: "Bearer good", "x-actor": ["first@contoso.com", "second@contoso.com"], "x-request-id": "req-1" },
    });

    await createRequestListener(d)(req, fakeRes());

    expect(d.handleRequest).toHaveBeenCalled();
  });

  it("serves a custom path when configured", async () => {
    const d = deps();
    const res = fakeRes();

    await createRequestListener({ ...d, path: "/gateway" })(fakeReq({ url: "/mcp" }), res);

    expect(res.statusCode).toBe(404);
  });
});
