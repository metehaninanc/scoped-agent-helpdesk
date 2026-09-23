import { describe, expect, it, vi } from "vitest";

import { DEFAULT_TRIAGE_MODEL, TRIAGE_SYSTEM_PROMPT, TriageError, createTriageClassifier } from "./triage.js";

// ---------------------------------------------------------------------------

function messagesResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: "msg_01",
      type: "message",
      role: "assistant",
      model: DEFAULT_TRIAGE_MODEL,
      content: [{ type: "text", text: '{"category": "identity", "partiallyOutOfScope": false}' }],
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

// ---------------------------------------------------------------------------

describe("TRIAGE_SYSTEM_PROMPT", () => {
  it("names all five categories, the partiallyOutOfScope field, and demands JSON-only output", () => {
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"identity"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"mdm"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"knowledge"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"endpoint"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"unsupported"');
    expect(TRIAGE_SYSTEM_PROMPT).toContain("partiallyOutOfScope");
    expect(TRIAGE_SYSTEM_PROMPT).toContain("No explanation, no markdown");
  });

  it("routes password reset requests to endpoint, not unsupported, so the refusal and its SSPR/manager guidance are actually reachable", () => {
    expect(TRIAGE_SYSTEM_PROMPT).toContain("classify any");
    expect(TRIAGE_SYSTEM_PROMPT).toContain("password reset request here");
  });

  it("scopes knowledge to any workplace IT how-to question, not just identity or device management", () => {
    const prompt = TRIAGE_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(prompt).toContain("anything IT supports at work");
    expect(prompt).toContain("even if you are not sure the documentation actually covers that specific product");
  });

  it("narrows unsupported to genuinely non-IT requests, naming facilities/HR/personal/family/delivery explicitly", () => {
    const prompt = TRIAGE_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(prompt).toContain("a request that is not an IT matter at all");
    expect(prompt).toContain("facilities");
    expect(prompt).toContain("HR");
    expect(prompt).toContain("family member's own issue");
    expect(prompt).toContain("delivery or parcel question");
    expect(prompt).toContain('Do not put a genuine IT question here just because it is not');
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
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "system"]);
  });

  it("returns the parsed category, partiallyOutOfScope, the model and token usage", async () => {
    const { gen } = classifier();

    expect(await gen.classify("which groups is bob in")).toEqual({
      category: "identity",
      partiallyOutOfScope: false,
      model: DEFAULT_TRIAGE_MODEL,
      usage: { inputTokens: 40, outputTokens: 6 },
    });
  });

  it("parses each category in the closed set", async () => {
    for (const category of ["identity", "mdm", "knowledge", "endpoint", "unsupported"] as const) {
      const { gen } = classifier(() =>
        messagesResponse({ content: [{ type: "text", text: JSON.stringify({ category, partiallyOutOfScope: false }) }] }),
      );
      expect((await gen.classify("x")).category).toBe(category);
    }
  });

  it("parses partiallyOutOfScope: true — the mixed-domain case", async () => {
    const { gen } = classifier(() =>
      messagesResponse({ content: [{ type: "text", text: '{"category": "unsupported", "partiallyOutOfScope": true}' }] }),
    );
    expect(await gen.classify("my laptop is slow and also am I in finance")).toMatchObject({
      category: "unsupported",
      partiallyOutOfScope: true,
    });
  });

  it("rejects a response missing partiallyOutOfScope, same as a missing category", async () => {
    const { gen } = classifier(() => messagesResponse({ content: [{ type: "text", text: '{"category": "identity"}' }] }));

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
      messagesResponse({ content: [{ type: "text", text: '\n  {"category": "mdm", "partiallyOutOfScope": false}  \n' }] }),
    );
    expect((await gen.classify("x")).category).toBe("mdm");
  });

  it("tolerates a ```json fence around the JSON, seen live from claude-haiku-4-5-20251001 despite the prompt asking for none", async () => {
    const { gen } = classifier(() =>
      messagesResponse({ content: [{ type: "text", text: '```json\n{"category": "identity", "partiallyOutOfScope": false}\n```' }] }),
    );
    expect((await gen.classify("x")).category).toBe("identity");
  });

  it("still rejects a fenced but out-of-set category — stripping the fence is a formatting tolerance, not a validation relaxation", async () => {
    const { gen } = classifier(() =>
      messagesResponse({ content: [{ type: "text", text: '```json\n{"category": "admin", "partiallyOutOfScope": false}\n```' }] }),
    );

    const failure = await gen.classify("x").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TriageError);
    expect((failure as TriageError).code).toBe("invalid_output");
  });

  it("rejects a category outside the closed set rather than passing it along", async () => {
    const { gen } = classifier(() =>
      messagesResponse({ content: [{ type: "text", text: '{"category": "admin", "partiallyOutOfScope": false}' }] }),
    );

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
