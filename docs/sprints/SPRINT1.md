# Sprint 1 — The Spine

One request path, working end to end. Three tools, one policy engine, one audit log, one agent.
Everything else waits.

This document is the build contract. Read it before writing code, and re-read it when a decision
feels ambiguous. If something here is wrong, change this file first and the code second.

---

## Definition of done

Sprint 1 is finished when all five of these are true:

1. A user submits "which groups is alice@contoso.com in" through the web form and gets a real
   answer from Microsoft Graph.
2. A user submits "add alice@contoso.com to the Marketing group" and the system does NOT do it.
   It creates an approval record and tells the user it is pending.
3. An approver opens the approval screen, sees the raw facts and a generated rationale, approves,
   and the group membership changes in the tenant.
4. A user submits "assign alice@contoso.com the Global Administrator role" and the system refuses
   without calling Graph at all.
5. All four of the above appear in the audit log, including the refusal. This holds even when
   the model declines item 4 on its own without calling a tool: the request record and the
   `no_tool_called` record are the trail (see Component 3).

If those five work, the architecture is proven and Sprint 2 can widen it.

---

## Stack

**Language:** TypeScript on Node 22+. One repo, one package manager (pnpm).

**Agent layer:** Claude Agent SDK. The agent starts with zero tools and receives only what the
gateway exposes. Do not use Claude Code as the runtime. Claude Code ships with Bash, file write
and web access, and removing them is a subtraction problem that needs maintenance every release.

**Gateway:** an MCP server. Sprint 1 uses stdio transport because it is the simplest thing that
works and the agent runs on the same host. HTTP transport and per agent OAuth land in Sprint 2.

**Graph access:** app registration with a certificate credential. No client secrets, not even in
development. Getting this right on day one avoids a painful migration later.

**Storage:** SQLite. Approvals and audit records both live there. Do not add Postgres in Sprint 1.

**Web:** a minimal server rendered app. No SPA framework, no build pipeline for the UI. Two pages.

---

## Repo layout

```
.
├── SPRINT1.md
├── README.md
├── packages/
│   ├── audit/            the audit record format and its hash chain, shared, standalone
│   ├── gateway/          MCP server, policy engine, Graph client, audit log
│   ├── agent/            Agent SDK wrapper, one file per agent
│   └── web/              request form, approval screen
└── data/
    └── helpdesk.db       SQLite, gitignored
```

The gateway is the only package that holds credentials. The agent package must not import
anything from the gateway package other than type definitions; it may depend normally on
`packages/audit`, which is not gateway code — see Component 3 for what that package is and,
just as deliberately, is not.

---

## Azure setup (do this first, before any code)

1. Create a free Azure account and a new Entra tenant. Do not use a tenant you care about.
2. Create three or four test users and two test groups. One group named something like
   `Marketing`, one named something like `Finance`.
3. Create one app registration, `helpdesk-identity-gateway`.
4. Generate a self signed certificate, upload the public key to the app registration, keep the
   private key on disk outside the repo.
5. Grant application permissions: `User.Read.All`, `GroupMember.ReadWrite.All`. Grant admin
   consent. Nothing else. If a later task needs another scope, that is a decision, not a detail.
6. Record the tenant id, client id and certificate thumbprint in a `.env` file. Gitignore it.

Note on scope: directory audit logs are readable on the free tier. Sign in logs through Graph
need Entra ID P1 or P2. Sprint 1 does not touch sign in logs, so the free tier is enough.

---

## Component 1: policy engine

This is the most important code in the project. Write it first, and write it with tests.

It is a pure function. No I/O, no network, no model call, no randomness.

```ts
type Decision =
  | { outcome: "autonomous" }
  | { outcome: "approval"; rules: string[] }
  | { outcome: "denied"; rules: string[] };

function decide(request: ToolRequest, context: RequestContext): Decision
```

`ToolRequest` carries the tool name and its validated parameters. `RequestContext` carries the
requesting user, the calling agent identity, and a timestamp.

Rules for Sprint 1, evaluated in this order. First match wins.

