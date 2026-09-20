import { DEFAULT_AGENT_MODEL, DEFAULT_TRIAGE_MODEL } from "@helpdesk/agent";
import { describe, expect, it } from "vitest";

import { PRICING_PER_MILLION_TOKENS, priceUsage } from "./pricing.js";

describe("PRICING_PER_MILLION_TOKENS", () => {
  it("has an entry for both of @helpdesk/agent's own pinned models, so a pinning change is caught here", () => {
    expect(PRICING_PER_MILLION_TOKENS[DEFAULT_TRIAGE_MODEL]).toBeDefined();
    expect(PRICING_PER_MILLION_TOKENS[DEFAULT_AGENT_MODEL]).toBeDefined();
  });
});

describe("priceUsage()", () => {
  it("prices a known model's tokens at its own input/output rates", () => {
    // claude-opus-5: $5/MTok in, $25/MTok out.
    expect(priceUsage("claude-opus-5", 1_000_000, 1_000_000)).toBeCloseTo(30, 6);
    expect(priceUsage("claude-opus-5", 500_000, 0)).toBeCloseTo(2.5, 6);
  });

  it("returns exactly 0 for zero tokens on a known model, not null", () => {
    expect(priceUsage(DEFAULT_TRIAGE_MODEL, 0, 0)).toBe(0);
  });

  it("returns null for a model with no price on file, rather than pricing it at 0", () => {
    expect(priceUsage("some-future-model", 1_000_000, 1_000_000)).toBeNull();
  });
});
