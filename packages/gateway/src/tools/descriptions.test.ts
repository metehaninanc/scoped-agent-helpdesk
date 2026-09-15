import { describe, expect, it } from "vitest";

import type { PolicyConfig } from "../policy/types.js";
import { TOOL_NAMES, toolDefinitions, toolDescription, toolInputSchema } from "./descriptions.js";

const config: PolicyConfig = {
  breakGlassUsers: ["breakglass1@contoso.com"],
  managedGroups: [
    { id: "20a26e53-1cbd-48e3-8cc4-8d86cece7a6a", displayName: "Marketing" },
    { id: "88981a1a-1f6b-438c-9475-26b7c619dce0", displayName: "Finance" },
  ],
  directoryRoleIds: [],
};

describe("tool definitions", () => {
  it("exposes exactly the two Sprint 1 tools", () => {
    expect(TOOL_NAMES).toEqual(["list_user_groups", "add_user_to_group"]);
    expect(toolDefinitions(config).map((t) => t.name)).toEqual(["list_user_groups", "add_user_to_group"]);
  });

  it("advertises a minimal, closed input schema with a description per parameter", () => {
    expect(toolInputSchema("add_user_to_group")).toEqual({
      type: "object",
      properties: {
        userPrincipalName: { type: "string", description: expect.stringContaining("alice@contoso.com") },
        groupId: { type: "string", description: expect.stringContaining("managed groups") },
      },
      required: ["userPrincipalName", "groupId"],
      additionalProperties: false,
    });
    expect(toolInputSchema("list_user_groups").required).toEqual(["userPrincipalName"]);
    // No regex leaks into the prompt: the gateway validates, the model just needs the shape.
    expect(JSON.stringify(toolInputSchema("list_user_groups"))).not.toContain("pattern");
  });
});

// These pin the behavioural phrases. Changing the wording is allowed; changing it without
// noticing is not. Update the test in the same commit as the description.
describe("add_user_to_group description", () => {
  const text = toolDescription("add_user_to_group", config);

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

  it("lists the managed groups by name and id so the agent can resolve a group name", () => {
    expect(text).toContain("- Marketing: 20a26e53-1cbd-48e3-8cc4-8d86cece7a6a");
    expect(text).toContain("- Finance: 88981a1a-1f6b-438c-9475-26b7c619dce0");
    expect(text).toContain("the only valid values for groupId");
  });

  it("says so when no groups are managed", () => {
    expect(toolDescription("add_user_to_group", { ...config, managedGroups: [] })).toContain("none configured");
  });
});

describe("list_user_groups description", () => {
  const text = toolDescription("list_user_groups", config);

  it("states that it runs without approval and changes nothing", () => {
    expect(text).toContain("Runs without approval and changes nothing.");
  });

  it("tells the agent not to route around a denial", () => {
    expect(text).toContain('{ status: "denied", rules, message }');
    expect(text).toContain("Do not look for another way to get the same information.");
  });
});
