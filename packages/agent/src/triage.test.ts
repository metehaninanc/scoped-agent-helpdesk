import { describe, expect, it, vi } from "vitest";

import { DEFAULT_TRIAGE_MODEL, TRIAGE_SCOPES, TRIAGE_SYSTEM_PROMPT, TRIAGE_WIRE_OUTCOME, TriageError, createTriageClassifier } from "./triage.js";

// ---------------------------------------------------------------------------

function messagesResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: "msg_01",
      type: "message",
      role: "assistant",
      model: DEFAULT_TRIAGE_MODEL,
      content: [{ type: "text", text: '{"outcome": "route_to_agent", "agent": "identity", "notItTeam": null, "partiallyOutOfScope": false}' }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 40, output_tokens: 6 },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function classifier(response: () => Response | Promise<Response> = () => messagesResponse()) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response());
  const gen = createTriageClassifier({ apiKey: "test-key", fetch });
  const requestBody = (): Record<string, unknown> => {
    const [, init] = fetch.mock.calls[0]!;
    return JSON.parse(init?.body as string) as Record<string, unknown>;
  };
  return { gen, fetch, requestBody };
}

/** Tests below speak TriageResult's language (scope, category); the model speaks outcome / agent, with
 * "routable" written "route_to_agent". This is the one place a test translates between them. */
function reply(overrides: Record<string, unknown>): Response {
  const { scope = "routable", category = "identity", ...rest } = overrides;
  const outcome = scope === "routable" ? "route_to_agent" : scope;
  return messagesResponse({
    content: [{ type: "text", text: JSON.stringify({ outcome, agent: category, notItTeam: null, partiallyOutOfScope: false, ...rest }) }],
  });
}

// ---------------------------------------------------------------------------

