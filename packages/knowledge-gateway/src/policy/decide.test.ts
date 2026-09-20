import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { decide } from "./decide.js";
import { Rule, type PolicyConfig, type RequestContext, type ToolRequest } from "./types.js";

const config: PolicyConfig = {};

const context: RequestContext = {
  actor: "helpdesk.operator@contoso.com",
  agent: "knowledge-agent",
  timestamp: "2026-09-17T12:00:00.000Z",
};

const search = (query: string): ToolRequest => ({ tool: "search_documentation", params: { query } });

describe("decide()", () => {
  describe("autonomous", () => {
    it("lets search_documentation run for any query; it has no target and touches nothing but a local index", () => {
      expect(decide(search("how do groups work"), context, config)).toEqual({ outcome: "autonomous" });
    });

    it("denies search_documentation if it is handed parameters it does not take", () => {
      expect(decide({ tool: "search_documentation", params: { query: "x", extra: true } }, context, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyMalformedParameters],
      });
    });
  });

  describe("no write tools and no approval path exist", () => {
    it("has no approval outcome reachable: nothing in the ladder ever returns one", () => {
      expect(decide(search("groups"), context, config).outcome).not.toBe("approval");
    });
  });

  describe("structural denials", () => {
    it.each([
      ["a tool that does not exist", "delete_documentation"],
      ["an empty tool name", ""],
      ["an Object.prototype key", "constructor"],
      ["a non-string tool name", 42 as unknown as string],
      // Other gateways' tool names are not this gateway's tools: disjoint by construction.
      ["an identity gateway tool name", "add_user_to_group"],
      ["an mdm gateway tool name", "list_devices"],
    ])("denies %s", (_label, tool) => {
      const request: ToolRequest = { tool, params: {} };
      expect(decide(request, context, config)).toEqual({ outcome: "denied", rules: [Rule.DenyUnknownTool] });
    });

    it.each<[string, ToolRequest]>([
      ["missing query", { tool: "search_documentation", params: {} }],
      ["empty query", search("")],
      ["query over the length limit", search("x".repeat(301))],
      ["non-string query", { tool: "search_documentation", params: { query: 7 } }],
      ["params that are null", { tool: "search_documentation", params: null }],
      ["params that are undefined", { tool: "search_documentation", params: undefined }],
      ["params that are an array", { tool: "search_documentation", params: ["x"] }],
      ["params that are a string", { tool: "search_documentation", params: "x" }],
    ])("denies %s instead of throwing", (_label, request) => {
      expect(() => decide(request, context, config)).not.toThrow();
      expect(decide(request, context, config)).toEqual({ outcome: "denied", rules: [Rule.DenyMalformedParameters] });
    });

    it("denies rather than throws when the request object itself is garbage", () => {
      const garbage = null as unknown as ToolRequest;
      expect(() => decide(garbage, context, config)).not.toThrow();
      expect(decide(garbage, context, config).outcome).toBe("denied");
    });
  });

  describe("purity", () => {
    it("is deterministic for the same input", () => {
      expect(decide(search("groups"), context, config)).toEqual(decide(search("groups"), context, config));
    });

    it("does not mutate the request, context or config", () => {
      const request = Object.freeze(search("groups"));
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
        decisions = [decide(search("groups"), context, config), decide({ tool: "search_documentation", params: null }, context, config)];
      } finally {
        vi.unstubAllGlobals();
        perf.mockRestore();
        rand.mockRestore();
      }

      expect(decisions).toEqual([{ outcome: "autonomous" }, { outcome: "denied", rules: [Rule.DenyMalformedParameters] }]);
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
