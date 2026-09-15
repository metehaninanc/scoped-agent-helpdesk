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
| 2. Gateway           | done, tests first: `packages/gateway/src/tools`   |
| 3. Audit log         | done, tests first: `packages/gateway/src/audit`   |
| 4. Approval store    | create/read done; rationale + decision flow next  |
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
- **Policy config lives in `config.ts`, in version control, and nowhere else.** The break
  glass list and the managed group allowlist are security policy, not environment
  configuration. In git, a change to either is reviewable and attributable: who widened the
  allowlist, when, and in which commit. In `.env` it would leave no trace, which is the wrong
  property for a control this project is built to defend. There is no environment override.
  - The config is shape-checked when the module loads: a break glass entry that is not a
    UPN, or a group entry that is not a GUID, throws at startup rather than silently denying
    everything.
  - Display names sit next to ids so the file reads well in review. The engine ignores them.
    At startup the gateway checks each configured group against Graph once
    (`startup/verify-managed-groups.ts`) and logs a warning if a group has been deleted or
    renamed. The allowlist is not changed by that check; fix it in a commit. The check never
    runs inside `decide()`.
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

### Graph client notes

- `packages/gateway/src/graph/certificate-credential.ts` is the client-credentials flow with a
  certificate (`private_key_jwt`), hand-rolled on `node:crypto` and `fetch`. No auth library:
  this is the only package that holds credentials and the flow is short enough to read in
  full. `getToken(scope)` returns `{ token, expiresAt }`, the same shape as `TokenCredential`,
  so `@azure/identity` could replace it in one line if that ever becomes worth the tree.
- `.env` (gitignored, repo root; see `.env.example`) needs `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
  `AZURE_CERT_THUMBPRINT` (SHA-1, hex) and `AZURE_CERT_PATH` (the PEM private key, outside the
  repo). Real environment variables override the file. `packages/gateway/src/env.ts` is the
  only reader of the certificate path.
- `pnpm graph-smoke` proves the credential with one read call, prints the `roles` claim (so
  you can see exactly which application permissions the token carries), and then runs the
  real client's `listUserGroups` on the first user. No writes.
- `GraphClient` exposes exactly two operations: `listUserGroups` (`memberOf` cast to
  `microsoft.graph.group`, so directory roles and administrative units are excluded, with
  paging) and `addUserToGroup` (resolves the user's object id, then `POST /members/$ref`;
  "already a member" is reported as success with `alreadyMember: true`). Inputs are
  re-validated with the policy engine's own schemas before they touch a URL.
- No retry on 429/503 yet. The dev tenant does not throttle at this volume; add Retry-After
  handling when the gateway is under real load.

### Gateway notes

- `packages/gateway/src/tools/descriptions.ts` is the whole prompt surface: tool names,
  descriptions and parameter descriptions, in one file. `descriptions.test.ts` pins the
  load-bearing phrases (pending is success, stop and report, do not route around a denial), so
  a rewrite has to touch the test in the same commit. The `add_user_to_group` description
  lists the managed groups by name and id, generated from `config.ts`.
- `tools/handler.ts` is the call order from SPRINT1.md: validate, `decide()`, commit the audit
  record, then branch. The tests prove the ordering by having the fake Graph inspect the audit
  log at the moment it is called. Malformed input and unknown tools are audited as denials with
  the raw input as evidence, not rejected at the protocol layer.
- Built on the SDK's low-level `Server`, not `McpServer.registerTool`, because the latter
  validates arguments before the handler runs and a rejected call would never be audited.
- Every result is `{ status: ... }`. `denied` and `pending_approval` are normal results, not
  errors; only a Graph or gateway failure sets `isError`.
- One gateway process per agent session, identity bound at spawn:
  `node packages/gateway/dist/bin/gateway.js --actor <upn> --request-id <id> [--agent <name>] [--db <path>]`.
  stdout is the MCP channel; all logging goes to stderr. Startup runs the managed-group check
  against Graph and warns on a mismatch.
- Manual run from the repo root: `pnpm gateway -- --actor alice@contoso.com --request-id test-1`.

## Sprint 2 items noted during Sprint 1

_(none yet)_
