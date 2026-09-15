# scoped-agent-helpdesk

An identity helpdesk where an AI agent can *ask* for changes but never *make* them without
policy and, where required, a human. The build contract is [SPRINT1.md](SPRINT1.md).

## Layout

```
packages/gateway   MCP server, policy engine, Graph client, audit log (the only package with credentials)
packages/agent     Agent SDK wrapper, one file per agent                  (not started)
packages/web       request form, approval screen                           (not started)
data/              SQLite, gitignored
```

## Prerequisites

- **Node 22.13 or newer.** The audit log uses the built-in `node:sqlite` module, which was
  unflagged in Node 22.13.0 ([nodejs/node#55890](https://github.com/nodejs/node/pull/55890)).
  No flag is needed from 22.13 on. On 22.5 to 22.12 it exists only behind
  `--experimental-sqlite`; before 22.5 it does not exist. `openDatabase()` checks this at
  startup and fails with a clear message rather than a cryptic import error.
  - It still prints `ExperimentalWarning: SQLite is an experimental feature` on 22.x. Run
    with `--no-warnings=ExperimentalWarning` (the scripts here do) or accept the noise.
  - The API is marked Stability 1.1 (active development), so pin the Node major on the VPS
    and re-run the tests after a Node upgrade. Nothing here is native code; there is no
    build step and no `build-essential` requirement on Linux.
  - Distro packages are often older than 22.13. On a Linux VPS use the NodeSource 22.x repo,
    `nvm`, or the official tarball, and check with `node -p "process.versions.node"`.
- pnpm 12 (`npm install -g pnpm`; corepack cannot write to Program Files on this machine)

```
pnpm install
pnpm test
pnpm typecheck
```

## Status

| Component            | State                                             |
| -------------------- | ------------------------------------------------- |
| 1. Policy engine     | done, tests first: `packages/gateway/src/policy`  |
| 2. Gateway           | not started                                       |
| 3. Audit log         | done, tests first: `packages/gateway/src/audit`   |
| 4. Approval store    | not started                                       |
| 5. Identity agent    | not started                                       |
| 6. Web               | not started                                       |

### Policy engine notes

- `decide(request, context, config?)` is pure and never throws. Anything it cannot evaluate is
  denied and named (`deny.unknown_tool`, `deny.malformed_parameters`, `deny.policy_error`).
- "First match wins" is applied per tier (deny > approval > autonomous > default deny). The
  Decision lists every rule in the winning tier that fired, so the audit log gets the whole
  reason rather than the first one.
- Break glass applies to reads as well as writes: `list_user_groups` on a break glass account
  is denied.
- `config.ts` still holds placeholder break glass UPNs and an empty managed group list. Until
  the Azure setup in SPRINT1.md is done and those are filled in, every `add_user_to_group` is
  denied by `deny.group_not_managed`, which is the correct default. The config is
  shape-checked when the module loads: a break glass entry that is not a UPN, or a group entry
  that is not a GUID, throws at startup rather than silently denying everything.
- **The directory role id list is a labelling aid, not a security boundary.** The managed
  group allowlist is what actually stops the call: anything not on it is denied, full stop. The
  role table in `directory-roles.ts` exists so that a request targeting a known role is denied
  under the specific name `deny.directory_role_target` instead of the generic
  `deny.group_not_managed`. An unlisted role id is still denied, just with the less specific
  rule name. Reconcile the table against `GET /directoryRoleTemplates` once the tenant exists;
  nothing about safety depends on it being complete.
- `decide()` never reads the clock or any source of randomness. Time arrives only through
  `RequestContext.timestamp`. The purity tests enforce this both at runtime (a trapped `Date`)
  and statically (a grep of the policy sources).

### Audit log notes

- `node:sqlite` (built into Node 22, no native build step). `openDatabase()` in
  `packages/gateway/src/db.ts` is the one connection opener; approvals will share the file.
- `AuditLog.append()` is synchronous and transactional. When it returns, the record is
  committed. The gateway's "audit first, then act" ordering depends on that.
- Append only is enforced twice: `BEFORE UPDATE` / `BEFORE DELETE` triggers stop an honest bug,
  and the sha256 hash chain catches anyone who drops the triggers. Each hash covers every
  stored column including the id and the previous hash, computed over the exact JSON strings
  on disk so verification never depends on serialisation order.
- `verifyChain()` returns the first broken record (`{ index, id, reason }`) or `null`. It
  detects any modification and any deletion in the body of the chain. Because ids come from
  `AUTOINCREMENT`, a deleted tail becomes visible as an `id_gap` the moment anything is
  appended after it.
- **Tail truncation and the head marker.** The chain alone cannot see a deleted tail with
  nothing after it, or a tail rewritten with its hash recomputed, because no successor points
  at it. So the log keeps a head marker (`audit_head`: last id and last hash) in a separate
  table, updated in the same transaction as every append, and `verifyChain()` reports
  `tail_truncated` when the chain tail and the marker disagree, including when the marker
  itself has been removed. **This raises the bar rather than closing the gap.** An attacker
  with write access to the database file can rewrite the marker along with the tail, and
  then nothing inside the file can tell. The real fix is external anchoring (periodically
  publishing the head hash somewhere the attacker cannot reach), and that is out of scope for
  Sprint 1.
- Demo: `pnpm verify-audit [path]` prints the log and the verdict, exit code 1 on a break.

## Sprint 2 items noted during Sprint 1

_(none yet)_
