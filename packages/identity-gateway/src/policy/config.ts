/**
 * Sprint 1 policy configuration. In version control on purpose.
 *
 * The break glass list and the managed group allowlist are security policy, not environment
 * configuration. Here, a change to either is a reviewable, attributable commit. In .env it
 * would leave no trace, which is the wrong property for a control this project exists to
 * defend. So: no environment overrides, no runtime mutation, one source of truth.
 *
 * The shape is validated when this module loads. A break glass entry that is not a UPN, or a
 * group entry that is not a GUID, throws here, at startup, rather than silently matching
 * nothing and denying everything.
 *
 * Display names are kept next to ids so the file reads well in review. The engine ignores
 * them; the gateway checks them against Graph once at startup (startup/verify-managed-groups)
 * and warns if a group has been renamed or deleted. That check never runs inside decide().
 */
import { DIRECTORY_ROLE_TEMPLATE_IDS } from "./directory-roles.js";
import { validatePolicyConfig } from "./schemas.js";
import type { PolicyConfig } from "./types.js";

export const policyConfig: PolicyConfig = validatePolicyConfig({
  breakGlassUsers: [
    "breakglass-01@metehantestoutlook.onmicrosoft.com",
    "breakglass-02@metehantestoutlook.onmicrosoft.com",
  ],
  managedGroups: [
    { id: "20a26e53-1cbd-48e3-8cc4-8d86cece7a6a", displayName: "Marketing" },
    { id: "88981a1a-1f6b-438c-9475-26b7c619dce0", displayName: "Finance" },
  ],
  directoryRoleIds: DIRECTORY_ROLE_TEMPLATE_IDS,
} satisfies PolicyConfig);
