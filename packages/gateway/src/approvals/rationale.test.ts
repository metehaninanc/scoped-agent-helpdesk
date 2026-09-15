import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RATIONALE_MODEL,
  RATIONALE_SYSTEM_PROMPT,
  RationaleError,
  createRationaleGenerator,
  renderFacts,
  type RationaleFacts,
} from "./rationale.js";

// ---------------------------------------------------------------------------

const facts: RationaleFacts = {
  tool: "add_user_to_group",
  params: { userPrincipalName: "alice@contoso.com", groupId: "88981a1a-1f6b-438c-9475-26b7c619dce0" },
  rules: ["approval.add_user_to_group"],
  targetUser: "alice@contoso.com",
  targetGroup: { id: "88981a1a-1f6b-438c-9475-26b7c619dce0", displayName: "Finance" },
  requestingUser: "helpdesk.operator@contoso.com",
};

const RATIONALE_TEXT =
  "What is being requested\nAdd alice@contoso.com to Finance.\n\nWhat changes if approved\nThe user gains whatever Finance grants.\n\nWhat is worth checking before approving\nWhether the user's role justifies Finance access.";

function messagesResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: "msg_01",
      type: "message",
      role: "assistant",
      model: DEFAULT_RATIONALE_MODEL,
      content: [{ type: "text", text: RATIONALE_TEXT }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 200, output_tokens: 60 },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function generator(response: () => Response | Promise<Response> = () => messagesResponse()) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response());
  const gen = createRationaleGenerator({ apiKey: "test-key", fetch });
  const requestBody = (): Record<string, unknown> => {
    const [, init] = fetch.mock.calls[0]!;
    return JSON.parse(init?.body as string) as Record<string, unknown>;
  };
  return { gen, fetch, requestBody };
}

// ---------------------------------------------------------------------------

describe("renderFacts()", () => {
  it("renders every fact, and only the facts, in a fixed order", () => {
    expect(renderFacts(facts)).toBe(
      [
        "Tool: add_user_to_group",
        "Requesting user: helpdesk.operator@contoso.com",
        "Target user: alice@contoso.com",
        "Target group: Finance (88981a1a-1f6b-438c-9475-26b7c619dce0)",
        "Rules that require approval: approval.add_user_to_group",
        'Validated parameters: {"userPrincipalName":"alice@contoso.com","groupId":"88981a1a-1f6b-438c-9475-26b7c619dce0"}',
      ].join("\n"),
    );
  });

  it("says so when a fact is absent rather than omitting the line", () => {
    const rendered = renderFacts({ ...facts, targetUser: null, targetGroup: null });
    expect(rendered).toContain("Target user: (none)");
    expect(rendered).toContain("Target group: (none)");
  });

  it("renders a group without a known display name by id alone", () => {
    const rendered = renderFacts({ ...facts, targetGroup: { id: facts.targetGroup!.id, displayName: null } });
    expect(rendered).toContain(`Target group: ${facts.targetGroup!.id}`);
  });
});

describe("RATIONALE_SYSTEM_PROMPT", () => {
  it("asks for the three sections and forbids a recommendation", () => {
    expect(RATIONALE_SYSTEM_PROMPT).toContain("What is being requested");
    expect(RATIONALE_SYSTEM_PROMPT).toContain("What changes if approved");
    expect(RATIONALE_SYSTEM_PROMPT).toContain("What is worth checking before approving");
    expect(RATIONALE_SYSTEM_PROMPT).toContain("Do not recommend approving or rejecting");
    expect(RATIONALE_SYSTEM_PROMPT).toContain("Use only the facts given");
  });
});

describe("createRationaleGenerator()", () => {
  it("makes one Messages API call with the system prompt and exactly the rendered facts as the only user turn", async () => {
    const { gen, fetch, requestBody } = generator();

    await gen.generate(facts);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    const body = requestBody();
    expect(body.model).toBe(DEFAULT_RATIONALE_MODEL);
    expect(body.system).toBe(RATIONALE_SYSTEM_PROMPT);
    expect(body.messages).toEqual([{ role: "user", content: renderFacts(facts) }]);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("gives the model nothing but the facts: no conversation, no original wording", async () => {
    const { gen, requestBody } = generator();
    await gen.generate(facts);

    const wire = JSON.stringify(requestBody());
    // The only free text on the wire is the frozen system prompt and the rendered facts.
    const withoutKnownText = wire.replace(JSON.stringify(RATIONALE_SYSTEM_PROMPT), "").replace(JSON.stringify(renderFacts(facts)), "");
    expect(withoutKnownText).not.toMatch(/conversation|user said|please|hurry/i);
    // And the request has no room for extra context to sneak in.
    const body = requestBody();
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "output_config", "system"]);
  });

  it("returns the text verbatim with the model that produced it and token usage", async () => {
    const { gen } = generator();

    expect(await gen.generate(facts)).toEqual({
      text: RATIONALE_TEXT,
      model: DEFAULT_RATIONALE_MODEL,
      usage: { inputTokens: 200, outputTokens: 60 },
    });
  });

  it("honours a configured model id", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => messagesResponse({ model: "claude-sonnet-5" }));
    const gen = createRationaleGenerator({ apiKey: "test-key", fetch, model: "claude-sonnet-5" });

    const result = await gen.generate(facts);

    expect(JSON.parse(fetch.mock.calls[0]![1]?.body as string).model).toBe("claude-sonnet-5");
    expect(result.model).toBe("claude-sonnet-5");
  });

  it("joins multiple text blocks and ignores non-text blocks", async () => {
    const { gen } = generator(() =>
      messagesResponse({
        content: [
          { type: "thinking", thinking: "", signature: "x" },
          { type: "text", text: "Part one." },
          { type: "text", text: "Part two." },
        ],
      }),
    );
    expect((await gen.generate(facts)).text).toBe("Part one.\nPart two.");
  });

  it("fails with the stop reason when the model did not finish normally", async () => {
    const { gen } = generator(() => messagesResponse({ stop_reason: "refusal", stop_details: { type: "refusal", category: null } }));

    const failure = await gen.generate(facts).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(RationaleError);
    expect((failure as RationaleError).code).toBe("stop_reason:refusal");
  });

  it("fails when the model returned no text", async () => {
    const { gen } = generator(() => messagesResponse({ content: [] }));
    await expect(gen.generate(facts)).rejects.toMatchObject({ code: "empty_response" });
  });

  it("wraps API errors with the status, never the key", async () => {
    const { gen } = generator(
      () =>
        new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );

    const failure = await gen.generate(facts).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(RationaleError);
    expect((failure as RationaleError).code).toBe("api_error:401");
    expect((failure as RationaleError).message).not.toContain("test-key");
  });

  it("refuses to construct without an API key", () => {
    expect(() => createRationaleGenerator({ apiKey: "" })).toThrow(/ANTHROPIC_API_KEY/);
  });
});
