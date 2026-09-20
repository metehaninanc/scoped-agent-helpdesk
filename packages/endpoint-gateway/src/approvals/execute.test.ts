import { describe, expect, it, vi } from "vitest";

import type { ApprovalRecord } from "@helpdesk/gateway-core";
import type { EndpointService, EndpointSummary } from "../stub/endpoint-service.js";
import { createApprovalExecute } from "./execute.js";

const approval = (overrides: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  id: "a1",
  createdAt: "2026-09-19T00:00:00.000Z",
  requestId: "req-1",
  actor: "helpdesk.operator@contoso.com",
  tool: "reboot_endpoint",
  params: { endpointId: "ep-front-desk-01" },
  rules: ["approval.reboot_endpoint"],
  rationale: null,
  status: "approved",
  decidedBy: "it.manager@contoso.com",
  decidedAt: "2026-09-19T00:01:00.000Z",
  decisionNote: "ok",
  ...overrides,
});

describe("createApprovalExecute()", () => {
  it("reboots the named endpoint and reports executed", async () => {
    const rebooted: EndpointSummary = { id: "ep-front-desk-01", hostname: "front-desk-01", status: "rebooting", lastCheckInAt: "2026-09-19T00:01:00.000Z" };
    const rebootEndpoint = vi.fn<EndpointService["rebootEndpoint"]>(async () => rebooted);
    const execute = createApprovalExecute({ listEndpoints: vi.fn(), getEndpoint: vi.fn(), rebootEndpoint });

    const result = await execute(approval());

    expect(rebootEndpoint).toHaveBeenCalledWith("ep-front-desk-01");
    expect(result).toEqual({ status: "executed" });
  });

  it("returns an unsupported_tool error for an approval naming any other tool, without touching the stub", async () => {
    const rebootEndpoint = vi.fn<EndpointService["rebootEndpoint"]>();
    const execute = createApprovalExecute({ listEndpoints: vi.fn(), getEndpoint: vi.fn(), rebootEndpoint });

    const result = await execute(approval({ tool: "reset_password" }));

    expect(result).toMatchObject({ status: "error", code: "unsupported_tool" });
    expect(rebootEndpoint).not.toHaveBeenCalled();
  });

  it("returns an unsupported_tool error for malformed params, without touching the stub", async () => {
    const rebootEndpoint = vi.fn<EndpointService["rebootEndpoint"]>();
    const execute = createApprovalExecute({ listEndpoints: vi.fn(), getEndpoint: vi.fn(), rebootEndpoint });

    const result = await execute(approval({ params: {} }));

    expect(result).toMatchObject({ status: "error", code: "unsupported_tool" });
    expect(rebootEndpoint).not.toHaveBeenCalled();
  });

  it("lets a stub failure propagate rather than catching it here — the workflow's describeError does that", async () => {
    const rebootEndpoint = vi.fn<EndpointService["rebootEndpoint"]>(async () => {
      throw new Error("endpoint ep-front-desk-01 not found");
    });
    const execute = createApprovalExecute({ listEndpoints: vi.fn(), getEndpoint: vi.fn(), rebootEndpoint });

    await expect(execute(approval())).rejects.toThrow("endpoint ep-front-desk-01 not found");
  });
});
