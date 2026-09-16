import { describe, expect, it, vi } from "vitest";

import { renderRequestForm, submitRequest, type SubmitRequestDeps } from "./request-page.js";

describe("submitRequest()", () => {
  it("rejects an empty identity without calling the agent", async () => {
    const runIdentityAgent = vi.fn();
    const result = await submitRequest({ actor: "  ", requestText: "which groups is bob in" }, { runIdentityAgent });

    expect(result).toEqual({ status: "invalid", message: "Your identity is required." });
    expect(runIdentityAgent).not.toHaveBeenCalled();
  });

  it("rejects an empty request without calling the agent", async () => {
    const runIdentityAgent = vi.fn();
    const result = await submitRequest({ actor: "alice@contoso.com", requestText: "   " }, { runIdentityAgent });

    expect(result).toEqual({ status: "invalid", message: "Enter a request." });
    expect(runIdentityAgent).not.toHaveBeenCalled();
  });

  it("trims both fields before validating and before calling the agent", async () => {
    const runIdentityAgent = vi.fn().mockResolvedValue({ requestId: "r1", toolWasCalled: true, reply: "Done." });

    await submitRequest({ actor: "  alice@contoso.com  ", requestText: "  which groups is bob in  " }, { runIdentityAgent });

    expect(runIdentityAgent).toHaveBeenCalledWith({ actor: "alice@contoso.com", requestText: "which groups is bob in" });
  });

  it("returns the agent's result on success", async () => {
    const runIdentityAgent = vi.fn().mockResolvedValue({ requestId: "r1", toolWasCalled: true, reply: "Bob is in Marketing." });
    const deps: SubmitRequestDeps = { runIdentityAgent };

    const result = await submitRequest({ actor: "alice@contoso.com", requestText: "which groups is bob in" }, deps);

    expect(result).toEqual({ status: "ok", requestId: "r1", toolWasCalled: true, reply: "Bob is in Marketing." });
  });

  it("reports a thrown error as a result rather than letting it propagate", async () => {
    const runIdentityAgent = vi.fn().mockRejectedValue(new Error("Not logged in"));

    const result = await submitRequest({ actor: "alice@contoso.com", requestText: "hi" }, { runIdentityAgent });

    expect(result).toEqual({ status: "error", message: "Not logged in" });
  });
});

describe("renderRequestForm()", () => {
  it("renders an empty form with no result section", () => {
    const html = renderRequestForm();
    expect(html).toContain("<form");
    expect(html).not.toContain('class="error"');
    expect(html).not.toContain('class="ok"');
  });

  it("re-populates the identity and request fields, escaped", () => {
    const html = renderRequestForm(undefined, { actor: "alice@contoso.com", requestText: '<script>alert(1)</script>' });

    expect(html).toContain("alice@contoso.com");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("renders an invalid result as an error", () => {
    const html = renderRequestForm({ status: "invalid", message: "Enter a request." });
    expect(html).toContain('class="error"');
    expect(html).toContain("Enter a request.");
  });

  it("renders an error result with the message escaped", () => {
    const html = renderRequestForm({ status: "error", message: "<b>boom</b>" });
    expect(html).toContain('class="error"');
    expect(html).toContain("&lt;b&gt;boom&lt;/b&gt;");
  });

  it("renders a successful result with the reply, requestId and whether a tool was called", () => {
    const html = renderRequestForm({ status: "ok", requestId: "req-123", toolWasCalled: true, reply: "Bob is in Marketing." });

    expect(html).toContain('class="ok"');
    expect(html).toContain("req-123");
    expect(html).toContain("Bob is in Marketing.");
  });

  it("escapes the reply text", () => {
    const html = renderRequestForm({ status: "ok", requestId: "req-1", toolWasCalled: false, reply: "<img src=x onerror=alert(1)>" });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
