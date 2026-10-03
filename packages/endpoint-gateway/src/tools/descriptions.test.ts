import { describe, expect, it } from "vitest";

import { HAND_OFF_TOOL_DESCRIPTION } from "@helpdesk/gateway-core";

import { TOOL_NAMES, toolDefinitions, toolDescription, toolInputSchema } from "./descriptions.js";

describe("tool definitions", () => {
  it("exposes the four SPRINT3.md, 3.4 tools plus hand_off (SPRINT4.md, section 2 — on every gateway)", () => {
    expect(TOOL_NAMES).toEqual(["list_endpoints", "get_endpoint", "reboot_endpoint", "reset_password", "hand_off"]);
    expect(toolDefinitions().map((t) => t.name)).toEqual(TOOL_NAMES);
  });

  it("advertises a minimal, closed input schema with a description per parameter", () => {
    expect(toolInputSchema("get_endpoint")).toEqual({
      type: "object",
      properties: { endpointId: { type: "string", description: expect.stringContaining("stub endpoint service") } },
      required: ["endpointId"],
      additionalProperties: false,
    });
    expect(toolInputSchema("list_endpoints")).toEqual({ type: "object", properties: {}, required: [], additionalProperties: false });
  });

  it("puts no protected resource into the prompt: descriptions are static text with no ids in them", () => {
    const guid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const tool of toolDefinitions()) {
      expect(tool.description, tool.name).not.toMatch(guid);
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toMatch(guid);
    }
  });
});

describe("reboot_endpoint description", () => {
  const text = toolDescription("reboot_endpoint");

  it("tells the agent a pending approval is the normal, successful outcome, not something to retry around", () => {
    expect(text.replace(/\s+/g, " ")).toContain("that is the normal, successful outcome of asking for a reboot, not a failure to retry around");
  });

  it("says a human decides before the reboot happens", () => {
    expect(text).toContain("A human");
    expect(text).toContain("only then does the reboot actually happen");
  });
});

describe("reset_password description", () => {
  const text = toolDescription("reset_password").replace(/\s+/g, " ");

  it("states plainly that this system never resets a password, for anyone, under any circumstance", () => {
    expect(text).toContain("This system never resets a password through this tool or any other, for anyone, under any circumstance");
  });

  it("points to Self-Service Password Reset first", () => {
    expect(text).toContain("Self-Service Password Reset (SSPR) first");
  });

  it("points to the manager if SSPR is not available", () => {
    expect(text).toContain("if SSPR is not available to them, point them to their manager");
  });

  it("forbids retrying with different wording or a different target user", () => {
    expect(text).toContain("Do not retry this tool with different wording or a different target user");
  });

  it("says the refusal does not depend on who is asking, the argument, or rephrasing", () => {
    expect(text).toContain("refused before you are even told who is asking, with no argument, target user or rephrasing that changes the outcome");
  });
});

describe("hand_off description", () => {
  it("is the shared, cross-gateway text from @helpdesk/gateway-core, not a local copy (SPRINT4.md, section 2)", () => {
    expect(toolDescription("hand_off")).toBe(HAND_OFF_TOOL_DESCRIPTION);
  });
});
