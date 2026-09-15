import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { decide } from "./decide.js";
import { Rule, type PolicyConfig, type RequestContext, type ToolRequest } from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures. Ids are shaped like real Entra object ids but are obviously fake.
// ---------------------------------------------------------------------------

const MARKETING = "11111111-1111-4111-8111-111111111111";
const FINANCE = "22222222-2222-4222-8222-222222222222";
const UNMANAGED_GROUP = "33333333-3333-4333-8333-333333333333";
/** Real, public role template id for Global Administrator. */
const GLOBAL_ADMIN_ROLE = "62e90394-69f5-4237-9190-012177145e10";

const BREAK_GLASS_1 = "breakglass1@contoso.com";
const BREAK_GLASS_2 = "breakglass2@contoso.com";
const ALICE = "alice@contoso.com";

const config: PolicyConfig = {
  breakGlassUsers: [BREAK_GLASS_1, BREAK_GLASS_2],
  managedGroups: [
    { id: MARKETING, displayName: "Marketing" },
    { id: FINANCE, displayName: "Finance" },
  ],
  directoryRoleIds: [GLOBAL_ADMIN_ROLE],
};

const context: RequestContext = {
  actor: "helpdesk.operator@contoso.com",
  agent: "identity-agent",
  timestamp: "2026-09-15T12:00:00.000Z",
};

const listGroups = (userPrincipalName: string): ToolRequest => ({
  tool: "list_user_groups",
  params: { userPrincipalName },
});

const addToGroup = (userPrincipalName: string, groupId: string): ToolRequest => ({
  tool: "add_user_to_group",
  params: { userPrincipalName, groupId },
});

/** Narrow a Decision to the two variants that carry rules. */
const rulesOf = (decision: ReturnType<typeof decide>): string[] =>
  decision.outcome === "autonomous" ? [] : decision.rules;

// ---------------------------------------------------------------------------

