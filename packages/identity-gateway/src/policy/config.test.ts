import { describe, expect, it } from "vitest";

import { validatePolicyConfig } from "./schemas.js";
import type { PolicyConfig } from "./types.js";

const MARKETING = "11111111-1111-4111-8111-111111111111";

const valid: PolicyConfig = {
  breakGlassUsers: ["breakglass1@contoso.com", "breakglass2@contoso.com"],
  managedGroups: [{ id: MARKETING, displayName: "Marketing" }],
  directoryRoleIds: ["62e90394-69f5-4237-9190-012177145e10"],
};

describe("validatePolicyConfig()", () => {
  it("returns a well-formed config unchanged", () => {
    expect(validatePolicyConfig(valid)).toEqual(valid);
  });

  it("accepts an empty managed group list (deny everything is a valid policy)", () => {
    expect(() => validatePolicyConfig({ ...valid, managedGroups: [] })).not.toThrow();
  });

  it("fails loudly when a break glass entry is not a UPN, naming the entry", () => {
    const bad = { ...valid, breakGlassUsers: ["breakglass1@contoso.com", "not a upn"] };
    expect(() => validatePolicyConfig(bad)).toThrow(/breakGlassUsers\[1\]/);
  });

  it("fails loudly when a managed group id is not a GUID, naming the entry", () => {
    const bad = { ...valid, managedGroups: [{ id: "Marketing", displayName: "Marketing" }] };
    expect(() => validatePolicyConfig(bad)).toThrow(/managedGroups\[0\]\.id/);
  });

  it("fails loudly when a managed group has no display name", () => {
    const bad = { ...valid, managedGroups: [{ id: MARKETING, displayName: "" }] };
    expect(() => validatePolicyConfig(bad)).toThrow(/managedGroups\[0\]\.displayName/);
  });

  it("fails loudly when a directory role id is not a GUID", () => {
    const bad = { ...valid, directoryRoleIds: ["Global Administrator"] };
    expect(() => validatePolicyConfig(bad)).toThrow(/directoryRoleIds\[0\]/);
  });

  it("fails loudly on a missing section rather than defaulting it", () => {
    const { breakGlassUsers: _dropped, ...missing } = valid;
    expect(() => validatePolicyConfig(missing)).toThrow(/breakGlassUsers/);
  });

  it("rejects unknown keys so a typo cannot silently disable a section", () => {
    const bad = { ...valid, breakGlassUser: ["typo@contoso.com"] };
    expect(() => validatePolicyConfig(bad)).toThrow(/breakGlassUser/);
  });

  it("says it is the policy config that is wrong", () => {
    expect(() => validatePolicyConfig(null)).toThrow(/policy config/i);
  });
});

describe("the shipped config", () => {
  it("loads without throwing (placeholders are well-formed)", async () => {
    const { policyConfig } = await import("./config.js");
    expect(policyConfig.breakGlassUsers).toHaveLength(2);
    expect(policyConfig.directoryRoleIds.length).toBeGreaterThan(50);
  });
});
