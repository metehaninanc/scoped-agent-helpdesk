import { describe, expect, it, vi } from "vitest";

import type { ManagedGroup } from "../policy/types.js";
import { formatFinding, verifyManagedGroups, type GroupLookup } from "./verify-managed-groups.js";

const MARKETING: ManagedGroup = { id: "20a26e53-1cbd-48e3-8cc4-8d86cece7a6a", displayName: "Marketing" };
const FINANCE: ManagedGroup = { id: "88981a1a-1f6b-438c-9475-26b7c619dce0", displayName: "Finance" };

function lookup(answers: Record<string, { id: string; displayName: string } | null | Error>): GroupLookup {
  return {
    getGroup: vi.fn(async (id: string) => {
      const answer = answers[id];
      if (answer instanceof Error) throw answer;
      return answer ?? null;
    }),
  };
}

describe("verifyManagedGroups()", () => {
  it("returns no findings when every group exists with the configured name", async () => {
    const graph = lookup({ [MARKETING.id]: MARKETING, [FINANCE.id]: FINANCE });
    expect(await verifyManagedGroups(graph, [MARKETING, FINANCE])).toEqual([]);
  });

  it("reports a group that no longer exists", async () => {
    const graph = lookup({ [MARKETING.id]: MARKETING, [FINANCE.id]: null });
    expect(await verifyManagedGroups(graph, [MARKETING, FINANCE])).toEqual([
      { group: FINANCE, problem: "missing" },
    ]);
  });

  it("reports a group whose display name has changed, with the current name", async () => {
    const graph = lookup({
      [MARKETING.id]: { id: MARKETING.id, displayName: "Marketing (EMEA)" },
      [FINANCE.id]: FINANCE,
    });
    expect(await verifyManagedGroups(graph, [MARKETING, FINANCE])).toEqual([
      { group: MARKETING, problem: "renamed", actualDisplayName: "Marketing (EMEA)" },
    ]);
  });

  it("treats display name comparison as exact; case matters in a reviewable file", async () => {
    const graph = lookup({ [MARKETING.id]: { id: MARKETING.id, displayName: "marketing" } });
    expect(await verifyManagedGroups(graph, [MARKETING])).toEqual([
      { group: MARKETING, problem: "renamed", actualDisplayName: "marketing" },
    ]);
  });

  it("reports a lookup failure as unreachable rather than throwing, so startup continues", async () => {
    const graph = lookup({ [MARKETING.id]: new Error("Graph 503 unknown: service unavailable"), [FINANCE.id]: FINANCE });
    expect(await verifyManagedGroups(graph, [MARKETING, FINANCE])).toEqual([
      { group: MARKETING, problem: "unreachable", detail: "Graph 503 unknown: service unavailable" },
    ]);
  });

  it("checks every group, in order, exactly once", async () => {
    const graph = lookup({ [MARKETING.id]: MARKETING, [FINANCE.id]: FINANCE });
    await verifyManagedGroups(graph, [MARKETING, FINANCE]);
    expect(graph.getGroup).toHaveBeenCalledTimes(2);
    expect(vi.mocked(graph.getGroup).mock.calls.map((c) => c[0])).toEqual([MARKETING.id, FINANCE.id]);
  });

  it("does nothing for an empty allowlist", async () => {
    const graph = lookup({});
    expect(await verifyManagedGroups(graph, [])).toEqual([]);
    expect(graph.getGroup).not.toHaveBeenCalled();
  });
});

describe("formatFinding()", () => {
  it("names the group, the id and the problem in one line", () => {
    expect(formatFinding({ group: FINANCE, problem: "missing" })).toBe(
      `managed group "Finance" (${FINANCE.id}) does not exist in the tenant; add_user_to_group to it will fail at Graph`,
    );
    expect(formatFinding({ group: MARKETING, problem: "renamed", actualDisplayName: "Marketing (EMEA)" })).toBe(
      `managed group "Marketing" (${MARKETING.id}) is now named "Marketing (EMEA)" in the tenant; update config.ts`,
    );
    expect(formatFinding({ group: MARKETING, problem: "unreachable", detail: "boom" })).toBe(
      `managed group "Marketing" (${MARKETING.id}) could not be checked: boom`,
    );
  });
});
