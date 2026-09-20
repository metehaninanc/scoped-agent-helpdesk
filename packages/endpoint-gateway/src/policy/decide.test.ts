import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { decide } from "./decide.js";
import { Rule, type PolicyConfig, type RequestContext, type ToolRequest } from "./types.js";

const ENDPOINT = "ep-front-desk-01";
const config: PolicyConfig = {};

const context: RequestContext = {
  actor: "helpdesk.operator@contoso.com",
  agent: "endpoint-agent",
  timestamp: "2026-09-19T12:00:00.000Z",
};

const listEndpoints: ToolRequest = { tool: "list_endpoints", params: {} };
const getEndpoint = (endpointId: string): ToolRequest => ({ tool: "get_endpoint", params: { endpointId } });
const rebootEndpoint = (endpointId: string): ToolRequest => ({ tool: "reboot_endpoint", params: { endpointId } });
const resetPassword = (userPrincipalName: string): ToolRequest => ({ tool: "reset_password", params: { userPrincipalName } });

describe("decide()", () => {
  describe("autonomous", () => {
    it("lets list_endpoints run; it has no target and touches nothing but a read", () => {
      expect(decide(listEndpoints, context, config)).toEqual({ outcome: "autonomous" });
    });

    it("lets get_endpoint run for any endpoint id", () => {
      expect(decide(getEndpoint(ENDPOINT), context, config)).toEqual({ outcome: "autonomous" });
    });
  });

  describe("approval", () => {
    it("gates reboot_endpoint; no allowlist of endpoints skips review", () => {
      expect(decide(rebootEndpoint(ENDPOINT), context, config)).toEqual({
        outcome: "approval",
        rules: [Rule.ApprovalRebootEndpoint],
      });
    });

    it.each(["ep-front-desk-01", "ep-warehouse-printer-02", "ep-anything-at-all"])(
      "gates reboot_endpoint the same way regardless of which endpoint: %s",
      (endpointId) => {
        expect(decide(rebootEndpoint(endpointId), context, config).outcome).toBe("approval");
      },
    );
  });

  describe("reset_password: never automated", () => {
    it("denies it outright, by its own named rule, not the generic unknown-tool or malformed-parameters rule", () => {
      expect(decide(resetPassword("alice@contoso.com"), context, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyPasswordResetNeverAutomated],
      });
    });

    it.each([
      "alice@contoso.com",
      "it.manager@contoso.com",
      "break.glass.emergency-access@contoso.com",
      "helpdesk.operator@contoso.com",
    ])("denies it for %s — there is no target user this rule treats differently", (userPrincipalName) => {
      expect(decide(resetPassword(userPrincipalName), context, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyPasswordResetNeverAutomated],
      });
    });

    it("denies it regardless of who is asking or what agent invoked it — the rule reads only the tool name", () => {
      const otherContext: RequestContext = { actor: "someone.else@contoso.com", agent: "a-different-agent", timestamp: context.timestamp };
      expect(decide(resetPassword("alice@contoso.com"), otherContext, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyPasswordResetNeverAutomated],
      });
    });

    it("never reaches the approval tier: reset_password cannot be turned into an approval-gated write by any config", () => {
      expect(decide(resetPassword("alice@contoso.com"), context, config).outcome).not.toBe("approval");
    });

    it("still denies as malformed-parameters, not password-reset, when the parameters are not even a UPN — malformed input is a structural check, never reaching the deny tier by name", () => {
      expect(decide({ tool: "reset_password", params: { userPrincipalName: "not-a-upn" } }, context, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyMalformedParameters],
      });
      expect(decide({ tool: "reset_password", params: {} }, context, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyMalformedParameters],
      });
    });
  });

  describe("structural denials", () => {
    it.each([
      ["a tool that does not exist", "delete_endpoint"],
      ["an empty tool name", ""],
      ["an Object.prototype key", "constructor"],
      ["a non-string tool name", 42 as unknown as string],
      // Identity gateway tool names are not this gateway's tools: disjoint by construction.
      ["an identity gateway tool name", "add_user_to_group"],
    ])("denies %s", (_label, tool) => {
      const request: ToolRequest = { tool, params: {} };
      expect(decide(request, context, config)).toEqual({ outcome: "denied", rules: [Rule.DenyUnknownTool] });
    });

    it.each<[string, ToolRequest]>([
      ["missing endpointId", { tool: "get_endpoint", params: {} }],
      ["non-string endpointId", { tool: "get_endpoint", params: { endpointId: 7 } }],
      ["an unexpected extra parameter", { tool: "list_endpoints", params: { extra: true } }],
      ["params that are null", { tool: "list_endpoints", params: null }],
      ["params that are undefined", { tool: "list_endpoints", params: undefined }],
      ["params that are an array", { tool: "list_endpoints", params: [ENDPOINT] }],
      ["params that are a string", { tool: "list_endpoints", params: ENDPOINT }],
    ])("denies %s instead of throwing", (_label, request) => {
      expect(() => decide(request, context, config)).not.toThrow();
      expect(decide(request, context, config)).toEqual({ outcome: "denied", rules: [Rule.DenyMalformedParameters] });
    });

    it("denies rather than throws when the request object itself is garbage", () => {
      const garbage = null as unknown as ToolRequest;
      expect(() => decide(garbage, context, config)).not.toThrow();
      expect(decide(garbage, context, config).outcome).toBe("denied");
    });

    it("treats a missing arguments object as the empty parameter set for list_endpoints", () => {
      expect(decide({ tool: "list_endpoints", params: undefined }, context, config).outcome).toBe("denied");
      // Empty object, not undefined, is what the handler passes through; decide() itself does
      // not substitute one for the other (that happens in tools/handler.ts, same as every gateway).
      expect(decide({ tool: "list_endpoints", params: {} }, context, config)).toEqual({ outcome: "autonomous" });
    });
  });

  describe("purity", () => {
    it("is deterministic for the same input", () => {
      expect(decide(getEndpoint(ENDPOINT), context, config)).toEqual(decide(getEndpoint(ENDPOINT), context, config));
    });

    it("does not mutate the request, context or config", () => {
      const request = Object.freeze(getEndpoint(ENDPOINT));
      const frozenContext = Object.freeze({ ...context });
      const frozenConfig = Object.freeze({ ...config });
      const before = JSON.stringify([request, frozenContext, frozenConfig]);

      decide(request, frozenContext, frozenConfig);

      expect(JSON.stringify([request, frozenContext, frozenConfig])).toBe(before);
    });

    it("never reads the clock or randomness; time arrives only through RequestContext", () => {
      class Trapped extends Error {}
      const trap = (what: string) => () => {
        throw new Trapped(`decide() touched ${what}`);
      };
      const RealDate = globalThis.Date;
      const trappedDate = new Proxy(RealDate, {
        construct: trap("new Date()"),
        apply: trap("Date()"),
        get: (target, prop, receiver) => (prop === "now" ? trap("Date.now()") : Reflect.get(target, prop, receiver)),
      });
      vi.stubGlobal("Date", trappedDate);
      const perf = vi.spyOn(performance, "now").mockImplementation(trap("performance.now()"));
      const rand = vi.spyOn(Math, "random").mockImplementation(trap("Math.random()"));

      let decisions: unknown[];
      try {
        decisions = [
          decide(listEndpoints, context, config),
          decide(getEndpoint(ENDPOINT), context, config),
          decide(resetPassword("alice@contoso.com"), context, config),
          decide({ tool: "get_endpoint", params: null }, context, config),
        ];
      } finally {
        vi.unstubAllGlobals();
        perf.mockRestore();
        rand.mockRestore();
      }

      expect(decisions).toEqual([
        { outcome: "autonomous" },
        { outcome: "autonomous" },
        { outcome: "denied", rules: [Rule.DenyPasswordResetNeverAutomated] },
        { outcome: "denied", rules: [Rule.DenyMalformedParameters] },
      ]);
    });

    it("has no clock or randomness call anywhere in the policy sources", async () => {
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
