import { describe, expect, it } from "vitest";

import { TOOL_NAMES, toolDefinitions, toolDescription, toolInputSchema } from "./descriptions.js";

describe("tool definitions", () => {
  it("exposes exactly the two Sprint 2 MDM tools", () => {
    expect(TOOL_NAMES).toEqual(["list_devices", "get_device"]);
    expect(toolDefinitions().map((t) => t.name)).toEqual(TOOL_NAMES);
  });

  it("advertises a minimal, closed input schema with a description per parameter", () => {
    expect(toolInputSchema("get_device")).toEqual({
      type: "object",
      properties: { deviceId: { type: "string", description: expect.stringContaining("list_devices") } },
      required: ["deviceId"],
      additionalProperties: false,
    });
    expect(toolInputSchema("list_devices")).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
    expect(JSON.stringify(toolInputSchema("get_device"))).not.toContain("pattern");
  });

  it("puts no protected resource into the prompt: descriptions are static text with no ids in them", () => {
    const guid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const tool of toolDefinitions()) {
      expect(tool.description, tool.name).not.toMatch(guid);
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toMatch(guid);
    }
    expect(toolDescription.length).toBe(1);
  });
});

describe("get_device description", () => {
  const text = toolDescription("get_device");

  it("sends the agent to list_devices to resolve an id and forbids guessing one", () => {
    expect(text).toContain("call\nlist_devices first");
    expect(text).toContain("Do not guess a device id");
  });

  it("explains denied and tells the agent not to retry", () => {
    expect(text).toContain('{ status: "denied", rules, message }');
    expect(text).toContain("Do not retry");
  });
});

describe("list_devices description", () => {
  const text = toolDescription("list_devices");

  it("says it takes nothing, runs without approval, and changes nothing", () => {
    expect(text).toContain("Takes no parameters");
    expect(text).toContain("Runs without approval and changes nothing");
  });

  it("states plainly that this gateway has no write tools", () => {
    expect(text).toContain("This gateway has no write tools at all");
  });
});
