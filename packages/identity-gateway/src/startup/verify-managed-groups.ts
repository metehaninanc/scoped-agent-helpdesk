/**
 * Startup-only check that the managed group allowlist in policy/config.ts still describes the
 * tenant: every id exists, and the display name kept next to it for readability still matches.
 *
 * This is I/O, so it lives here and not in the policy module. It runs once when the gateway
 * starts and never inside decide(). Its findings are warnings: the allowlist stays exactly as
 * committed, because a deleted or renamed group must be fixed in a reviewable commit, not
 * papered over at runtime.
 */
import type { GroupSummary } from "../graph/client.js";
import type { ManagedGroup } from "../policy/types.js";

/** The one Graph call this check needs. GraphClient satisfies it. */
export interface GroupLookup {
  getGroup(groupId: string): Promise<GroupSummary | null>;
}

export type ManagedGroupFinding =
  | { group: ManagedGroup; problem: "missing" }
  | { group: ManagedGroup; problem: "renamed"; actualDisplayName: string }
  | { group: ManagedGroup; problem: "unreachable"; detail: string };

export async function verifyManagedGroups(
  graph: GroupLookup,
  groups: readonly ManagedGroup[],
): Promise<ManagedGroupFinding[]> {
  const findings: ManagedGroupFinding[] = [];
  for (const group of groups) {
    try {
      const actual = await graph.getGroup(group.id);
      if (actual === null) {
        findings.push({ group, problem: "missing" });
      } else if (actual.displayName !== group.displayName) {
        findings.push({ group, problem: "renamed", actualDisplayName: actual.displayName });
      }
    } catch (error) {
      findings.push({ group, problem: "unreachable", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return findings;
}

export function formatFinding(finding: ManagedGroupFinding): string {
  const who = `managed group "${finding.group.displayName}" (${finding.group.id})`;
  switch (finding.problem) {
    case "missing":
      return `${who} does not exist in the tenant; add_user_to_group to it will fail at Graph`;
    case "renamed":
      return `${who} is now named "${finding.actualDisplayName}" in the tenant; update config.ts`;
    case "unreachable":
      return `${who} could not be checked: ${finding.detail}`;
  }
}
