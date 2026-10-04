/**
 * Parameter schemas for this gateway's tools: the one Sprint 3.3 tool, plus `hand_off`
 * (SPRINT4.md, section 2 — identical on every gateway, schema imported from
 * @helpdesk/gateway-core rather than redeclared here). Same role as the other three gateways'
 * schemas.ts: the single definition of "validated parameters", reused by both the MCP tool
 * registration and decide().
 */
import { z } from "zod";

import { HAND_OFF_PARAMS_SCHEMA, HAND_OFF_TOOL_NAME } from "@helpdesk/gateway-core";

import type { ToolRequest } from "./types.js";

export const toolParamSchemas = {
  search_documentation: z.strictObject({ query: z.string().min(1).max(300) }),
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
