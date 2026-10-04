import { describe, expect, it } from "vitest";

import { runStoppingReason } from "./sdk-usage-errors.js";

describe("runStoppingReason()", () => {
  it("recognizes the exact message SPRINT4.md, section 6's own live run hit", () => {
    expect(runStoppingReason("Claude Code returned an error result: You've hit your session limit · resets 5pm (Europe/Berlin)")).toMatch(
      /usage or policy limit/,
    );
  });

  it("recognizes every usage-limit prefix the SDK itself exports, not just the one observed", () => {
    expect(runStoppingReason("You've reached your usage limit for today")).toMatch(/usage or policy limit/);
    expect(runStoppingReason("You're out of usage credits")).toMatch(/usage or policy limit/);
  });

  it("recognizes an org policy limit", () => {
    expect(runStoppingReason("This service is disabled for your org")).toMatch(/usage or policy limit/);
  });

  it("recognizes an authentication failure by wording, labelled as a heuristic in its own name", () => {
    expect(runStoppingReason("authentication_error: invalid x-api-key")).toBe("an authentication failure");
    expect(runStoppingReason("Request failed with status 401 Unauthorized")).toBe("an authentication failure");
  });

  it("recognizes the Messages API's own exhausted-credit refusal, wrapped the way TriageError wraps it", () => {
    const raw = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';
    expect(runStoppingReason(raw)).toBe("an exhausted API credit balance");
    expect(runStoppingReason(`Triage request failed (400): ${raw}`)).toBe("an exhausted API credit balance");
  });

  it("stops a run when the agents authenticated by a path HELPDESK_AGENT_AUTH forbids", () => {
    expect(runStoppingReason('Agent auth path mismatch: HELPDESK_AGENT_AUTH=session requires … it reported "ANTHROPIC_API_KEY"')).toMatch(/HELPDESK_AGENT_AUTH/);
  });

  it("returns null for an ordinary error — a network blip, a real system refusal — so the caller keeps recording and moving on", () => {
    expect(runStoppingReason("ECONNREFUSED: connection refused")).toBeNull();
    expect(runStoppingReason("Rationale request failed (429): rate limited")).toBeNull();
    expect(runStoppingReason("fetch failed")).toBeNull();
  });
});