**Deny rules (checked first, never overridable):**
- The tool targets a directory role rather than a security group.
- The target user is on the break glass list (hardcode two UPNs in config).
- The target group is not on the managed group allowlist.

**Approval rules:**
- `add_user_to_group` always requires approval in Sprint 1. No exceptions, no allowlist of
  "safe" groups yet. That comes later if at all.

**Autonomous:**
- `list_user_groups` when the target is any user in the tenant.
- `list_managed_groups`, always. It reads the allowlist from config and touches nothing.

Everything not matched by a rule is denied. The default is refusal, not permission.

Tests to write before the implementation:
- each deny rule fires on its own
- deny wins when both a deny rule and an approval rule would match
- an unknown tool name returns denied
- a malformed parameter returns denied rather than throwing

---

## Component 2: gateway (MCP server)

Exposes exactly three tools: two reads and one write. Every result is a JSON object with a
`status` discriminator, so the agent reads one shape for every outcome.

### `list_user_groups`
Input: `{ userPrincipalName: string }`
Output: `{ status: "ok", groups: [{ id, displayName }] }`
Graph: `GET /users/{upn}/memberOf/microsoft.graph.group` (groups only; roles and administrative
units are not groups)

### `list_managed_groups`
Input: none
Output: `{ status: "ok", groups: [{ id, displayName }] }`, straight from the policy config
Graph: none

The allowlist is protected data and must not be embedded in a tool description: that would put
protected resources into the model's context on every turn, and it does not scale past a handful
of groups. A tool call, by contrast, goes through the same call order as everything else and
lands in the audit log, so "the agent asked what it could see" is itself evidence.

### `add_user_to_group`
Input: `{ userPrincipalName: string, groupId: string }`
Output: either `{ status: "executed" }` or `{ status: "pending_approval", approvalId: string }`
Graph: `POST /groups/{id}/members/$ref`

All three tools can also return `{ status: "denied", rules, message }` (policy refused; nothing was
called) and `{ status: "error", code, message }` (Graph or the gateway failed; the agent reports
it as given). Denied is a normal result, not a protocol error: a refusal is an answer.

**Identity binding.** One gateway process per agent session. The requesting user's UPN, the
agent name and the session `requestId` are passed as process arguments when the agent runtime
spawns the gateway (`--actor`, `--agent`, `--request-id`). They are never tool parameters:
nothing the model sends can change who the gateway is acting for. HTTP transport with per agent
OAuth replaces this in Sprint 2.

Call order inside every tool handler, without exception:

1. Validate input shape.
2. Call `decide()`. Malformed input and unknown tool names are not rejected before this step;
   `decide()` denies them by name, so they are audited like everything else, raw input included.
3. Commit an audit record for the decision, whatever it is. Synchronous, transactional.
4. Branch:
   - autonomous, call Graph, write a second audit record with the result (success or error)
   - approval, create an approval record, generate the rationale, return pending
   - denied, return a refusal that names the rules, call nothing

Step 3 completes before step 4 starts. The audit record for a decision must be on disk before
any Graph call, so a crash mid-execution still leaves evidence of what was decided. If the audit
write itself fails, the handler does nothing else and the agent is told the gateway is
unavailable.

Tool descriptions matter. They go into the model prompt, so write them as behaviour, not as
documentation. Keep them in one file (`tools/descriptions.ts`) and pin the load-bearing phrases
with tests, so a rewrite is deliberate. `add_user_to_group` must describe `pending_approval` as
its normal, successful result, and tell the agent to report it plainly, give the requester the
approval id, and stop: no retry, no other tool, no claim that the change was made. It must tell
the agent to call `list_managed_groups` to turn a group name into an id, and never to guess one.
Descriptions are static text: they take no configuration and contain no ids.

---

## Component 3: audit log

Append only. SQLite table, no updates, no deletes.

The record format and the hash chain live in their own package, `packages/audit`
(`@helpdesk/audit-core`), not inside the gateway. Two writers need it — the gateway itself, and
the identity agent, which writes its own `request` and `no_tool_called` records because only it
ever sees the model's final reply (Component 5) — and the justification for a shared package is
"two writers exist today," not "a third might show up later." Keeping two byte-identical copies
in sync by hand was worse than the package.

