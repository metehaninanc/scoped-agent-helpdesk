import { describe, expect, it } from "vitest";

import { TOOL_NAMES, toolDefinitions, toolDescription, toolInputSchema } from "./descriptions.js";

describe("tool definitions", () => {
  it("exposes exactly the one Sprint 3.3 tool", () => {
    expect(TOOL_NAMES).toEqual(["search_documentation"]);
    expect(toolDefinitions().map((t) => t.name)).toEqual(TOOL_NAMES);
  });

  it("advertises a minimal, closed input schema with a description per parameter", () => {
    expect(toolInputSchema("search_documentation")).toEqual({
      type: "object",
      properties: { query: { type: "string", description: expect.stringContaining("documentation") } },
      required: ["query"],
      additionalProperties: false,
    });
    expect(JSON.stringify(toolInputSchema("search_documentation"))).not.toContain("pattern");
  });

  it("puts no protected resource into the prompt: descriptions are static text with no ids in them", () => {
    const guid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const tool of toolDefinitions()) {
      expect(tool.description, tool.name).not.toMatch(guid);
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toMatch(guid);
    }
  });
});

describe("search_documentation description", () => {
  const text = toolDescription("search_documentation");

  it("forbids answering from the model's own training when the corpus has nothing", () => {
    expect(text).toContain("you must not answer from your own training instead");
    expect(text).toContain("say plainly that you don't know");
  });

  it("tells the agent to cite the source and heading for every fact", () => {
    expect(text).toContain("Cite the sourceTitle and heading for every fact you state");
  });

  it("treats an empty passages array as a normal, successful result, not a failure", () => {
    expect(text).toContain("An empty passages array is a normal, successful result");
  });

  it("forbids retrying the same query more than once", () => {
    expect(text.replace(/\s+/g, " ")).toContain("Do not retry the same query worded differently more than once");
  });

  it("explains denied and error results", () => {
    expect(text).toContain('{ status: "denied", rules, message }');
    expect(text).toContain('{ status: "error", code, message }');
  });
});
