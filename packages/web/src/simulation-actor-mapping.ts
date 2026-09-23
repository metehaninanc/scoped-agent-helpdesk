/**
 * Deterministic actor mapping for the simulation runner (bin/simulate.ts). The ticket files'
 * `submittedBy` addresses are synthetic — invented for the test data, not real tenant users — so
 * a request like "add me to marketing" can never resolve against Microsoft Graph the way it would
 * for an actual employee. Every distinct synthetic address maps, round robin, to one of this
 * project's own real test users (REAL_TEST_USERS below); the mapped UPN is what actually travels
 * as the actor on every simulated request, the same way it does for a real one.
 *
 * The mapping is written once to a committed file rather than recomputed silently on every
 * invocation, because a mapping that could change between runs would make "which real UPN asked
 * this" unreproducible — exactly the property a simulation's own audit trail needs. A resumed run
 * reuses the same file, so a ticket's actor never changes between the run that first submitted it
 * and any later run that only picks up the remainder.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * This project's own real test users in the disposable Entra tenant this project is built
 * against. Confirmed by querying the real directory directly (`GET /v1.0/users`) rather than
 * assumed from README.md's prior narrative, which turned out not to be reliable here: the
 * directory holds exactly 9 users, and `it.manager@...` — used as the approver identity in
 * earlier live runs — is not one of them (an actor/approver UPN is never Graph-validated, only
 * format-checked, so nothing before this check would have caught that).
 *
 * Excluded deliberately: the two break-glass accounts (`packages/identity-gateway/src/policy/
 * config.ts`) — they exist specifically to be denied by name and must never be an ordinary actor;
 * the tenant admin's own guest account; and the three "Training User" accounts, which belong to
 * unrelated work. `helpdesk.operator@...` is kept even though it, too, is absent from the
 * directory — same reasoning as `it.manager` structurally, but kept here on explicit instruction
 * rather than excluded, since only `it.manager` was conditioned on the directory check.
 */
export const REAL_TEST_USERS = [
  "alexdesouza@metehantestoutlook.onmicrosoft.com",
  "didierdrogba@metehantestoutlook.onmicrosoft.com",
  "marcoasensio@metehantestoutlook.onmicrosoft.com",
  "helpdesk.operator@metehantestoutlook.onmicrosoft.com",
] as const;

export type ActorMapping = Readonly<Record<string, string>>;

/** Sorted first, so the mapping does not depend on the order tickets happen to be read in. */
export function buildActorMapping(distinctSyntheticAddresses: readonly string[], realUsers: readonly string[] = REAL_TEST_USERS): ActorMapping {
  if (realUsers.length === 0) throw new Error("at least one real test user is required to build an actor mapping");
  const sorted = [...new Set(distinctSyntheticAddresses)].sort();
  const mapping: Record<string, string> = {};
  sorted.forEach((address, index) => {
    mapping[address] = realUsers[index % realUsers.length]!;
  });
  return mapping;
}

/**
 * Loads the committed mapping at `path` if it exists, else builds and writes one. Refuses to
 * silently extend or shrink an existing file: if the current ticket files' distinct addresses no
 * longer match exactly what the committed mapping covers, that is a sign the ticket data changed
 * since the mapping was committed, and continuing anyway would risk a resumed run submitting under
 * a mapping the earlier, already-recorded results were not.
 */
export function loadOrBuildActorMapping(
  path: string,
  distinctSyntheticAddresses: readonly string[],
  realUsers: readonly string[] = REAL_TEST_USERS,
): ActorMapping {
  const distinctSorted = [...new Set(distinctSyntheticAddresses)].sort();

  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, "utf8")) as ActorMapping;
    const existingKeys = Object.keys(existing).sort();
    if (JSON.stringify(existingKeys) !== JSON.stringify(distinctSorted)) {
      throw new Error(
        `${path} does not cover exactly the current ticket files' submittedBy addresses. ` +
          `Regenerate it deliberately (delete the file and rerun) rather than risk a resumed run ` +
          `submitting under a different mapping than its earlier, already-recorded results used.`,
      );
    }
    return existing;
  }

  const mapping = buildActorMapping(distinctSorted, realUsers);
  writeFileSync(path, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");
  return mapping;
}
