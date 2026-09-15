/**
 * Parameter schemas for the two Sprint 1 tools.
 *
 * This is the single definition of "validated parameters". The MCP tool registration reuses
 * these schemas for input validation (step 1 of every handler), and decide() re-runs them so
 * the policy engine can never be handed a shape it did not agree to.
 */
import { z } from "zod";

import type { PolicyConfig, ToolRequest } from "./types.js";

/**
 * Entra UPN: local part @ dotted domain. Guest UPNs look like
 * `bob_gmail.com#EXT#@contoso.onmicrosoft.com`, so `#` must be allowed in the local part.
 * Whitespace and path separators are rejected outright: the UPN ends up in a Graph URL path.
 */
const UPN_PATTERN = /^[^\s@\\/]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export const userPrincipalName = z
  .string()
  .max(113, "UPN exceeds the Entra maximum of 113 characters")
  .regex(UPN_PATTERN, "must be a user principal name such as alice@contoso.com");

/** Entra group object id. `z.guid()` is deliberately looser than `z.uuid()` on version bits. */
export const groupId = z.guid("must be an Entra group object id");

export const toolParamSchemas = {
  list_user_groups: z.strictObject({ userPrincipalName }),
  list_managed_groups: z.strictObject({}),
  add_user_to_group: z.strictObject({ userPrincipalName, groupId }),
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

  // The map lookup above ties `tool` to its schema at runtime; the cast restates that for
  // the type checker, which cannot correlate the two through the indexed access.
  return { ok: true, request: { tool, params: parsed.data } as ValidatedToolRequest };
}

// ---------------------------------------------------------------------------
// Policy config shape. Checked once, at load, so a typo in config.ts fails the process at
// startup instead of quietly turning into "deny everything".
// ---------------------------------------------------------------------------

export const policyConfigSchema = z.strictObject({
  breakGlassUsers: z.array(userPrincipalName).readonly(),
  managedGroups: z
    .array(z.strictObject({ id: groupId, displayName: z.string().min(1, "must not be empty") }))
    .readonly(),
  directoryRoleIds: z.array(groupId).readonly(),
});

/** Throws with every offending entry named. Returns the config unchanged when it is sound. */
export function validatePolicyConfig(config: unknown): PolicyConfig {
  const parsed = policyConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid policy config:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
