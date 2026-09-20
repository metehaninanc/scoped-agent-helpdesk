import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { decide } from "./decide.js";
import { Rule, type PolicyConfig, type RequestContext, type ToolRequest } from "./types.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const config: PolicyConfig = {};

const context: RequestContext = {
  actor: "helpdesk.operator@contoso.com",
  agent: "mdm-agent",
  timestamp: "2026-09-17T12:00:00.000Z",
};

const listDevices: ToolRequest = { tool: "list_devices", params: {} };
const getDevice = (deviceId: string): ToolRequest => ({ tool: "get_device", params: { deviceId } });

describe("decide()", () => {
  describe("autonomous", () => {
    it("lets list_devices run; it has no target and touches nothing but reads", () => {
      expect(decide(listDevices, context, config)).toEqual({ outcome: "autonomous" });
    });

    it("lets get_device run for any device id", () => {
      expect(decide(getDevice(DEVICE), context, config)).toEqual({ outcome: "autonomous" });
    });

    it("denies list_devices if it is handed parameters it does not take", () => {
      expect(decide({ tool: "list_devices", params: { deviceId: DEVICE } }, context, config)).toEqual({
        outcome: "denied",
        rules: [Rule.DenyMalformedParameters],
      });
    });
  });

  describe("no write tools exist", () => {
    it("has no approval outcome reachable: nothing in the ladder ever returns one", () => {
      // Both tools are reads; SPRINT2.md, Component 1 adds no write tool to this gateway.
      expect(decide(listDevices, context, config).outcome).not.toBe("approval");
      expect(decide(getDevice(DEVICE), context, config).outcome).not.toBe("approval");
    });
  });

  describe("structural denials", () => {
    it.each([
      ["a tool that does not exist", "remove_device"],
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
      ["missing deviceId", { tool: "get_device", params: {} }],
      ["deviceId that is not a GUID", getDevice("alice-laptop")],
      ["non-string deviceId", { tool: "get_device", params: { deviceId: 7 } }],
      ["an unexpected extra parameter", { tool: "list_devices", params: { extra: true } }],
      ["params that are null", { tool: "list_devices", params: null }],
      ["params that are undefined", { tool: "list_devices", params: undefined }],
      ["params that are an array", { tool: "list_devices", params: [DEVICE] }],
      ["params that are a string", { tool: "list_devices", params: DEVICE }],
    ])("denies %s instead of throwing", (_label, request) => {
      expect(() => decide(request, context, config)).not.toThrow();
      expect(decide(request, context, config)).toEqual({ outcome: "denied", rules: [Rule.DenyMalformedParameters] });
    });

    it("denies rather than throws when the request object itself is garbage", () => {
      const garbage = null as unknown as ToolRequest;
      expect(() => decide(garbage, context, config)).not.toThrow();
      expect(decide(garbage, context, config).outcome).toBe("denied");
    });

    it("treats a missing arguments object as the empty parameter set for list_devices", () => {
      expect(decide({ tool: "list_devices", params: undefined }, context, config).outcome).toBe("denied");
      // Empty object, not undefined, is what the handler passes through; decide() itself does
      // not substitute one for the other (that happens in tools/handler.ts, same as identity).
      expect(decide({ tool: "list_devices", params: {} }, context, config)).toEqual({ outcome: "autonomous" });
    });
  });

  describe("purity", () => {
    it("is deterministic for the same input", () => {
      expect(decide(getDevice(DEVICE), context, config)).toEqual(decide(getDevice(DEVICE), context, config));
    });

    it("does not mutate the request, context or config", () => {
      const request = Object.freeze(getDevice(DEVICE));
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
          decide(listDevices, context, config),
          decide(getDevice(DEVICE), context, config),
          decide({ tool: "get_device", params: null }, context, config),
        ];
      } finally {
        vi.unstubAllGlobals();
        perf.mockRestore();
        rand.mockRestore();
      }

      expect(decisions).toEqual([
        { outcome: "autonomous" },
        { outcome: "autonomous" },
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
