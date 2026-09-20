import { describe, expect, it } from "vitest";

import { sessionFromExtra, type ToolCallExtra } from "./session.js";

describe("sessionFromExtra()", () => {
  const extra = (over: Partial<ToolCallExtra>): ToolCallExtra => ({ signal: new AbortController().signal, ...over }) as ToolCallExtra;

  it("takes the agent identity from the validated token's client id, never a header", () => {
    const session = sessionFromExtra(
      extra({
        authInfo: { token: "x", clientId: "22222222-2222-4222-8222-222222222222", scopes: ["Gateway.Invoke"] },
        requestInfo: { headers: { "x-actor": "alice@contoso.com", "x-request-id": "req-1" } },
      }),
    );
    expect(session).toEqual({ actor: "alice@contoso.com", agent: "22222222-2222-4222-8222-222222222222", requestId: "req-1" });
  });

  it("takes actor and requestId from headers, never from authInfo", () => {
    const session = sessionFromExtra(
      extra({
        authInfo: { token: "x", clientId: "22222222-2222-4222-8222-222222222222", scopes: [] },
        requestInfo: { headers: { "x-actor": "bob@contoso.com", "x-request-id": "req-2", "x-other": "ignored" } },
      }),
    );
    expect(session.actor).toBe("bob@contoso.com");
    expect(session.requestId).toBe("req-2");
  });

  it("falls back to a placeholder when authInfo or requestInfo is absent, rather than throwing", () => {
    expect(sessionFromExtra(extra({}))).toEqual({ actor: "unknown", agent: "unknown", requestId: "unknown" });
  });

  it("takes the first value when a header repeats", () => {
    const session = sessionFromExtra(extra({ requestInfo: { headers: { "x-actor": ["first@contoso.com", "second@contoso.com"] } } }));
    expect(session.actor).toBe("first@contoso.com");
  });
});
