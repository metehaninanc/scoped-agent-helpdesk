import { describe, expect, it } from "vitest";

import { triageStopReason } from "./simulation-stop.js";

const CREDIT = 'Triage request failed (400): 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}';

describe("triageStopReason()", () => {
  it("stops a run on the billing refusal routeRequest() swallowed into a triage_failed result", () => {
    expect(triageStopReason({ status: "triage_failed", cause: CREDIT })).toBe("an exhausted API credit balance");
  });

  it("stops a run on an authentication failure on the classification call", () => {
    expect(triageStopReason({ status: "triage_failed", cause: "Triage request failed (401): invalid x-api-key" })).toBe("an authentication failure");
  });

  it("records an ordinary classification failure as data, as before", () => {
    expect(triageStopReason({ status: "triage_failed", cause: "Triage not completed: stop_reason=max_tokens" })).toBeNull();
    expect(triageStopReason({ status: "triage_failed", cause: "Triage request failed: fetch failed" })).toBeNull();
  });

  it("never reads the cause of a result that is not a triage failure", () => {
    expect(triageStopReason({ status: "routed", cause: CREDIT })).toBeNull();
    expect(triageStopReason({ status: "needs_human" })).toBeNull();
  });
});