describe("decide()", () => {
  describe("autonomous", () => {
    it("lets list_user_groups run for any user in the tenant", () => {
      expect(decide(listGroups(ALICE), context, config)).toEqual({ outcome: "autonomous" });
    });
  });

  describe("approval", () => {
    it("always requires approval for add_user_to_group, even to a managed group", () => {
      expect(decide(addToGroup(ALICE, MARKETING), context, config)).toEqual({
        outcome: "approval",
        rules: [Rule.ApprovalAddUserToGroup],
      });
    });
  });

  describe("each deny rule fires on its own", () => {
    it("denies when the target is a directory role rather than a group", () => {
      // Even if someone mistakenly puts the role id on the managed allowlist, the role rule
      // still fires. Allowlisting the role here isolates this rule from the allowlist rule.
      const misconfigured: PolicyConfig = {
        ...config,
        managedGroups: [...config.managedGroups, { id: GLOBAL_ADMIN_ROLE, displayName: "oops" }],
      };
      expect(decide(addToGroup(ALICE, GLOBAL_ADMIN_ROLE), context, misconfigured)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyDirectoryRoleTarget],
      });
    });

    it("denies when the target user is on the break glass list", () => {
      expect(decide(addToGroup(BREAK_GLASS_1, MARKETING), context, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyBreakGlassUser],
      });
    });

    it("denies reading the groups of a break glass account too, not just writing", () => {
      expect(decide(listGroups(BREAK_GLASS_2), context, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyBreakGlassUser],
      });
    });

    it("denies when the target group is not on the managed allowlist", () => {
      expect(decide(addToGroup(ALICE, UNMANAGED_GROUP), context, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyGroupNotManaged],
      });
    });

    it("denies every add when the managed allowlist is empty", () => {
      const nothingManaged: PolicyConfig = { ...config, managedGroups: [] };
      expect(decide(addToGroup(ALICE, MARKETING), context, nothingManaged)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyGroupNotManaged],
      });
    });
  });

  describe("precedence", () => {
    it("deny wins when a deny rule and the approval rule would both match", () => {
      // add_user_to_group always matches the approval rule; break glass is a deny rule.
      const decision = decide(addToGroup(BREAK_GLASS_1, MARKETING), context, config);
      expect(decision.outcome).toBe("denied");
      expect(rulesOf(decision)).toContain(Rule.DenyBreakGlassUser);
      expect(rulesOf(decision)).not.toContain(Rule.ApprovalAddUserToGroup);
    });

    it("lists every deny rule that fired, in evaluation order", () => {
      // A break glass user, into a directory role, which is (of course) not a managed group.
      expect(decide(addToGroup(BREAK_GLASS_1, GLOBAL_ADMIN_ROLE), context, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyDirectoryRoleTarget, Rule.DenyBreakGlassUser, Rule.DenyGroupNotManaged],
      });
    });
  });

  describe("structural denials", () => {
    it.each([
      ["a tool that does not exist", "remove_user_from_group"],
      ["an empty tool name", ""],
      ["an Object.prototype key", "constructor"],
      ["a non-string tool name", 42 as unknown as string],
    ])("denies %s", (_label, tool) => {
      const request: ToolRequest = { tool, params: { userPrincipalName: ALICE } };
      expect(decide(request, context, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyUnknownTool],
      });
    });

    it.each<[string, ToolRequest]>([
      ["missing userPrincipalName", { tool: "list_user_groups", params: {} }],
      ["userPrincipalName that is not a UPN", listGroups("alice")],
      ["userPrincipalName with whitespace", listGroups("alice smith@contoso.com")],
      ["userPrincipalName with a path separator", listGroups("../admin@contoso.com")],
      ["empty userPrincipalName", listGroups("")],
      ["non-string userPrincipalName", { tool: "list_user_groups", params: { userPrincipalName: 7 } }],
      ["groupId that is not a GUID", addToGroup(ALICE, "Marketing")],
      ["groupId that is the display name of a role", addToGroup(ALICE, "Global Administrator")],
      ["missing groupId", { tool: "add_user_to_group", params: { userPrincipalName: ALICE } }],
      ["an unexpected extra parameter", { tool: "list_user_groups", params: { userPrincipalName: ALICE, extra: true } }],
      ["params that are null", { tool: "list_user_groups", params: null }],
      ["params that are undefined", { tool: "list_user_groups", params: undefined }],
      ["params that are an array", { tool: "list_user_groups", params: [ALICE] }],
      ["params that are a string", { tool: "list_user_groups", params: ALICE }],
    ])("denies %s instead of throwing", (_label, request) => {
      expect(() => decide(request, context, config)).not.toThrow();
      expect(decide(request, context, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyMalformedParameters],
      });
    });

    it("denies rather than throws when the request object itself is garbage", () => {
      const garbage = null as unknown as ToolRequest;
      expect(() => decide(garbage, context, config)).not.toThrow();
      expect(decide(garbage, context, config).outcome).toBe("denied");
    });
  });

  describe("normalisation", () => {
    it("matches break glass UPNs case-insensitively", () => {
      expect(decide(listGroups("BreakGlass1@Contoso.COM"), context, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyBreakGlassUser],
      });
    });

    it("matches managed group ids case-insensitively", () => {
      expect(decide(addToGroup(ALICE, MARKETING.toUpperCase()), context, config)).toEqual({
        outcome: "approval",
        rules: [Rule.ApprovalAddUserToGroup],
      });
    });

    it("matches directory role ids case-insensitively", () => {
      const decision = decide(addToGroup(ALICE, GLOBAL_ADMIN_ROLE.toUpperCase()), context, config);
      expect(decision.outcome).toBe("denied");
      expect(rulesOf(decision)).toContain(Rule.DenyDirectoryRoleTarget);
    });

    it("accepts guest-style UPNs", () => {
      expect(
        decide(listGroups("bob_gmail.com#EXT#@contoso.onmicrosoft.com"), context, config),
      ).toEqual({ outcome: "autonomous" });
    });
  });

  describe("purity", () => {
    it("is deterministic for the same input", () => {
      const request = addToGroup(ALICE, MARKETING);
      expect(decide(request, context, config)).toEqual(decide(request, context, config));
    });

    it("does not mutate the request, context or config", () => {
      const request = Object.freeze(addToGroup(BREAK_GLASS_1, GLOBAL_ADMIN_ROLE));
      const frozenContext = Object.freeze({ ...context });
      const frozenConfig = Object.freeze({ ...config });
      const before = JSON.stringify([request, frozenContext, frozenConfig]);

      decide(request, frozenContext, frozenConfig);

      expect(JSON.stringify([request, frozenContext, frozenConfig])).toBe(before);
    });

    it("does not depend on the context in Sprint 1", () => {
      // No rule reads the context yet. Pin that, so a future rule that does is a visible change.
      const other: RequestContext = {
        actor: ALICE,
        agent: "someone-else",
        timestamp: "1970-01-01T00:00:00.000Z",
      };
      expect(decide(addToGroup(ALICE, MARKETING), other, config)).toEqual(
        decide(addToGroup(ALICE, MARKETING), context, config),
      );
    });

    it("never reads the clock or randomness; time arrives only through RequestContext", () => {
      // decide() swallows exceptions into deny.policy_error, so a trapped clock shows up as the
      // wrong decision rather than as a throw. Assert the real decision after restoring globals.
      class Trapped extends Error {}
      const trap = (what: string) => () => {
        throw new Trapped(`decide() touched ${what}`);
      };
      const RealDate = globalThis.Date;
      const trappedDate = new Proxy(RealDate, {
        construct: trap("new Date()"),
        apply: trap("Date()"),
        get: (target, prop, receiver) =>
          prop === "now" ? trap("Date.now()") : Reflect.get(target, prop, receiver),
      });
      vi.stubGlobal("Date", trappedDate);
      const perf = vi.spyOn(performance, "now").mockImplementation(trap("performance.now()"));
      const rand = vi.spyOn(Math, "random").mockImplementation(trap("Math.random()"));

      let decisions: unknown[];
      try {
        decisions = [
          decide(addToGroup(ALICE, MARKETING), context, config),
          decide(listGroups(ALICE), context, config),
          decide(addToGroup(BREAK_GLASS_1, GLOBAL_ADMIN_ROLE), context, config),
          decide({ tool: "list_user_groups", params: null }, context, config),
        ];
      } finally {
        vi.unstubAllGlobals();
        perf.mockRestore();
        rand.mockRestore();
      }

      expect(decisions).toEqual([
        { outcome: "approval", rules: [Rule.ApprovalAddUserToGroup] },
        { outcome: "autonomous" },
        {
          outcome: "denied",
          rules: [Rule.DenyDirectoryRoleTarget, Rule.DenyBreakGlassUser, Rule.DenyGroupNotManaged],
        },
        { outcome: "denied", rules: [Rule.DenyMalformedParameters] },
      ]);
    });

    it("has no clock or randomness call anywhere in the policy sources", async () => {
      // Belt and braces for the runtime trap above: a future code path the trap test does not
      // exercise still cannot smuggle in a clock read.
      const dir = dirname(fileURLToPath(import.meta.url));
      const sources = (await readdir(dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
      expect(sources.length).toBeGreaterThan(0);

      const forbidden = /\b(?:Date\.now|new Date|performance\.now|Math\.random|process\.hrtime|randomUUID|randomBytes)\b/;
      for (const file of sources) {
        const source = await readFile(join(dir, file), "utf8");
        expect(source, `${file} reads the clock or randomness`).not.toMatch(forbidden);
      }
    });
  });
});
