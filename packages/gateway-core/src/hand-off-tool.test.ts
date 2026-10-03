import { describe, expect, it, vi } from "vitest";

import type { HandoffRecord } from "@helpdesk/handoff-core";

import { createHandOffExecute, HAND_OFF_PARAMS_SCHEMA, HAND_OFF_TOOL_DESCRIPTION, HAND_OFF_TOOL_NAME } from "./hand-off-tool.js";
import type { SessionContext } from "./session.js";

describe("HAND_OFF_TOOL_NAME / HAND_OFF_PARAMS_SCHEMA / HAND_OFF_TOOL_DESCRIPTION", () => {
  it("names the tool hand_off", () => {
    expect(HAND_OFF_TOOL_NAME).toBe("hand_off");
  });

  it("requires a non-empty reason and nothing else", () => {
    expect(HAND_OFF_PARAMS_SCHEMA.safeParse({ reason: "needs a replacement device" }).success).toBe(true);
    expect(HAND_OFF_PARAMS_SCHEMA.safeParse({ reason: "" }).success).toBe(false);
    expect(HAND_OFF_PARAMS_SCHEMA.safeParse({}).success).toBe(false);
    expect(HAND_OFF_PARAMS_SCHEMA.safeParse({ reason: "x", extra: "not allowed" }).success).toBe(false);
  });

  it("tells the model to call this instead of explaining it cannot help, and never to restate identity or wording", () => {
    expect(HAND_OFF_TOOL_DESCRIPTION).toContain("instead of just");
    expect(HAND_OFF_TOOL_DESCRIPTION).toContain("do not restate the requester's identity or");
    expect(HAND_OFF_TOOL_DESCRIPTION).toContain("handed_off");
  });
});

describe("createHandOffExecute()", () => {
  const session: SessionContext = {
    actor: "alice@contoso.com",
    agent: "identity-agent",
    requestId: "req-1",
    requestText: "my laptop screen is cracked",
  };

  it("creates a handoff from the session's own actor, requestId and requestText — never from the tool's own params", async () => {
    const record: HandoffRecord = {
      id: "handoff-1",
      createdAt: "2026-09-15T12:00:00.000Z",
      requestId: "req-1",
      actor: "alice@contoso.com",
      requestText: "my laptop screen is cracked",
      createdBy: "identity-agent",
      reason: "needs a replacement device",
      urgent: false,
      status: "open",
      takenBy: null,
      takenAt: null,
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
    };
    const create = vi.fn().mockReturnValue(record);
    const execute = createHandOffExecute({ create });

    const result = await execute({ tool: "hand_off", params: { reason: "needs a replacement device" } }, session);

    expect(create).toHaveBeenCalledWith({
      requestId: "req-1",
      actor: "alice@contoso.com",
      requestText: "my laptop screen is cracked",
      createdBy: "identity-agent",
      reason: "needs a replacement device",
    });
    expect(result).toEqual({ status: "handed_off", handoffId: "handoff-1" });
  });
});