That package carries the record format and the chain, and deliberately nothing else: no
identity, no policy, no credentials, and no opinion on how or where the database file is
opened — a caller passes it an already-open connection. That boundary is the point: it is safe
for the agent package to depend on directly (SPRINT1.md still forbids the agent importing
gateway *runtime* code; `@helpdesk/audit-core` is not gateway code, it is the shared package
both writers depend on), and it is small enough that "what does this package know about the
system" has an answer you can hold in your head.

The log records every agent request, not only tool calls. Each agent session generates a
`requestId` at the start and writes a request record immediately, before any tool is called.
Because the table is append only, what happened afterwards is a further record under the same
`requestId`, never an update to the first one:

- session start: `decision = request`, `tool` null, `parameters` holds the request text and the
  requesting identity
- each tool call: one record with the policy decision (`autonomous | approval | denied`) and
  `result` null. This is written before anything else happens (see Component 2)
- each Graph call: one more record with the same `tool` and `decision`, and `result` filled in
- session end without any tool call: `decision = no_tool_called`, `tool` null, `result` holds
  the agent's reply
- rationale generated for an approval: `decision = rationale`. Supporting information, never a
  decision: `rules` is empty, `parameters` is exactly the facts the model was given, `result`
  is the text it returned, verbatim (or the error, if it failed)
- an approver's verdict: `decision = approved | rejected`, `actor` is the approver. For an
  approval, one more `approved` record with `result` filled in marks the Graph execution
- a requester trying to decide their own request: `decision = denied`, rule
  `deny.self_approval`, written before the attempt is refused

This closes a gap in the definition of done: items 4 and 5 must produce an audit trail even when
the model declines on its own without touching a tool. A refusal the gateway never saw is still
a refusal, and it must still be evidence.

```
id             integer primary key
timestamp      iso 8601, utc
requestId      correlates all records from one user request
actor          upn of the requesting user
agent          which agent made the call
tool           tool name, null on request and no_tool_called records
parameters     json, the validated input (the request text on request records)
decision       request | autonomous | approval | denied | no_tool_called | rationale | approved | rejected
rules          json array, which rules fired, empty when no policy decision was made
result         json, null until execution
prevHash       sha256 of the previous record
hash           sha256 of this record including prevHash
```

The hash chain is two lines of code and it upgrades the log from a table into evidence. Write a
`verifyChain()` function that walks the whole log and returns the first broken record (its
index, id and what is wrong with it), or null when the chain is intact. That function is a demo
on its own.

The chain detects modification and deletion anywhere but the tail. To cover the tail, keep a
head marker (last id, last hash) outside the audit table, updated in the same transaction as
every append, and have `verifyChain()` report `tail_truncated` when tail and marker disagree.
That raises the bar; it does not close the gap, since whoever can rewrite the table can rewrite
the marker. External anchoring is the real fix, and it is not Sprint 1.

Do not put ledger anchoring in Sprint 1. The chain is the part that carries the argument.

---

## Component 4: approval store and rationale

Approval records are asynchronous. The agent does not wait.

```
id             uuid
createdAt      iso 8601
requestId      links back to the audit record
actor          who asked
tool, params   what was requested
rules          why it needs approval
rationale      generated text, see below
status         pending | approved | rejected
decidedBy      upn of the approver, null while pending
decidedAt      timestamp, null while pending
decisionNote   free text the approver writes, required on both approve and reject
```

The rationale is generated by a single model call at record creation time. It is not an agent.
It has no tools, no loop, no memory.

Its input is the raw facts only: tool name, parameters, which rules fired, target user, target
group, requesting user. It must NOT receive the agent's conversation or the user's original
wording. An agent that has been talked into something would otherwise write its own
justification, and that would hollow out the whole control.

Ask it for three short sections: what is being requested, what changes if approved, what is
worth checking before approving. Store the output verbatim.

Store it as supporting information, never as a decision. The human decides. The audit log marks
it the same way: a `rationale` record whose `parameters` are exactly the facts sent and whose
`result` is exactly the text received. If the model call fails, the approval record is still
created, the rationale stays null, and the `rationale` audit record carries the error. A missing
rationale never blocks an approval; a human can decide without it.

