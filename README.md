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

- Node 22+
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
| 3. Audit log         | not started                                       |
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

## Sprint 2 items noted during Sprint 1

_(none yet)_
