import { describe, expect, it, vi } from "vitest";

import type { ApprovalRecord } from "@helpdesk/gateway-core";
import { GraphError, type AddMemberResult } from "../graph/client.js";
import { createApprovalExecute } from "./execute.js";

const MARKETING = "20a26e53-1cbd-48e3-8cc4-8d86cece7a6a";
const ALICE = "alice@contoso.com";

const approval = (overrides: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  id: "a1",
  createdAt: "2026-09-19T00:00:00.000Z",
  requestId: "req-1",
  actor: "helpdesk.operator@contoso.com",
  tool: "add_user_to_group",
  params: { userPrincipalName: ALICE, groupId: MARKETING },
  rules: ["approval.add_user_to_group"],
  rationale: null,
  status: "approved",
  decidedBy: "it.manager@contoso.com",
  decidedAt: "2026-09-19T00:01:00.000Z",
  decisionNote: "ok",
  ...overrides,
});

describe("createApprovalExecute()", () => {
  it("dispatches add_user_to_group and reports the alreadyMember flag Graph returned", async () => {
    const addUserToGroup = vi.fn<(upn: string, groupId: string) => Promise<AddMemberResult>>(async () => ({ alreadyMember: false }));
    const removeUserFromGroup = vi.fn<(upn: string, groupId: string) => Promise<void>>(async () => undefined);
    const execute = createApprovalExecute({ addUserToGroup, removeUserFromGroup });

    const result = await execute(approval());

    expect(addUserToGroup).toHaveBeenCalledWith(ALICE, MARKETING);
    expect(removeUserFromGroup).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "executed", alreadyMember: false });
  });

  it("dispatches remove_user_from_group and reports executed with no alreadyMember field", async () => {
    const addUserToGroup = vi.fn<(upn: string, groupId: string) => Promise<AddMemberResult>>(async () => ({ alreadyMember: false }));
    const removeUserFromGroup = vi.fn<(upn: string, groupId: string) => Promise<void>>(async () => undefined);
    const execute = createApprovalExecute({ addUserToGroup, removeUserFromGroup });

    const result = await execute(approval({ tool: "remove_user_from_group" }));

    expect(removeUserFromGroup).toHaveBeenCalledWith(ALICE, MARKETING);
    expect(addUserToGroup).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "executed" });
  });

  it("lets a Graph failure propagate rather than catching it here — the workflow's describeError does that", async () => {
    const addUserToGroup = vi.fn<(upn: string, groupId: string) => Promise<AddMemberResult>>(async () => {
      throw new GraphError(404, "Request_ResourceNotFound", "Resource does not exist.", "req-x");
    });
    const removeUserFromGroup = vi.fn<(upn: string, groupId: string) => Promise<void>>(async () => undefined);
    const execute = createApprovalExecute({ addUserToGroup, removeUserFromGroup });

    await expect(execute(approval())).rejects.toBeInstanceOf(GraphError);
  });

  it("returns an unsupported_tool error for an approval naming any other tool, without calling Graph", async () => {
    const addUserToGroup = vi.fn<(upn: string, groupId: string) => Promise<AddMemberResult>>(async () => ({ alreadyMember: false }));
    const removeUserFromGroup = vi.fn<(upn: string, groupId: string) => Promise<void>>(async () => undefined);
    const execute = createApprovalExecute({ addUserToGroup, removeUserFromGroup });

    const result = await execute(approval({ tool: "reboot_endpoint" }));

    expect(result).toMatchObject({ status: "error", code: "unsupported_tool" });
    expect(addUserToGroup).not.toHaveBeenCalled();
    expect(removeUserFromGroup).not.toHaveBeenCalled();
  });

  it("returns an unsupported_tool error for malformed params, without calling Graph", async () => {
    const addUserToGroup = vi.fn<(upn: string, groupId: string) => Promise<AddMemberResult>>(async () => ({ alreadyMember: false }));
    const removeUserFromGroup = vi.fn<(upn: string, groupId: string) => Promise<void>>(async () => undefined);
    const execute = createApprovalExecute({ addUserToGroup, removeUserFromGroup });

    const result = await execute(approval({ params: { userPrincipalName: ALICE } }));

    expect(result).toMatchObject({ status: "error", code: "unsupported_tool" });
    expect(addUserToGroup).not.toHaveBeenCalled();
  });
});