The generator is one Messages API call with a frozen system prompt and the rendered facts as
the only user turn. No tools, no `tool_choice`, no conversation history. The facts are built
inside the gateway from the validated request and the session identity, so there is no path by
which the model's conversation could reach the generator. `ANTHROPIC_API_KEY` lives in `.env`
and is used for nothing else in Sprint 1.

**Approve / reject.** Same principle as the tool handler: evidence first, then state, then
action.

1. Validate: the approver is a UPN, the decision is `approved` or `rejected`, the note is
   non-empty after trimming. Nothing is written for a malformed request.
2. Refuse a requester deciding their own request (UPNs compared case-insensitively). This
   refusal IS written, as a `denied` audit record with rule `deny.self_approval`: someone
   trying to approve their own request is exactly what the log exists to show.
3. Audit the verdict (`approved` or `rejected`, actor = the approver).
4. Record the verdict on the approval. The store's UPDATE is conditional on `status = pending`,
   so a record is decided at most once even under concurrent approvers.
5. Approved only: call Graph, then audit the result under the same requestId. A Graph failure
   leaves the approval approved and the failure in the log; the human's decision stands, the
   execution did not, and both are visible.

---

## Component 5: identity agent

One file. Expect fifty to eighty lines.

- system prompt states the agent's narrow role, that it uses only the tools it is given, and
  that when a tool returns pending or denied it reports that plainly instead of finding another
  route
- connects to the identity gateway over stdio
- allowed tools list contains exactly the three gateway tools
- no built in tools enabled
- takes the requesting user's identity as a parameter and passes it on every call
- generates a `requestId` at session start, writes the `request` audit record before the first
  model call, and writes the `no_tool_called` record if the session ends without a tool call,
  using `@helpdesk/audit-core` directly (Component 3) — not a second, hand-written copy of the
  record format and chain

Triage is not a separate process in Sprint 1. Keep the routing logic as a placeholder function
so the seam exists, but do not build a second agent yet.

---

## Component 6: web

Two pages, server rendered.

**Request page.** A text box, a user identity field, a submit button. The identity field is a
plain input in Sprint 1. Entra login replaces it in Sprint 2, so carry the identity as a
parameter through every layer from day one. Retrofitting identity later is the worst refactor
in this project.

**Approval page.** List of pending approvals, and a detail view with three blocks:
1. raw facts, exactly as stored
2. the generated rationale, visually marked as generated
3. approve and reject buttons, plus a required decision note field

The rationale can be null — the model call failed, or no key is configured (see Component 4).
When it is, block 2 must say so explicitly: something like "No rationale was generated for
this request." A blank section reads as "nothing worth explaining here," which is the opposite
of the truth and exactly the wrong failure mode for a control this project exists to defend.
Never render an empty block and never fall back to silence.

Server side, reject any approval decision where `decidedBy` equals `actor`. Separation of
requester and approver is a real audit control and it costs one line.

---

## Out of scope for Sprint 1

Do not build these, even if they feel close:

- MDM agent, endpoint agent, knowledge agent
- separate service principals per agent (that is Sprint 2, and it is the headline demo)
- HTTP transport or OAuth on the gateway
- Entra login on the web app
- Teams or Telegram
- Paperclip or any orchestrator
- ledger anchoring
- prompt injection test suite (Sprint 4)

If a task starts pulling one of these in, stop and note it in the README as a Sprint 2 item.

---

## Working notes for Claude Code

- Build in this order: policy engine with tests, audit log, Graph client, gateway tools, approval
  store, rationale, agent, web. Each step should leave the repo in a working state.
- Write the policy engine tests before the policy engine.
- Never widen a Graph permission to make a task pass. Stop and ask instead.
- Never let the agent package read the certificate path from the environment. If that import
  becomes convenient, the architecture has drifted.
- Keep tool descriptions in one file so they can be reviewed as a unit. They are prompt surface
  and they deserve the same scrutiny as code.
- Commit messages should name which Sprint 1 component they touch.
