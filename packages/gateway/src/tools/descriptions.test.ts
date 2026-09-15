import { describe, expect, it } from "vitest";

import { TOOL_NAMES, toolDefinitions, toolDescription, toolInputSchema } from "./descriptions.js";

describe("tool definitions", () => {
  it("exposes exactly the three Sprint 1 tools, reads before the write", () => {
    expect(TOOL_NAMES).toEqual(["list_user_groups", "list_managed_groups", "add_user_to_group"]);
    expect(toolDefinitions().map((t) => t.name)).toEqual(TOOL_NAMES);
  });

  it("advertises a minimal, closed input schema with a description per parameter", () => {
    expect(toolInputSchema("add_user_to_group")).toEqual({
      type: "object",
      properties: {
        userPrincipalName: { type: "string", description: expect.stringContaining("alice@contoso.com") },
        groupId: { type: "string", description: expect.stringContaining("list_managed_groups") },
      },
      required: ["userPrincipalName", "groupId"],
      additionalProperties: false,
    });
    expect(toolInputSchema("list_user_groups").required).toEqual(["userPrincipalName"]);
    expect(toolInputSchema("list_managed_groups")).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
    // No regex leaks into the prompt: the gateway validates, the model just needs the shape.
    expect(JSON.stringify(toolInputSchema("list_user_groups"))).not.toContain("pattern");
  });

  it("puts no protected resource into the prompt: descriptions are static text with no ids in them", () => {
    // The allowlist is looked up through list_managed_groups, and that lookup is audited.
    // A description that embedded it would make protected resources part of the model's
    // context and would not scale past a handful of groups.
    const guid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const tool of toolDefinitions()) {
      expect(tool.description, tool.name).not.toMatch(guid);
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toMatch(guid);
    }
    // And there is no way to feed it one: descriptions take no configuration.
    expect(toolDescription.length).toBe(1);
  });
});

// These pin the behavioural phrases. Changing the wording is allowed; changing it without
// noticing is not. Update the test in the same commit as the description.
describe("add_user_to_group description", () => {
  const text = toolDescription("add_user_to_group");

  it("presents pending_approval as the normal, successful result", () => {
    expect(text).toContain("pending_approval");
    expect(text).toContain("This is success.");
    expect(text).toMatch(/normal, successful result/);
  });

  it("tells the agent to report pending plainly and stop, not retry or route around it", () => {
    expect(text).toContain("Tell the requester the change is pending approval");
    expect(text).toContain("Do not call this tool again for the same user and group");
    expect(text).toContain("do not look for another tool or method to make the change");
    expect(text).toContain("do not say the change has been made");
  });

  it("says plainly that the tool records a request and does not make the change", () => {
    expect(text).toContain("it does not perform the change itself");
  });

  it("explains denied and forbids parameter-shuffling to get around it", () => {
    expect(text).toContain('{ status: "denied", rules, message }');
    expect(text).toContain("Do not retry with different parameters");
  });

  it("sends the agent to list_managed_groups to resolve a group name", () => {
    expect(text).toContain("call list_managed_groups");
    expect(text).toContain("Do not guess a group id");
  });
});

describe("list_managed_groups description", () => {
  const text = toolDescription("list_managed_groups");

  it("says what it returns, that it takes nothing, and that it changes nothing", () => {
    expect(text).toContain("Takes no parameters");
    expect(text).toContain("changes nothing");
    expect(text).toContain("{ id, displayName }");
  });

  it("frames it as the way to resolve a name for add_user_to_group", () => {
    expect(text).toContain("add_user_to_group");
    expect(text).toContain("the only groups add_user_to_group can target");
  });
});

describe("list_user_groups description", () => {
  const text = toolDescription("list_user_groups");

  it("states that it runs without approval and changes nothing", () => {
    expect(text).toContain("Runs without approval and changes nothing.");
  });

  it("tells the agent not to route around a denial", () => {
    expect(text).toContain('{ status: "denied", rules, message }');
    expect(text).toContain("Do not look for another way to get the same information.");
  });
});
