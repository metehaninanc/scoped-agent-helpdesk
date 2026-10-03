import { describe, expect, it, vi } from "vitest";

import { renderRequestForm, submitRequest, type SubmitRequestDeps } from "./request-page.js";

describe("submitRequest()", () => {
  it("rejects an empty identity without routing the request", async () => {
    const routeRequest = vi.fn();
    const result = await submitRequest({ actor: "  ", requestText: "which groups is bob in" }, { routeRequest });

    expect(result).toEqual({ status: "invalid", message: "Your identity is required." });
    expect(routeRequest).not.toHaveBeenCalled();
  });

  it("rejects an empty request without routing it", async () => {
    const routeRequest = vi.fn();
    const result = await submitRequest({ actor: "alice@contoso.com", requestText: "   " }, { routeRequest });

    expect(result).toEqual({ status: "invalid", message: "Enter a request." });
    expect(routeRequest).not.toHaveBeenCalled();
  });

  it("trims both fields before validating and before routing", async () => {
    const routeRequest = vi.fn().mockResolvedValue({ status: "routed", category: "identity", agent: "identity-agent", requestId: "r1", toolWasCalled: true, reply: "Done." });

    await submitRequest({ actor: "  alice@contoso.com  ", requestText: "  which groups is bob in  " }, { routeRequest });

    expect(routeRequest).toHaveBeenCalledWith({ actor: "alice@contoso.com", requestText: "which groups is bob in" });
  });

  it("returns a routed result as-is", async () => {
    const routeRequest = vi
      .fn()
      .mockResolvedValue({ status: "routed", category: "identity", agent: "identity-agent", requestId: "r1", toolWasCalled: true, reply: "Bob is in Marketing." });
    const deps: SubmitRequestDeps = { routeRequest };

    const result = await submitRequest({ actor: "alice@contoso.com", requestText: "which groups is bob in" }, deps);

    expect(result).toEqual({ status: "routed", category: "identity", agent: "identity-agent", requestId: "r1", toolWasCalled: true, reply: "Bob is in Marketing." });
  });

  it("returns a not_it result as-is", async () => {
    const routeRequest = vi.fn().mockResolvedValue({ status: "not_it", requestId: "r1", message: "This system doesn't have a way to help with that — it isn't an IT matter this team handles." });

    const result = await submitRequest({ actor: "alice@contoso.com", requestText: "reset my printer" }, { routeRequest });

    expect(result).toEqual({ status: "not_it", requestId: "r1", message: "This system doesn't have a way to help with that — it isn't an IT matter this team handles." });
  });

  it("returns a needs_human result as-is", async () => {
    const routeRequest = vi
      .fn()
      .mockResolvedValue({ status: "needs_human", requestId: "r1", handoffId: "handoff-1", message: "This needs a person to help with it — it has been handed off and is waiting for an operator." });

    const result = await submitRequest({ actor: "alice@contoso.com", requestText: "my laptop screen is cracked" }, { routeRequest });

    expect(result).toEqual({ status: "needs_human", requestId: "r1", handoffId: "handoff-1", message: "This needs a person to help with it — it has been handed off and is waiting for an operator." });
  });

  it("returns a triage_failed result as-is", async () => {
    const routeRequest = vi.fn().mockResolvedValue({ status: "triage_failed", requestId: "r1", message: "Your request could not be classified right now. Please try again." });

    const result = await submitRequest({ actor: "alice@contoso.com", requestText: "hi" }, { routeRequest });

    expect(result).toEqual({ status: "triage_failed", requestId: "r1", message: "Your request could not be classified right now. Please try again." });
  });

  it("reports a thrown error as a result rather than letting it propagate", async () => {
    const routeRequest = vi.fn().mockRejectedValue(new Error("Not logged in"));

    const result = await submitRequest({ actor: "alice@contoso.com", requestText: "hi" }, { routeRequest });

    expect(result).toEqual({ status: "error", message: "Not logged in" });
  });
});

