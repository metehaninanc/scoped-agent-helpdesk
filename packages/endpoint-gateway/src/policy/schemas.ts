/**
 * Parameter schemas for this gateway's four tools. Same role as every other gateway's
 * schemas.ts: the single definition of "validated parameters", reused by both the MCP tool
 * registration and decide().
 *
 * reset_password is declared here like any other tool — so that a model can discover it, attempt
 * it, and have that attempt validated and named — even though it has no working implementation
 * anywhere in this package (see tools/handler.ts's execute(), which has no case for it at all,
 * and policy/decide.ts, whose deny tier matches it unconditionally before execute() is ever
 * reached). Declaring it is what turns "the model tried to reset a password" into a specific,
 * auditable `deny.password_reset_never_automated` rather than a generic `deny.unknown_tool` — see
 * the README, "Endpoint gateway notes", for why that distinction matters here.
 */
import { z } from "zod";

import { HAND_OFF_PARAMS_SCHEMA, HAND_OFF_TOOL_NAME, userPrincipalName } from "@helpdesk/gateway-core";

import type { ToolRequest } from "./types.js";

const endpointId = z.string().min(1, "endpointId is required");

export const toolParamSchemas = {
  list_endpoints: z.strictObject({}),
  get_endpoint: z.strictObject({ endpointId }),
  reboot_endpoint: z.strictObject({ endpointId }),
  reset_password: z.strictObject({ userPrincipalName }),
  [HAND_OFF_TOOL_NAME]: HAND_OFF_PARAMS_SCHEMA,
} as const;

export type ToolName = keyof typeof toolParamSchemas;
export type ToolParams<T extends ToolName> = z.infer<(typeof toolParamSchemas)[T]>;

/** A ToolRequest after validation: the tool name is known and its params match its schema. */
export type ValidatedToolRequest = {
  [T in ToolName]: { tool: T; params: ToolParams<T> };
}[ToolName];

export type ParseResult =
  | { ok: true; request: ValidatedToolRequest }
  | { ok: false; reason: "unknown_tool" | "malformed_parameters" };

export function isToolName(tool: unknown): tool is ToolName {
  return typeof tool === "string" && Object.hasOwn(toolParamSchemas, tool);
}

export function parseToolRequest(request: ToolRequest): ParseResult {
  const tool: unknown = request.tool;
  if (!isToolName(tool)) return { ok: false, reason: "unknown_tool" };

  const parsed = toolParamSchemas[tool].safeParse(request.params);
  if (!parsed.success) return { ok: false, reason: "malformed_parameters" };

  return { ok: true, request: { tool, params: parsed.data } as ValidatedToolRequest };
}
