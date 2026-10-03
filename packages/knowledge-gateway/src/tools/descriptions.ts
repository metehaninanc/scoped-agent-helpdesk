/**
 * Everything the model reads about this gateway's one tool, in one file, same convention as the
 * other two gateways' descriptions.ts. This is prompt surface: reviewed as a unit, and
 * descriptions.test.ts pins the phrases that matter.
 *
 * The two things worth pinning here (SPRINT3.md, 3.3): the model must treat an empty result as
 * "say you don't know," never as license to answer from its own training, and it must never
 * claim to have done anything — this agent has exactly one tool, and that tool cannot act.
 */
import { z } from "zod";

import { HAND_OFF_TOOL_DESCRIPTION } from "@helpdesk/gateway-core";

import { toolParamSchemas, type ToolName } from "../policy/schemas.js";

export const TOOL_NAMES = Object.keys(toolParamSchemas) as ToolName[];

const PARAMETER_DESCRIPTIONS: Record<string, string> = {
  query: "A short natural-language search of the documentation, in the requester's own words.",
  reason: "A short account of what a person needs to do.",
};

export function toolDescription(tool: ToolName): string {
  switch (tool) {
    case "search_documentation":
      return [
        "Searches a fixed, pinned-commit corpus of Microsoft Learn documentation for Microsoft",
        "Entra and Microsoft Intune, and returns matching passages with their source document",
        "and heading. This is the only way you can answer a documentation or how-to question:",
        "you have no other tool, and you must not answer from your own training instead.",
        "",
        "Results:",
        '- { status: "ok", passages: [...] }: zero or more passages, each with sourceTitle,',
        "heading, text and sourceUrl. Cite the sourceTitle and heading for every fact you state",
        "from a passage. An empty passages array is a normal, successful result: it means",
        "nothing in the corpus matched. When it is empty, say plainly that you don't know rather",
        "than answering from anything else you know about the topic. Do not retry the same query",
        "worded differently more than once.",
        '- { status: "denied", rules, message }: policy refused this lookup. Report it as given.',
        '- { status: "error", code, message }: the gateway failed. Report the message as given.',
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
