/**
 * Everything the model reads about this gateway's tools, in one file, same convention as the
 * identity gateway's descriptions.ts. This is prompt surface: reviewed as a unit, and
 * descriptions.test.ts pins the phrases that matter.
 *
 * Both tools here are reads with no approval path (SPRINT2.md, Component 1: no write tools),
 * so there is no "pending is success" phrasing to pin the way add_user_to_group's is. What
 * still matters: the model must not guess a device id, and must report a denial or an error
 * plainly rather than retrying.
 */
import { z } from "zod";

import { HAND_OFF_TOOL_DESCRIPTION } from "@helpdesk/gateway-core";

import { toolParamSchemas, type ToolName } from "../policy/schemas.js";

export const TOOL_NAMES = Object.keys(toolParamSchemas) as ToolName[];

const PARAMETER_DESCRIPTIONS: Record<string, string> = {
  deviceId: "The object id (GUID) of the device, taken from a list_devices result. Do not guess an id.",
  reason: "A short account of what a person needs to do.",
};

export function toolDescription(tool: ToolName): string {
  switch (tool) {
    case "list_devices":
      return [
        "Lists devices registered in the tenant, as { id, displayName, operatingSystem, isCompliant } entries.",
        "Takes no parameters. Runs without approval and changes nothing. This gateway has no write tools at all.",
        "",
        "Results:",
        '- { status: "ok", devices: [...] }: the tenant\'s devices. An empty list means there are none.',
        '- { status: "denied", rules, message }: policy refused this lookup. Report it as given. Do not retry.',
        '- { status: "error", code, message }: the directory could not answer. Report the message as given.',
      ].join("\n");

    case "get_device":
      return [
        "Looks up one device by id, as { id, displayName, operatingSystem, isCompliant }.",
        "",
        "deviceId must be an id returned by list_devices. If you only have a device name, call",
        "list_devices first and use the matching id. Do not guess a device id.",
        "",
        "Runs without approval and changes nothing.",
        "",
        "Results:",
        '- { status: "ok", device }: the device.',
        '- { status: "denied", rules, message }: policy refused this lookup. Report it as given. Do not retry.',
        '- { status: "error", code, message }: the device does not exist, or the directory could not answer. Report the message as given.',
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