describe("TRIAGE_SYSTEM_PROMPT", () => {
  it("names all five outcomes, all four agents, notItTeam, partiallyOutOfScope, and demands JSON-only output", () => {
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"not_it"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"needs_human"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"network"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"security"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"route_to_agent"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"identity"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"mdm"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"knowledge"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"endpoint"');
    expect(TRIAGE_SYSTEM_PROMPT).not.toContain('"unsupported"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain("notItTeam");
    expect(TRIAGE_SYSTEM_PROMPT).toContain("partiallyOutOfScope");
    expect(TRIAGE_SYSTEM_PROMPT).toContain("No explanation, no markdown");
  });

  it("routes password reset requests to routable/endpoint, not not_it or needs_human, so the refusal and its SSPR/manager guidance are actually reachable", () => {
    expect(TRIAGE_SYSTEM_PROMPT).toContain("classify any");
    expect(TRIAGE_SYSTEM_PROMPT).toContain("password reset request here");
  });

  it("scopes knowledge to any workplace IT how-to question, not just identity or device management", () => {
    const prompt = TRIAGE_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(prompt).toContain("anything IT supports at work");
    expect(prompt).toContain("even if you are not sure the documentation actually covers that specific product");
  });

  it("narrows not_it to genuinely non-IT requests, naming facilities/HR/personal/family/delivery explicitly", () => {
    const prompt = TRIAGE_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(prompt).toContain("not a corporate IT matter at all");
    expect(prompt).toContain("facilities");
    expect(prompt).toContain("HR");
    expect(prompt).toContain("family member's own issue");
    expect(prompt).toContain("delivery or parcel question");
  });

  it("offers every scope in TRIAGE_SCOPES, under its wire name, in its required JSON shape, so the prompt and the closed set cannot drift apart", () => {
    const shape = TRIAGE_SYSTEM_PROMPT.split("\n").find((line) => line.startsWith('{"outcome":'));
    expect(shape).toBeDefined();
    for (const scope of TRIAGE_SCOPES) expect(shape).toContain(`"${TRIAGE_WIRE_OUTCOME[scope]}"`);
  });

  it("shows the model outcome / agent / route_to_agent and never the code's own scope / category / routable", () => {
    const prompt = TRIAGE_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(prompt).toContain('"outcome"');
    expect(prompt).toContain('"agent"');
    expect(prompt).toContain('"route_to_agent"');
    expect(prompt).not.toContain('"scope"');
    expect(prompt).not.toContain('"category"');
    expect(prompt).not.toContain('"routable"');
    expect(TRIAGE_WIRE_OUTCOME.routable).toBe("route_to_agent");
  });

  it("makes a sign-in block caused by device state mdm, and says hardware wording does not move a ticket out of mdm", () => {
    const prompt = TRIAGE_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(prompt).toContain("A sign-in or access block that is caused by device state is also this, not identity, because the device record is the first thing to check");
    expect(prompt).toContain("Hardware wording does not move a ticket out of this");
    expect(prompt).toContain("a new, replacement or refurbished device, a serial number, or a firmware or recovery screen");
    // identity must not claim the same blocks.
    expect(prompt).toContain('unless the block is caused by the state of one device (see "mdm" below)');
  });

  it("sends application faults to knowledge or needs_human by whether a document could answer them, never to endpoint", () => {
    const prompt = TRIAGE_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(prompt).toContain("is a documentation question when a document could answer it");
    expect(prompt).toContain('when no document could, it is "needs_human". Either way it is never "endpoint"');
    expect(prompt).toContain("An application fault that no document could answer, and that needs a person to investigate, is also this");
    expect(prompt).toContain("It is never about software running on a device");
    expect(prompt).toContain("even on a managed laptop");
  });

  it("scopes needs_human to physical hands, procurement, logistics, or anything outside the tenant entirely", () => {
    const prompt = TRIAGE_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(prompt).toContain("needs physical hands, procurement, shipping or logistics, or that lies outside this tenant entirely");
    expect(prompt).toContain("former employer");
  });

  it("scopes network to connectivity and infrastructure, and sends how-to and entitlement questions elsewhere", () => {
    const prompt = TRIAGE_SYSTEM_PROMPT.replace(/\s+/g, " ");
    for (const word of ["VPN", "DNS", "Wi-Fi", "LAN", "certificates", "routing"]) expect(prompt).toContain(word);
    expect(prompt).toContain("A person with access to network equipment has to look at it");
    expect(prompt).toContain('a documentation question, "knowledge"');
    expect(prompt).toContain('access, "identity"');
  });

  it("scopes security to a possible incident, and puts it ahead of not_it for a phishing report that mentions a delivery", () => {
    const prompt = TRIAGE_SYSTEM_PROMPT.replace(/\s+/g, " ");
    for (const phrase of ["suspected phishing", "credentials entered on a page that may have been fake", "did not ask for", "do not recognise", "ransomware"]) {
      expect(prompt).toContain(phrase);
    }
    expect(prompt).toContain("Pick this over every other outcome and agent");
    expect(prompt).toContain('A suspected phishing or scam message is never "not_it"');
  });

  it("widens identity to the whole directory object, and says the domain is what matters, not what an agent can do", () => {
    const prompt = TRIAGE_SYSTEM_PROMPT.replace(/\s+/g, " ");
    for (const phrase of ["licence assignment, reassignment or removal", "creating, enabling or disabling an account", "MFA method", "conditional access", "locked out"]) {
      expect(prompt).toContain(phrase);
    }
    expect(prompt).toContain("What matters is the domain, not whether an agent here can perform the change");
    // A lockout is identity; a password reset itself stays endpoint.
    expect(prompt).toContain('A password reset itself is "endpoint" below');
  });
});

describe("createTriageClassifier()", () => {
  it("makes one Messages API call with the system prompt and exactly the request text as the only user turn", async () => {
    const { gen, fetch, requestBody } = classifier();

    await gen.classify("which groups is bob in");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    const body = requestBody();
    expect(body.model).toBe(DEFAULT_TRIAGE_MODEL);
    expect(body.system).toBe(TRIAGE_SYSTEM_PROMPT);
    expect(body.messages).toEqual([{ role: "user", content: "which groups is bob in" }]);
  });

  it("gives the model nothing but the request text: no tools, no conversation history, no room for extra context", async () => {
    const { gen, requestBody } = classifier();
    await gen.classify("which groups is bob in");

    const body = requestBody();
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    // No output_config/effort: claude-haiku-4-5-20251001 rejects it outright (confirmed live).
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "system", "thinking"]);
  });

  it("explicitly disables thinking, so a model that defaults it on cannot spend the output budget on a reasoning block instead of the answer", async () => {
    const { gen, requestBody } = classifier();
    await gen.classify("which groups is bob in");

    const body = requestBody();
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("returns the parsed scope, category, notItTeam, partiallyOutOfScope, the model and token usage", async () => {
    const { gen } = classifier();

    expect(await gen.classify("which groups is bob in")).toEqual({
      scope: "routable",
      category: "identity",
      notItTeam: null,
      partiallyOutOfScope: false,
      model: DEFAULT_TRIAGE_MODEL,
      usage: { inputTokens: 40, outputTokens: 6 },
    });
  });

  it("parses each category in the closed set, for scope routable", async () => {
    for (const category of ["identity", "mdm", "knowledge", "endpoint"] as const) {
      const { gen } = classifier(() => reply({ category }));
      expect((await gen.classify("x")).category).toBe(category);
    }
  });

  it("parses scope not_it with a null category", async () => {
    const { gen } = classifier(() => reply({ scope: "not_it", category: null }));
    expect(await gen.classify("x")).toMatchObject({ scope: "not_it", category: null });
  });

  it("parses scope network with a null category", async () => {
    const { gen } = classifier(() => reply({ scope: "network", category: null }));
    expect(await gen.classify("x")).toMatchObject({ scope: "network", category: null, notItTeam: null });
  });

  it("parses scope security with a null category", async () => {
    const { gen } = classifier(() => reply({ scope: "security", category: null }));
    expect(await gen.classify("x")).toMatchObject({ scope: "security", category: null, notItTeam: null });
  });

  it("rejects network and security with a category, or with a team, like every other non-routable scope", async () => {
    for (const scope of ["network", "security"]) {
      const withCategory = classifier(() => reply({ scope, category: "identity" })).gen;
      await expect(withCategory.classify("x")).rejects.toMatchObject({ code: "invalid_output" });
      const withTeam = classifier(() => reply({ scope, category: null, notItTeam: "hr" })).gen;
      await expect(withTeam.classify("x")).rejects.toMatchObject({ code: "invalid_output" });
    }
  });

  it("parses scope needs_human with a null category", async () => {
    const { gen } = classifier(() => reply({ scope: "needs_human", category: null }));
    expect(await gen.classify("x")).toMatchObject({ scope: "needs_human", category: null });
  });

  it("parses notItTeam facilities and hr", async () => {
    for (const notItTeam of ["facilities", "hr"] as const) {
      const { gen } = classifier(() => reply({ scope: "not_it", category: null, notItTeam }));
      expect((await gen.classify("x")).notItTeam).toBe(notItTeam);
    }
  });

  it("rejects a routable scope with a null category", async () => {
    const { gen } = classifier(() => reply({ scope: "routable", category: null }));

    const failure = await gen.classify("x").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TriageError);
    expect((failure as TriageError).code).toBe("invalid_output");
  });

  it("rejects a not_it scope with a non-null category", async () => {
    const { gen } = classifier(() => reply({ scope: "not_it", category: "identity" }));

    const failure = await gen.classify("x").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TriageError);
    expect((failure as TriageError).code).toBe("invalid_output");
  });

  it("rejects a non-null notItTeam when scope is not not_it", async () => {
    const { gen } = classifier(() => reply({ scope: "routable", category: "identity", notItTeam: "hr" }));

    const failure = await gen.classify("x").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TriageError);
    expect((failure as TriageError).code).toBe("invalid_output");
  });

  it("parses partiallyOutOfScope: true — the mixed-domain case", async () => {
    const { gen } = classifier(() => reply({ scope: "not_it", category: null, partiallyOutOfScope: true }));
    expect(await gen.classify("my laptop is slow and also am I in finance")).toMatchObject({
      scope: "not_it",
      partiallyOutOfScope: true,
    });
  });

  it("rejects a response missing a required field", async () => {
    const { gen } = classifier(() => messagesResponse({ content: [{ type: "text", text: '{"outcome": "route_to_agent", "agent": "identity"}' }] }));

    const failure = await gen.classify("x").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TriageError);
    expect((failure as TriageError).code).toBe("invalid_output");
  });

  it("honours a configured model id", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => messagesResponse({ model: "claude-sonnet-5" }));
    const gen = createTriageClassifier({ apiKey: "test-key", fetch, model: "claude-sonnet-5" });

    const result = await gen.classify("x");

    expect(JSON.parse(fetch.mock.calls[0]![1]?.body as string).model).toBe("claude-sonnet-5");
    expect(result.model).toBe("claude-sonnet-5");
  });

  it("tolerates surrounding whitespace around the JSON", async () => {
    const { gen } = classifier(() =>
      messagesResponse({ content: [{ type: "text", text: '\n  {"outcome": "route_to_agent", "agent": "mdm", "notItTeam": null, "partiallyOutOfScope": false}  \n' }] }),
    );
    expect((await gen.classify("x")).category).toBe("mdm");
  });

  it("tolerates a ```json fence around the JSON, seen live from claude-haiku-4-5-20251001 despite the prompt asking for none", async () => {
    const { gen } = classifier(() =>
      messagesResponse({
        content: [{ type: "text", text: '```json\n{"outcome": "route_to_agent", "agent": "identity", "notItTeam": null, "partiallyOutOfScope": false}\n```' }],
      }),
    );
    expect((await gen.classify("x")).category).toBe("identity");
  });

  it("still rejects a fenced but out-of-set category — stripping the fence is a formatting tolerance, not a validation relaxation", async () => {
    const { gen } = classifier(() =>
      messagesResponse({
        content: [{ type: "text", text: '```json\n{"outcome": "route_to_agent", "agent": "admin", "notItTeam": null, "partiallyOutOfScope": false}\n```' }],
      }),
    );

    const failure = await gen.classify("x").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TriageError);
    expect((failure as TriageError).code).toBe("invalid_output");
  });

  it("rejects a category outside the closed set rather than passing it along", async () => {
    const { gen } = classifier(() => reply({ category: "admin" }));

    const failure = await gen.classify("x").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TriageError);
    expect((failure as TriageError).code).toBe("invalid_output");
  });

  it("rejects a category name in the outcome field, and the old field names, rather than quietly translating either", async () => {
    for (const text of [
      '{"outcome": "identity", "agent": "identity", "notItTeam": null, "partiallyOutOfScope": false}',
      '{"outcome": "identity", "agent": null, "notItTeam": null, "partiallyOutOfScope": false}',
      '{"scope": "routable", "category": "identity", "notItTeam": null, "partiallyOutOfScope": false}',
    ]) {
      const { gen } = classifier(() => messagesResponse({ content: [{ type: "text", text }] }));
      await expect(gen.classify("x")).rejects.toMatchObject({ code: "invalid_output" });
    }
  });

  it("rejects a scope outside the closed set rather than passing it along", async () => {
    const { gen } = classifier(() => reply({ scope: "not_a_real_scope", category: null }));

    const failure = await gen.classify("x").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TriageError);
    expect((failure as TriageError).code).toBe("invalid_output");
  });

  it("rejects output that is not valid JSON", async () => {
    const { gen } = classifier(() => messagesResponse({ content: [{ type: "text", text: "sure, this is an identity request" }] }));

    const failure = await gen.classify("x").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TriageError);
    expect((failure as TriageError).code).toBe("invalid_output");
  });

  it("fails with the stop reason when the model did not finish normally", async () => {
    const { gen } = classifier(() => messagesResponse({ stop_reason: "max_tokens" }));

    const failure = await gen.classify("x").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TriageError);
    expect((failure as TriageError).code).toBe("stop_reason:max_tokens");
  });

  it("fails when the model returned no text", async () => {
    const { gen } = classifier(() => messagesResponse({ content: [] }));
    await expect(gen.classify("x")).rejects.toMatchObject({ code: "empty_response" });
  });

  it("wraps API errors with the status, never the key", async () => {
    const { gen } = classifier(
      () =>
        new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );

    const failure = await gen.classify("x").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TriageError);
    expect((failure as TriageError).code).toBe("api_error:401");
    expect((failure as TriageError).message).not.toContain("test-key");
  });

  it("refuses to construct without an API key", () => {
    expect(() => createTriageClassifier({ apiKey: "" })).toThrow(/ANTHROPIC_API_KEY/);
  });
});
