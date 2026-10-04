/**
 * Everything the model reads about this gateway's four tools, in one file, same convention as
 * every other gateway's descriptions.ts. This is prompt surface: reviewed as a unit, and
 * descriptions.test.ts pins the phrases that matter.
 *
 * reset_password's own description carries the same guidance the policy engine's refusal message
 * gives (SPRINT3.md, 3.4: self-service reset first, the manager if that is not available, and a
 * plain statement that this system never does it) — not because the description is what enforces
 * the refusal (policy/decide.ts does that, unconditionally, before this tool's non-existent
 * execute() path is ever reached), but so the model already has the right words even before it
 * tries the tool, rather than discovering the refusal only after an attempt.
 */
import { z } from "zod";

import { HAND_OFF_TOOL_DESCRIPTION } from "@helpdesk/gateway-core";

import { toolParamSchemas, type ToolName } from "../policy/schemas.js";

export const TOOL_NAMES = Object.keys(toolParamSchemas) as ToolName[];

const PARAMETER_DESCRIPTIONS: Record<string, string> = {
  endpointId: "The stub endpoint service's own id for the device, exactly as list_endpoints or get_endpoint reported it.",
  userPrincipalName: "The UPN of the person whose password reset is being requested.",
  reason: "A short account of what a person needs to do.",
};

export function toolDescription(tool: ToolName): string {
  switch (tool) {
    case "list_endpoints":
      return [
        "Lists every endpoint known to the stub endpoint service: id, hostname, status",
        "(online, offline or rebooting) and when it last checked in. A read; always autonomous.",
      ].join("\n");
    case "get_endpoint":
      return [
        "Looks up one endpoint by its id. Returns null if no endpoint has that id. A read;",
        "always autonomous.",
      ].join("\n");
    case "reboot_endpoint":
      return [
        "Requests a reboot of one endpoint. This changes device state, so it is always approval",
        "gated: calling it returns a pending approval, not an immediate result, and that is the",
        "normal, successful outcome of asking for a reboot, not a failure to retry around. A human",
        "reviews and decides; only then does the reboot actually happen.",
      ].join("\n");
    case "reset_password":
      return [
        "This system never resets a password through this tool or any other, for anyone, under",
        "any circumstance — it is refused before you are even told who is asking, with no",
        "argument, target user or rephrasing that changes the outcome. If someone needs their",
        "password reset, tell them plainly that this system cannot do it, and point them to",
        "Self-Service Password Reset (SSPR) first; if SSPR is not available to them, point them to",
        "their manager. Do not retry this tool with different wording or a different target user —",
        "the refusal does not depend on either.",
      ].join("\n");

    // SPRINT4.md, section 2: identical on every gateway — see @helpdesk/gateway-core's own
    // hand-off-tool.ts for why this text lives there, not here, and is only referenced.
    case "hand_off":
      return HAND_OFF_TOOL_DESCRIPTION;
  }
}

/** JSON schema for the model: types and descriptions only. The gateway validates strictly. */
export function toolInputSchema(tool: ToolName): {
  type: "object";
  properties: Record<string, { type: string; description: string }>;
  required: string[];
  additionalProperties: false;
} {
  const generated = z.toJSONSchema(toolParamSchemas[tool]) as {
    properties?: Record<string, { type?: string }>;
    required?: string[];
  };
  const properties: Record<string, { type: string; description: string }> = {};
  for (const [name, shape] of Object.entries(generated.properties ?? {})) {
    properties[name] = { type: shape.type ?? "string", description: PARAMETER_DESCRIPTIONS[name] ?? "" };
  }
  return { type: "object", properties, required: generated.required ?? [], additionalProperties: false };
}

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: ReturnType<typeof toolInputSchema>;
}

export function toolDefinitions(): ToolDefinition[] {
  return TOOL_NAMES.map((name) => ({
    name,
    description: toolDescription(name),
    inputSchema: toolInputSchema(name),
  }));
}
