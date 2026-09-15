/**
 * Everything the model reads about the gateway's tools, in one file, so it can be reviewed as
 * a unit. This is prompt surface. Treat a change here with the same care as a change to the
 * policy engine: descriptions.test.ts pins the phrases that matter so that a rewrite is a
 * deliberate act, not a drive-by.
 *
 * Descriptions are written as behaviour, not documentation: what the tool does, what its
 * results mean, and what the agent must do with each of them.
 */
import { z } from "zod";

import { toolParamSchemas, type ToolName } from "../policy/schemas.js";
import type { PolicyConfig } from "../policy/types.js";

export const TOOL_NAMES = Object.keys(toolParamSchemas) as ToolName[];

const PARAMETER_DESCRIPTIONS: Record<string, string> = {
  userPrincipalName:
    "The user's principal name, which is their sign-in address, for example alice@contoso.com. Use it exactly as the requester gave it.",
  groupId:
    "The object id (GUID) of the target group. Only the managed groups listed in this tool's description can be used; take the id from that list.",
};

export function toolDescription(tool: ToolName, config: PolicyConfig): string {
  switch (tool) {
    case "list_user_groups":
      return [
        "Lists the security groups a user is a member of, as { id, displayName } pairs.",
        "Runs without approval and changes nothing.",
        "",
        "Results:",
        '- { status: "ok", groups: [...] }: the user\'s current group memberships. An empty list means the user is in no groups.',
        '- { status: "denied", rules, message }: policy refused this lookup, for example because the account is protected. Tell the requester it was refused and which rule applied. Do not look for another way to get the same information.',
        '- { status: "error", code, message }: the directory could not answer, for example the user does not exist. Report the message as given.',
      ].join("\n");

    case "add_user_to_group":
      return [
        "Requests that a user be added to one of the managed security groups. This tool records the request; it does not perform the change itself.",
        "",
        "In this system every group change needs a human approver, so the normal, successful result of this tool is:",
        '- { status: "pending_approval", approvalId }: the request has been recorded and is waiting for an approver. This is success. Tell the requester the change is pending approval, give them the approvalId, and stop. Do not call this tool again for the same user and group, do not look for another tool or method to make the change, and do not say the change has been made.',
        "",
        "Other results:",
        '- { status: "denied", rules, message }: policy refused the request, for example because the target is a directory role rather than a group, the account is protected, or the group is not one this system manages. Report the refusal and the rule plainly. Do not retry with different parameters to get around it.',
        '- { status: "executed" }: the change was carried out immediately. This does not happen in the current configuration.',
        '- { status: "error", code, message }: the request could not be recorded. Report the message as given.',
        "",
        "Managed groups (the only valid values for groupId):",
        ...(config.managedGroups.length === 0
          ? ["- (none configured; every request will be denied)"]
          : config.managedGroups.map((g) => `- ${g.displayName}: ${g.id}`)),
      ].join("\n");
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

export function toolDefinitions(config: PolicyConfig): ToolDefinition[] {
  return TOOL_NAMES.map((name) => ({
    name,
    description: toolDescription(name, config),
    inputSchema: toolInputSchema(name),
  }));
}
