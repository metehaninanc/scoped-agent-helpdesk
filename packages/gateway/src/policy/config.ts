/**
 * Sprint 1 policy configuration. Hardcoded on purpose (SPRINT1.md: "hardcode two UPNs in
 * config"). Nothing here is a secret; it is reviewable policy and belongs in source control.
 *
 * The shape is validated when this module loads. A break glass entry that is not a UPN, or a
 * group entry that is not a GUID, throws here, at startup, rather than silently matching
 * nothing and denying everything.
 *
 * TODO(azure-setup): after the tenant exists, replace the placeholder break glass UPNs and
 * fill managedGroups with the Marketing and Finance group object ids. Until managedGroups is
 * filled, add_user_to_group is denied for every group, which is the correct default.
 */
import { DIRECTORY_ROLE_TEMPLATE_IDS } from "./directory-roles.js";
import { validatePolicyConfig } from "./schemas.js";
import type { PolicyConfig } from "./types.js";

export const policyConfig: PolicyConfig = validatePolicyConfig({
  breakGlassUsers: [
    "breakglass1@REPLACE-ME.onmicrosoft.com",
    "breakglass2@REPLACE-ME.onmicrosoft.com",
  ],
  managedGroups: [
    // { id: "<Marketing group object id>", displayName: "Marketing" },
    // { id: "<Finance group object id>", displayName: "Finance" },
  ],
  directoryRoleIds: DIRECTORY_ROLE_TEMPLATE_IDS,
} satisfies PolicyConfig);
