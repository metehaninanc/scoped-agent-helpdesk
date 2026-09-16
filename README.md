# scoped-agent-helpdesk

An identity helpdesk where an AI agent can *ask* for changes but never *make* them without
policy and, where required, a human. The build contract is [SPRINT1.md](SPRINT1.md).

## Layout

```
packages/audit     the audit record format and its hash chain — shared, standalone
packages/gateway   MCP server, policy engine, Graph client, audit log (the only package with credentials)
packages/agent     Agent SDK wrapper, one file per agent
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
- To run `pnpm agent` for real, `ANTHROPIC_API_KEY` must resolve to something: either a real
  environment variable, an `ant auth login` profile, or the same `.env` the gateway reads (the
  agent package loads it too, at its own startup — see "Identity agent notes"). Same variable
  name, but conceptually a separate credential from the gateway's: the agent's own model turns
  run through the Agent SDK's own Claude Code subprocess, which authenticates independently of
  the gateway process the agent spawns alongside it.

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
| 3. Audit log         | done, tests first: `packages/audit`               |
| 4. Approval store    | done, tests first: `packages/gateway/src/approvals` |
| 5. Identity agent    | done, tests first: `packages/agent`               |
| 6. Web               | done, tests first: `packages/web`                 |

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

### Audit core notes

`packages/audit` (`@helpdesk/audit-core`) is a standalone workspace package: the append-only
record format and its sha256 hash chain, used by both the gateway and the identity agent.

- **What it deliberately does not carry: no identity, no policy, no credentials.** It does not
  know what a UPN or a group id is, does not decide, and never sees an app registration or a
  certificate. It also takes no position on how or where the database file is opened — a
  caller passes in an already-open `DatabaseSync`; there is no `AuditLog.open(path)`
  convenience. Only the record format and the hash chain live here. That boundary is the point:
  it is small enough to hold in your head, and safe for the agent package to depend on directly
  even though SPRINT1.md forbids it from importing gateway *runtime* code — this package is not
  gateway code, it is the shared package both writers depend on.
- **Why it exists at all: two writers, not a hypothetical third.** The gateway writes policy
  decisions and results; the identity agent writes `request` and `no_tool_called` (Component 5)
  because only it ever sees the model's final reply text. An earlier version of this project had
  the agent hand-maintain its own byte-identical copy of the schema and hash algorithm to avoid
  a gateway-runtime import — workable, but two copies of a hash algorithm are exactly the kind
  of thing that drifts silently. With a second real writer already in hand, the justification
  for a shared package was present, not speculative, so the duplication was removed rather than
  managed.
- `node:sqlite` (built into Node 22, no native build step). Each caller opens its own
  connection — `packages/gateway/src/db.ts` for the gateway (approvals share the same file),
  `packages/agent/src/db.ts` for the agent (a few lines, no identity/policy/credential content,
  not worth sharing the way the record format was).
- `AuditLog.append()` is synchronous and transactional. When it returns, the record is
  committed — every caller's "audit first, then act" ordering depends on that.
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
- Demo: `pnpm verify-audit [path]` (in the gateway package) prints the log and the verdict,
  exit code 1 on a break.

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

- Three tools: `list_user_groups`, `list_managed_groups`, `add_user_to_group`.
- `packages/gateway/src/tools/descriptions.ts` is the whole prompt surface: tool names,
  descriptions and parameter descriptions, in one file. `descriptions.test.ts` pins the
  load-bearing phrases (pending is success, stop and report, do not route around a denial), so
  a rewrite has to touch the test in the same commit.
- **The allowlist is not in the prompt.** Descriptions are static text with no ids in them
  (a test enforces this). The agent resolves a group name by calling `list_managed_groups`,
  which goes through the full call order and is audited, so the log also shows when the agent
  asked what it could see. Embedding the list in a description would put protected resources
  into the model's context and would not scale past a handful of groups.
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

### Approval store and rationale notes

- `approvals/rationale.ts` is one Messages API call (`@anthropic-ai/sdk`, default model
  `claude-opus-5`, override with `HELPDESK_RATIONALE_MODEL`): a frozen system prompt asking for
  the three sections and forbidding a recommendation, plus `renderFacts()` as the only user
  turn. No tools, no loop, no history. The tests assert the wire body: the request has exactly
  `model`, `max_tokens`, `system`, `messages`, `output_config`, and the messages array is the
  rendered facts alone. The facts are built in the tool handler from the validated request and
  the session identity, never from anything the model said.
- The result is stored verbatim on the approval and audited as a `rationale` record
  (`parameters` = the facts sent, `result` = the text returned, `rules` = []). A failed call is
  audited the same way with the error; the approval proceeds without a rationale.
- Without `ANTHROPIC_API_KEY` the gateway logs a warning at startup and approvals carry no
  rationale. It is used for nothing else.
- `approvals/workflow.ts` is the approve/reject path: validate, refuse self-approval (audited as
  `denied` / `deny.self_approval`), audit the verdict, record it (decided at most once), then
  for an approval call Graph and audit the result. The decision note is required on both
  approve and reject and is stored trimmed. The web layer (Component 6) calls this; it holds
  no rules of its own.
- Refusal fallbacks (`fallbacks: "default"`) are deliberately not enabled on the rationale call.
  A refusal degrades to "no rationale", which the approver sees, and the audit record then
  names one fixed model rather than whichever fallback answered.

### Identity agent notes

- One file, `packages/agent/src/identity-agent.ts`: `runIdentityAgent()` plus a small CLI
  wrapper. Runs on `@anthropic-ai/claude-agent-sdk` with `tools: []` (every built-in tool off)
  and `allowedTools` naming exactly the three MCP tool names
  (`mcp__identity-gateway__list_user_groups` etc.) with `permissionMode: "dontAsk"`, so nothing
  runs unless it is on that list and nothing waits on a permission prompt no one is there to
  answer. `tools: []` is the point of using the Agent SDK here rather than Claude Code
  directly: it is an addition problem (nothing runs unless named) instead of a subtraction
  problem (turn off Bash, file write, web access, and keep turning off whatever ships next).
- The actor identity, the agent name and the session's `requestId` are spawn-time parameters,
  threaded straight into the gateway subprocess's `--actor`/`--agent`/`--request-id` args. No
  tool parameter, prompt content, or code path here reads an actor from anywhere else — a
  model cannot set who the gateway acts for.
- The gateway subprocess is a sibling package binary, `dist/bin/gateway.js`, located by
  resolving `@helpdesk/gateway`'s `package.json` (`createRequire(...).resolve(...)`) rather
  than by importing it — so the actual code never crosses the package boundary.
- **The package boundary, and how it is kept without duplicating the chain.** SPRINT1.md: "the
  agent package must not import anything from the gateway package other than type
  definitions." The gateway is spawned per session and only exposes its three MCP tools, none
  of which write a `request` or `no_tool_called` audit record — and only this process ever sees
  the model's final reply text, which `no_tool_called` needs to store. `session-audit.ts`
  writes those two record kinds using the real `AuditLog` from `@helpdesk/audit-core` (see
  "Audit core notes" above) — a normal dependency on a shared, credential-free package, not an
  import of gateway code. An earlier version of this file hand-duplicated the schema and hash
  algorithm to avoid exactly that gateway import, before the shared package existed; that
  duplication is gone now that there is somewhere else for the logic to live.
- `packages/agent/src/db.ts` is this package's own tiny "open a sqlite file" helper (mkdir,
  pragmas) — not shared with the gateway's equivalent, and not worth sharing: it carries no
  identity, policy or credential logic of its own, unlike the record format and chain.
- `toolWasCalled` is tracked by scanning each `assistant` message for a `tool_use` content
  block; the reply text comes from the final `result` message. A tool call that the gateway
  denies still counts as a tool call — `no_tool_called` means the model never tried, not that
  it didn't get what it wanted.
- `persistSession: false`: this is a backend service, not an interactive CLI session, so
  nothing is written to `~/.claude/projects/`. `env` is left unset so the Agent SDK's own
  subprocess inherits `process.env`, which is what lets it find `ANTHROPIC_API_KEY` (or an
  `ant auth login` profile) the normal way — this key is separate from the one the gateway
  reads from `.env` for rationale generation. `packages/agent/src/env.ts` loads `.env` once, at
  the start of `runIdentityAgent()`, before that subprocess spawns (real environment variables
  still win, same rule as the gateway's own env loader), so a live run does not depend on the
  shell already having the key exported — only on it being in `.env` or the real environment
  by the time the agent runs.

### Web app notes

- Two server-rendered pages, plain `node:http`. No framework, no JSX, no build step — every
  page is a template-literal function returning a string, tested without ever starting an HTTP
  server. `packages/web/src/html.ts` is the one place HTML gets built; `escapeHtml()` runs on
  every value that ever came from a user, an agent, or a model (identity fields, request text,
  group ids, decision notes, the rationale) before it reaches a template.
- The route handlers (`request-page.ts`, `approvals-page.ts`) are plain async functions —
  `submitRequest(input, deps)`, `decideApproval(input, deps)` — independent of HTTP, unit
  tested with fake deps. `server.ts` is the thin `node:http` routing/body-parsing layer on top,
  covered by its own integration tests (a real server on an ephemeral port, real `fetch`
  calls), the same two-layer pattern as the gateway's tool handler and MCP server.
- **A null rationale renders as an explicit sentence** ("No rationale was generated for this
  request."), never a blank section — the exact SPRINT1.md Component 6 requirement, and
  tested directly.
- Requester/approver separation and the required decision note are enforced by
  `ApprovalWorkflow.decide()` (Component 4), not re-implemented here. The web layer's job is to
  show the refusal honestly when one comes back (`ApprovalError` renders as `.error`, not a
  generic 500) — proven live: a self-approval attempt through the actual web form was refused
  with the same message the workflow produces.
- Verified live end to end, against the real tenant, in one session: the request page ran a
  real identity-agent turn (a tool call and a real answer, and separately a no-tool-call
  clarifying question); the approval page listed a pending approval created via the gateway,
  showed the missing-rationale message, refused a self-approval attempt, then approved with a
  different identity and the group membership changed in the tenant — confirmed, then reverted.
  The audit chain across the whole session (both paths) stayed intact throughout.
- `WEB_PORT` (optional, default 3000) is read directly from the environment (or `.env`, loaded
  the same way as the gateway's other variables); it is not part of `GatewayEnv` since it is a
  web-app-only concern, not something the gateway or agent need to know.

## Sprint 2 items noted during Sprint 1

- **The web app holds Graph credentials directly** (`packages/web/src/bin/web.ts`
  instantiates its own `CertificateCredential`/`GraphClient` to execute an approval). SPRINT1.md
  defers HTTP transport and OAuth on the gateway to Sprint 2; until the gateway is reachable
  over HTTP, there is no way for the web app to ask the gateway to make the Graph call on its
  behalf, so it makes it itself. It is a human-only interface (the approver's screen), not
  model-reachable, so this is the same trust boundary as the gateway process, not a new one —
  but it is still a second process with the private key on disk, and Sprint 2's HTTP transport
  should let the web app go through the gateway instead.
- `add_user_to_group` is Sprint 1's only write; there is no `remove_user_from_group`. Every live
  demo in this README that changed real tenant state reverted with a direct, one-off Graph
  `DELETE $ref` call, not through this codebase. A remove path (with its own policy rule) is a
  Sprint 2 candidate if reverting a change needs to be a supported operation rather than a
  manual escape hatch.