describe("renderRequestForm()", () => {
  it("renders an empty form with no result section", () => {
    const html = renderRequestForm();
    expect(html).toContain("<form");
    expect(html).not.toContain('class="error"');
    expect(html).not.toContain('class="ok"');
    expect(html).not.toContain('class="info"');
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

  it("renders a routed result with the reply, requestId, invoked agent and whether a tool was called", () => {
    const html = renderRequestForm({ status: "routed", category: "identity", agent: "identity-agent", requestId: "req-123", toolWasCalled: true, reply: "Bob is in Marketing." });

    expect(html).toContain('class="ok"');
    expect(html).toContain("req-123");
    expect(html).toContain("identity-agent");
    expect(html).toContain("Bob is in Marketing.");
  });

  it("escapes the reply text", () => {
    const html = renderRequestForm({ status: "routed", category: "mdm", agent: "mdm-agent", requestId: "req-1", toolWasCalled: false, reply: "<img src=x onerror=alert(1)>" });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("renders a not_it result as informational, not an error, with the requestId", () => {
    const html = renderRequestForm({ status: "not_it", requestId: "req-1", message: "This system doesn't have a way to help with that — it isn't an IT matter this team handles." });

    expect(html).toContain('class="info"');
    expect(html).not.toContain('class="error"');
    expect(html).toContain("req-1");
    expect(html).toContain("an IT matter");
  });

  it("renders a needs_human result as informational, not an error, with the requestId and the handoffId", () => {
    const html = renderRequestForm({
      status: "needs_human",
      requestId: "req-1",
      handoffId: "handoff-1",
      message: "This needs a person to help with it — it has been handed off and is waiting for an operator.",
    });

    expect(html).toContain('class="info"');
    expect(html).not.toContain('class="error"');
    expect(html).toContain("req-1");
    expect(html).toContain("handoff-1");
    expect(html).toContain("needs a person");
  });

  it("renders network and security results like any other handoff: informational, with both ids", () => {
    for (const status of ["network", "security"] as const) {
      const html = renderRequestForm(
        status === "security"
          ? { status, requestId: "req-1", handoffId: "handoff-1", message: "A possible security matter.", urgent: true }
          : { status, requestId: "req-1", handoffId: "handoff-1", message: "A network matter." },
      );
      expect(html).toContain('class="info"');
      expect(html).not.toContain('class="error"');
      expect(html).toContain("req-1");
      expect(html).toContain("handoff-1");
    }
  });

  it("renders a triage_failed result as an error, with the requestId", () => {
    const html = renderRequestForm({ status: "triage_failed", requestId: "req-1", message: "Your request could not be classified right now. Please try again." });

    expect(html).toContain('class="error"');
    expect(html).toContain("req-1");
    expect(html).toContain("Your request could not be classified right now. Please try again.");
  });

  it("renders a routed result for the knowledge category", () => {
    const html = renderRequestForm({
      status: "routed",
      category: "knowledge",
      agent: "knowledge-agent",
      requestId: "req-1",
      toolWasCalled: true,
      reply: "Security groups and Microsoft 365 groups.",
    });

    expect(html).toContain('class="ok"');
    expect(html).toContain("knowledge-agent");
  });

  it("renders a routed result for the endpoint category", () => {
    const html = renderRequestForm({
      status: "routed",
      category: "endpoint",
      agent: "endpoint-agent",
      requestId: "req-1",
      toolWasCalled: true,
      reply: "This system cannot reset passwords; try Self-Service Password Reset first.",
    });

    expect(html).toContain('class="ok"');
    expect(html).toContain("endpoint-agent");
  });

  it("renders the partial-scope note on a routed result when present", () => {
    const html = renderRequestForm({
      status: "routed",
      category: "identity",
      agent: "identity-agent",
      requestId: "req-1",
      toolWasCalled: true,
      reply: "Bob is in Marketing.",
      note: "Part of this request was not addressed above — please send it as a separate request.",
    });

    expect(html).toContain('class="note"');
    expect(html).toContain("Part of this request was not addressed above");
  });

  it("renders the partial-scope note on a not_it result when present", () => {
    const html = renderRequestForm({
      status: "not_it",
      requestId: "req-1",
      message: "This system doesn't have a way to help with that — it isn't an IT matter this team handles.",
      note: "Part of this request was not addressed above — please send it as a separate request.",
    });

    expect(html).toContain('class="note"');
  });

  it("renders the partial-scope note on a needs_human result when present", () => {
    const html = renderRequestForm({
      status: "needs_human",
      requestId: "req-1",
      handoffId: "handoff-1",
      message: "This needs a person to help with it — it has been handed off and is waiting for an operator.",
      note: "Part of this request was not addressed above — please send it as a separate request.",
    });

    expect(html).toContain('class="note"');
  });

  it("renders no note element when the note is absent", () => {
    const html = renderRequestForm({ status: "routed", category: "identity", agent: "identity-agent", requestId: "req-1", toolWasCalled: true, reply: "ok" });
    expect(html).not.toContain('class="note"');
  });
});
