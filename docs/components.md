# Component notes

Notes on each component, from the policy engine and audit core to the gateways, the agents, the web app, the operator console and the dashboard: what it is for, how it is built, and what building it turned up.

Section titles quoted in the text, such as "Endpoint gateway notes", are the titles from the project's original single-file README; [the index](README.md) says where each one is now.

## Policy engine notes

`decide(request, context, config)` is pure and never throws; anything it cannot evaluate is
denied and named (`deny.unknown_tool`, `deny.malformed_parameters`, `deny.policy_error`). Rule
tiers are checked in order (deny, then approval, then autonomous, then a default deny), and the
result lists every rule in the winning tier that matched, not just the first, so the audit log
carries the whole reason. Break glass applies to reads as well as writes: `list_user_groups` on a
break glass account is denied, not just `add_user_to_group`. The directory role id table
(`directory-roles.ts`) is a labelling aid, not the actual boundary: the managed group allowlist
is what stops a call, and an id missing from the role table is still denied by the allowlist
rule, just under a less specific name. The config file's shape is checked when it loads: a
malformed UPN or group id throws at startup rather than silently denying every request.

## Audit core notes

`packages/audit` (`@helpdesk/audit-core`) is a standalone workspace package holding only the
append only record format and its hash chain, used by all four writers as of Stage B: both
gateways and both agents (each agent still writes its own `request` and `no_tool_called` records
directly, for the reason below; each gateway writes everything else, including — as of Stage B —
a rejected token, and the identity gateway's approval decisions). It deliberately carries no
identity, no policy, no credentials, and no opinion on how or where
the underlying database file is opened; a caller passes in an already open connection. This
exists because there are two real writers (the gateway, and the identity agent, which writes its
own `request` and `no_tool_called` records because it is the only process that ever sees the
model's final reply text) and an earlier version of this project had the agent hand maintain its
own copy of the schema and hash algorithm rather than import gateway code. Two copies of a hash
algorithm is exactly the kind of thing that drifts silently, so once a second real writer
existed, the duplication was removed rather than managed. `AuditLog.append()` is synchronous and
transactional; every caller's audit-before-action ordering depends on that. Append only is
enforced twice, by database triggers and by the hash chain, so that removing the triggers alone
is not enough to edit history undetected. `pnpm verify-audit [path]` (built from the gateway
package) prints the log and the verification result, with a nonzero exit code on a broken chain.

## Handoff core notes

`packages/handoff-core` (`@helpdesk/handoff-core`, SPRINT4.md, section 2) is a second standalone
package at the same layer as `@helpdesk/audit-core`, for the same reason that one exists: two real
writers need the identical mechanism, and neither should import the other's runtime. Here the two
writers are a gateway's own `hand_off` tool (called by the model, mid-conversation, autonomous)
and the orchestrator's own direct-creation path (triage decided `needs_human`, before any gateway
or agent is involved at all). The orchestrator has no gateway, by design, since SPRINT3.md 3.1 —
"the strongest boundary available here is not having one at all" — so a package that only a
gateway could reach would have forced the orchestrator to either grow one just to create a
handoff, or hand-roll a second copy of the same open/taken/resolved logic. Neither was acceptable,
so the lifecycle moved to a package both sides depend on symmetrically, the same shape
`@helpdesk/audit-core` already has relative to the gateway and the identity agent.

**What it deliberately does not carry:** no credential, no policy, no tool schema, no transport,
and — the same rule `@helpdesk/audit-core` itself follows — no database connection management; a
caller passes in an already-open `DatabaseSync` and its own audit-append surface. `HandoffStore`
shares whichever chain its caller already writes to: a gateway's own `db`/`audit` (the same pair
`ApprovalStore` already shares there), or the orchestrator's own `OrchestratorAudit.log` (made
public for exactly this — see that class's own comment).

**Not built on `ApprovalStore`/`ApprovalWorkflow`, on purpose.** Approvals have execution
semantics a handoff does not: approving calls a gateway's own backend (Graph, the stub service)
and audits the result of that call. Resolving a handoff is a human doing the work entirely outside
this system; there is nothing to execute and no backend failure to describe. Forcing one shared
abstraction to cover both would have left every call site holding fields that mean nothing for its
own case — an `execute` callback a handoff can never use, or a lifecycle richer than approval's
two-state pending/decided actually needs. `HandoffStore` shares only what is genuinely identical
between the two controls: evidence-before-state ordering, and a required note on the one
transition that actually matters (`resolve`, never `take` — an operator starting work has nothing
yet worth writing down, unlike SPRINT4.md, section 3's approve/reject, which both require one).

**The `x-request-text` header.** A gateway's own `hand_off` tool needs the original request text
for the handoff record it creates (SPRINT4.md, section 2: "the record carries ... the original
request text"), and the gateway has no other way to reach it — the tool's own parameters carry
only `reason`, a model-written account of what a person should do, never a restatement of what
started the conversation. See "Identity is bound outside the model's reach, never a tool
parameter" above for the full reasoning this follows: `x-request-text` is the same class of value
as `x-actor`, set by the agent process itself from a value it already holds before the model's
turn ever starts, never a tool parameter the model could be talked into filling in differently. It
is not enforced the way `x-actor` is — a missing or wrong request text cannot let a request
through as someone else, so `sessionFromExtra()` defaults it to an empty string rather than
refusing the request with a 400 the way a missing `x-actor` does.

**Three new audit decision kinds**, added to `@helpdesk/audit-core` rather than kept inside this
package: `handoff` (created, evidence before the queue row exists), `handoff_taken` (no note),
`handoff_resolved` (the required note, verbatim). A handoff is "a new writer to the audit chains"
(SPRINT4.md's own working notes for this section), not a new chain of its own — whichever chain
already exists for the writer (a gateway's own, or the orchestrator's) gets these three additional
record shapes, the same way `routed` and `denied` already live on the orchestrator's chain
alongside `model_usage`.

## Graph client notes

The certificate credential flow (`private_key_jwt`) is hand rolled on `node:crypto` and `fetch`
rather than pulling in an auth library, since this is the only package meant to hold Graph
credentials for the identity gateway and the flow is short enough to read end to end. As of
Sprint 2, `GraphClient` is also what `packages/mdm-gateway` imports for its own, separately
credentialed calls (see the file's own header comment for why that is sharing code, not sharing
configuration). It exposes: `listUserGroups` (group memberships only, directory roles and
administrative units excluded, with paging), `addUserToGroup` and `removeUserFromGroup` (already
being a member, or already not being one, is not specially handled for removal the way it is for
addition — Graph's 404 on removing a non-member propagates as an ordinary `GraphError`, since
SPRINT2.md's Component 3 does not ask for idempotency here), and `listDevices` / `getDevice`
(paging for the list; a 404 on `getDevice` propagates rather than returning null, since this one
is model-facing, unlike the identity-only `getGroup`). Inputs are re-validated with the same
schemas the policy engines use before they are used to build a URL. There is no retry on
throttling yet; the tenant this was built against does not throttle at this volume.

## Gateway notes

Four tools are exposed: `list_user_groups`, `list_managed_groups`, `add_user_to_group`,
`remove_user_from_group`. Tool descriptions live in one file (`tools/descriptions.ts`), reviewed
as prompt surface with tests that pin the phrases that matter, most importantly that a pending
approval is described as success, not as something to retry around — true for both writes now,
not just the addition. The managed group allowlist is not embedded in any description; the agent
calls `list_managed_groups` to resolve a group name, and that call is itself audited, so even
"the agent asked what groups exist" is on the record. The MCP server is built on the SDK's low
level `Server` rather than the higher level tool registration helper, because the latter
validates arguments before a handler runs, and a call rejected there would never reach the audit
log. As of Stage B, one gateway process is a long-running HTTP server, not one process per agent
session: `sessionFromExtra()` derives a fresh `SessionContext` for every tool call from the
validated token (`agent`, the token's own client id) and from the `x-actor`/`x-request-id`
headers the calling agent sets itself (`actor`, `requestId`) — never from the tool call's own
arguments. As of SPRINT3.md 3.2, that function, and the `Server`/transport wiring around it, live
in `@helpdesk/gateway-core`; see "Gateway template notes" below for what that means for this
package specifically. A stateless `StreamableHTTPServerTransport` cannot be reused across
requests, so `bin/gateway.ts` builds a fresh `Server` and transport pair per request (now via
`createTransportFactory()`) over the same shared dependencies (the audit log, the Graph client,
...), which is cheap: it only registers handlers, it does not reopen anything. `packages/mdm-gateway`
still keeps its own `tools/` and its own policy engine — that separation is unchanged and is
exactly what 3.2 preserved rather than collapsed — but as of this phase it no longer repeats the
gateway mechanics independently; both packages build on the same `@helpdesk/gateway-core`, so
the two remain two things a reviewer can reason about separately for the parts that are actually
theirs (tools, policy, backend), the same argument SPRINT2.md's Component 6 makes for the audit
chains, applied one layer down.

## Gateway template notes

SPRINT3.md, 3.2. Before this phase, three gateways existed or were about to (identity, MDM, and
the knowledge gateway SPRINT3.md 3.3 adds next), and the second one, MDM, was already built by
copying the identity gateway's HTTP transport, token validation and database helper wholesale and
importing them back across the package boundary — "shared code, not shared configuration," in
SPRINT2.md's own words, but shared by one gateway depending on another's internals, which does
not survive a third or fourth gateway needing the same thing. `@helpdesk/gateway-core` is the
extraction: a neutral package both existing gateways now depend on symmetrically, carrying
exactly what SPRINT3.md's own list asks for — HTTP transport (`http-listener.ts`, unchanged from
before, now living in a neutral home), MCP server wiring (`server.ts`: `createGatewayServer()`,
`sessionFromExtra()`), token validation (`auth/`, unchanged), the validate/decide/audit/branch
call order (`tool-call.ts`: `runToolCall()`, extracted from what was two near-identical
`handler.ts` files), audit wiring, and the refusal shapes (`DeniedOutput`, `ErrorOutput`,
`PendingApprovalOutput`, composed into `GatewayToolOutput<TOk>` — a gateway's own success shapes
plus the three every gateway shares verbatim).

**What stayed put, and why.** Tool schemas (`policy/schemas.ts`), policy rules and `PolicyConfig`
(`policy/`), tool descriptions (`tools/descriptions.ts`), and each gateway's backend client
(`GraphClient`, for both gateways today) are not in the core and were never going to be —
SPRINT3.md is explicit that these are what a new gateway supplies, and they are also the parts
where copying identity's shape and writing this gateway's own content is the entire job. `Decision`,
`ToolRequest`, `RequestContext` and `SessionContext` are structurally identical across every
gateway and now have one canonical definition in `gateway-core/src/session.ts`; each gateway's own
`policy/types.ts` still declares its own `Decision`/`ToolRequest`/`RequestContext` rather than
importing core's, which works only because TypeScript's structural typing treats the two as
interchangeable. That is a deliberate, narrow-risk choice for this phase, not an oversight: it
avoided touching a file every policy rule and every test in both gateways already depends on,
in exchange for a few lines of duplicated type shape that cannot drift in practice (a real
divergence would be a compile error the moment `runToolCall()` was called with it). Worth
revisiting if a future gateway's types stop lining up structurally; not worth the risk here.

**The no-approval, no-credential case, made first class.** `RunToolCallDeps.onApproval` is
optional; omitting it is not a workaround, it is what the MDM gateway has always done, and now
does by omitting a field rather than by writing its own "fail loudly" branch — `runToolCall()`
supplies that fallback once, for every gateway that has no approval path. The same reasoning
extends to a gateway with no backend client at all: `execute()` is a plain callback the core
never inspects, so a knowledge gateway's `execute()` doing a local file search instead of a Graph
call needs nothing new from this package. Between them, these two optional seams are what
SPRINT3.md 3.3 needs before it can be built.

**Two real findings, not zero.** First, `describeError` — converting a thrown backend error into
the tool's error shape — is byte-identical between the two gateways' `handler.ts` files today
(both are Graph-aware in exactly the same way), which is real, if minor, duplication this phase
chose not to force into the core: it is backend-specific by nature (a knowledge gateway's
`describeError` will not mention Graph at all), so a shared helper would belong beside
`GraphClient`, not in `gateway-core`, and was not worth a second refactor pass in the same phase
that already touched every call site once. Second, and more interesting: extracting the HTTP
listener into a neutral package surfaced a real, if harmless, pre-existing bug rather than only a
duplication — see "Sprint 3, Phase 3.2 verification run" below for what it was and how the
extraction fixed it as a side effect.

**The conformance suite proves the core's guarantees hold for each gateway's own composition, not
only in the abstract.** `conformanceSuite()` (`gateway-core/src/conformance.ts`) is not a set of
assertions about `runToolCall()` and `createRequestListener()` in isolation — `tool-call.test.ts`
and `http-listener.test.ts` already do that, with a fake minimal gateway that exists only for the
test. The conformance suite instead takes a `ConformanceHarness` built from a gateway's *own* real
`decide()`, config, tool schemas and backend (faked only at the Graph/device-list boundary), and
proves the same five guarantees against that real composition:
`packages/identity-gateway/src/conformance.test.ts` and
`packages/mdm-gateway/src/conformance.test.ts` are each a few dozen lines of wiring, not a
reimplementation of the checks. Real JSON-RPC round trips prove the first three (an
`InMemoryTransport` and a real MCP `Client`, the same mechanism each gateway's own
`server.test.ts` already used, so no HTTP server or raw wire format needed); the last two reuse
`createTestSigningKeys()` (a real RSA keypair and a faked JWKS endpoint) to sign tokens the
harness's own `TokenValidator` will actually accept or refuse, the same style
`verify-token.test.ts` already established for the identity gateway before this phase.

**SPRINT3.md, 3.4 generalized the approval store, workflow and decision endpoint into this
package too, the same extraction pattern as everything above, once the endpoint gateway needed
its own approval-gated write.** Before this phase they were identity-gateway-only, because
identity was the only gateway that ever produced an "approval" decision. `ApprovalStore` moved
unchanged — it never depended on Graph, a UPN, or a group in the first place. `ApprovalWorkflow`
needed one real change: its private `execute()` method, which hardcoded
`add_user_to_group`/`remove_user_from_group` dispatch to `GraphClient`, became an injected
`execute` callback, mirroring the exact same generic-core/gateway-specific-backend split
`runToolCall()` already established for the autonomous branch. The identity gateway now supplies
its own callback (`identity-gateway/src/approvals/execute.ts`, extracted from the old method
verbatim) and confirms, via its own expanded test suite, that this produces byte-identical
behavior to before. `createDecisionListener()` needed no change at all: it never touched Graph,
only `ApprovalWorkflow` and a `TokenValidator`, both already gateway-neutral. See "Endpoint gateway
notes" below for what the endpoint gateway's own `execute` callback looks like, and "Web app
notes" for what reading and deciding approvals on two independent gateways, not one, changed
there.

## Approval store and rationale notes

The rationale generator is a single Messages API call, with a frozen system prompt asking for
the three sections described above and forbidding a recommendation either way. The approve and
reject path (`ApprovalWorkflow`, `@helpdesk/gateway-core` as of SPRINT3.md 3.4 — see "Gateway
template notes" above) validates the approver's identity and the decision note, refuses and audits
an attempt where the approver and the original requester are the same person, records the human's
verdict, and only for an approval calls this gateway's own `execute` callback and audits the
result. Nothing about that sequence has changed since Sprint 1; what changed, twice now, is where
it runs and how its backend is supplied. Through Stage A the web app instantiated it directly, in
its own process, with its own `GraphClient`. As of Stage B it runs only inside the identity
gateway process, reached through a non-MCP HTTP endpoint, `POST /approvals/decide` — deliberately
not an MCP tool, since approving or rejecting is a human-only action and putting it on the MCP
surface would put it within an agent's potential reach. Authenticated the same way as the MCP
endpoint (bearer token, `Gateway.Invoke`), on its own path, since the JSON body here (`approvalId`,
`decidedBy`, `decision`, `note`) is a genuine payload from a human-only UI, not a concern the MCP
path's header-based identity has to guard against. The rationale generator itself is identity's
own, still — it was never generalized, since the endpoint gateway's one gated write deliberately
has no rationale at all (see "Endpoint gateway notes" below). The web app calls into whichever
gateway owns a given approval over HTTP and adds no rules of its own, same as it always has.

**SPRINT4.md, section 4: generating a rationale is no longer something `onApproval` does inline at
creation time — it is a separate, human-triggered action, on its own path, reached only from the
console's own opened-approval screen.** Before this phase, `tools/handler.ts`'s `onApproval`
created the approval record and then, if a generator was configured, called it immediately,
inline, before the tool call ever returned to the model. That coupling is gone:
`onApproval` now only ever creates the approval (see `tools/handler.ts`'s own header comment); a
new `RationaleWorkflow` (`approvals/rationale-workflow.ts`) is the only thing that ever calls the
generator, and the only thing that ever calls `RationaleWorkflow.request()` is a new HTTP endpoint,
`POST /approvals/rationale` (`approvals/rationale-listener.ts`), which the console alone reaches.

The three things SPRINT4.md's own section 4 spec said to keep exactly as they were held without
needing to bend any of them:

- **The generator still receives raw facts only, never the agent's conversation.**
  `rationaleFactsFromApproval()` rebuilds the identical `RationaleFacts` shape the old inline path
  built — tool, params, rules, a resolved target group, the requesting user — read back from the
  stored `ApprovalRecord` instead of a live tool call. Nothing new reaches the generator, because
  the record already holds exactly what the old call site held: `ApprovalStore.create()` was given
  those same values at creation time, and they do not change afterward.
- **The request is audited: who asked, for which approval, when.** A new closed-set decision,
  `rationale_requested` (`@helpdesk/audit-core`'s `AUDIT_DECISIONS`), commits before the model is
  ever called — evidence before action, the same ordering every other write in this project
  follows. `actor` names the approver asking for help, not the original requester, whom
  `rationale`'s own `parameters.requestingUser` still names inside the facts, unchanged. An
  approver reaching for a briefing before deciding is now permanently on the record, regardless of
  what generation produces.
- **A missing briefing is normal, not a failure, and the screen says so plainly.**
  `console-page.ts`'s `renderRationale()` never renders a blank section: "No briefing has been
  requested," with the control beside it, while an approval is still pending and the tool is one
  the generator can address; "No briefing was requested before this was decided" once decided,
  with no control, since there is nothing left to inform; "This approval's gateway does not
  generate a briefing" for a tool outside the generator's scope (today, only `reboot_endpoint`) —
  three distinct, honest sentences for three distinct states, never one blanket "unavailable."

**A briefing can be requested at most once, and only while pending.** `RationaleWorkflow.request()`
refuses `already_generated` once `approval.rationale` is non-null and `not_pending` once the
approval has been decided — the same "settle at most once" discipline `ApprovalStore.recordVerdict()`
already enforces for a decision, reused here for the one other approval-record write. A failed
attempt leaves `rationale` null, so nothing blocks a retry; the console shows the failure inline,
next to the still-present control, rather than a dead end.

**The generation call itself now runs synchronously inside the HTTP request that asked for it** —
the same shape `ApprovalWorkflow.decide()` already has, not a background job with its own
persisted state. Anthropic's own default timeout for this call is 60 seconds
(`rationale.ts`'s `timeoutMs`); `bin/web.ts`'s own HTTP client to the gateway allows 65, comfortably
past it, since the true bottleneck is always the model call, not the network hop around it. A
multi-second wait inside one request/response cycle is not new — the pre-section-4 automatic path
already tolerated exactly this, just at a moment no one was watching a specific button for it.

**`POST /approvals/rationale`, deliberately not shared code with `/approvals/decide`.**
`approvals/rationale-listener.ts` is close to a line-for-line twin of gateway-core's own
`decision-listener.ts` — the same JSON-body-under-64KB parsing, the same bearer-token-then-audit
shape, the same error-code-to-HTTP-status table — and stays its own file rather than becoming a
shared helper. `decision-listener.ts` is gateway-neutral, used by both identity and endpoint; a
rationale listener has exactly one caller that will ever exist, since the endpoint gateway has no
`RationaleWorkflow` to route to at all. Generalizing a two-line difference for one caller would be
the premature abstraction this project's own conventions argue against elsewhere (see
`@helpdesk/handoff-core`'s own header comment for the same argument made about `ApprovalWorkflow`).
When no `ANTHROPIC_API_KEY` is configured, the gateway still serves the path — a plain 503
`not_configured`, not a listener that would throw on its first real request.

## Identity agent notes

The agent is one file, `packages/agent/src/identity-agent.ts`, running on the Claude Agent SDK
with every built in tool turned off and the allowed tool list naming exactly the four gateway
tools, so that nothing runs unless it is explicitly named rather than everything running unless
explicitly turned off. Through Stage A the gateway ran as a subprocess this file spawned and
located by resolving the gateway package's own `package.json`, never imported directly. As of
Stage B there is no subprocess: the gateway is a long-running HTTP server, and this file connects
to it as an ordinary MCP-over-HTTP client, minting its own bearer token first
(`CertificateCredential`, scoped to `IDENTITY_GATEWAY_AUDIENCE`, the one runtime import this
package takes from the gateway package — see that package's `index.ts` for why this specific
class is safe to share) and sending `x-actor`/`x-request-id` as headers the model never sees or
sets. The agent writes its own `request` and `no_tool_called` audit records, using the shared
audit package described above, since it is the only process positioned to see whether the model
ever called a tool and what it said if it did not. As of SPRINT3.md 3.1, it also writes a
`model_usage` record for its own turn — from the SDK result message's `modelUsage`, one record
per model named there (almost always exactly one) — every time a session ends, whether or not it
called a tool: usage is a property of the model call, not of what the call decided to do.
`mdm-agent.ts` is identical in this respect; see its own header comment for why the two files
still don't share the code that does it.

## Triage and orchestration notes

`packages/agent/src/triage.ts` and `orchestrator.ts` are SPRINT3.md 3.1: the seam Sprint 1 and
Sprint 2 left as a placeholder function, now real. Every request the web app receives goes through
`routeRequest()` (`orchestrator.ts`) before either agent ever sees it.

`triage.ts` is a single, isolated Messages API call, structurally identical to the approval
rationale generator (`rationale.ts`, above): no tools, no loop, no memory, a frozen system prompt,
and the raw request text as the only user turn. Its output is one value from a closed set —
`identity`, `mdm`, `knowledge` (added SPRINT3.md 3.3), `endpoint` (added 3.4), or the explicit
`unsupported` (the policy engine's own "everything not matched is denied" philosophy applied to
routing) — parsed from a JSON text reply and validated against that closed set with zod; anything
else (bad JSON, a category outside the set, a failed or incomplete API call) is a `TriageError`,
never a guess. It uses `claude-haiku-4-5-20251001` by default, deliberately the cheapest model in
the family: this call runs once per request, not once per approval, and 3.5's cost dashboard is
meant to show that most decisions in this system cost nothing at all — a triage call that itself
costs real money on every single request would sit oddly next to that claim if it used a larger
model for no benefit a three-word classification needs.

**`endpoint` covers two things that do not obviously belong together, and the system prompt says
so rather than hiding it.** The stub fleet of devices and printers is the obvious half; every
password reset request is the other, for every user, regardless of wording. That pairing is not
an artifact of triage's own design — SPRINT3.md's own structure has always nested password reset
under "the endpoint agent," in 3.4 as much as in its original plan — but it matters more now than
it would have under the original plan, because the *reason* to route a reset request to the
endpoint agent changed. It used to be so that agent could execute an approval-gated Graph write.
Now it is so that agent, and only that agent, can tell the requester about self-service reset and
their manager: classifying a reset request as `unsupported` instead would reach the same practical
outcome — nothing happens — but silently, with none of that guidance and no rule name in the
audit log (see "Endpoint gateway notes" below). Getting this routing decision right is what makes
the rest of the redesign actually reachable, not just correct in isolation.

**Sprint 4 prep: `unsupported` narrowed to genuinely non-IT requests, `knowledge` widened to
everything else IT supports.** The 150-ticket simulation run found 41 "unsupported" outcomes, and
reading them showed the category had been doing two different jobs under one name: correctly
declining real non-IT questions (a broken coffee machine, a nephew's job application, a landlord's
email), and incorrectly declining ordinary workplace IT questions the knowledge agent was never
given a chance to answer — "how do I share a OneDrive folder," "how do you pin a message in
Teams," "what's the difference between OneDrive and SharePoint." `knowledge`'s own definition had
scoped it to "identity or device management" specifically, so anything IT-shaped but outside that
narrower pair fell through to `unsupported` by default, regardless of whether the corpus might
actually cover it. The category boundary now matches the real line that matters: `unsupported` is
for requests that are not an IT matter at all (facilities, HR, a personal device or account with
no work connection, a family member's own issue, a delivery question), and every other IT how-to
question — whether or not today's Entra/Intune-only corpus happens to cover it — is `knowledge`'s
to attempt and decline honestly if it cannot answer, the same "say what you don't know" discipline
the knowledge agent already had. This is a change to what the two categories mean, not to the
routing mechanism or the category set itself — still the same five values, still a single isolated
classification call with no memory or extracted parameters.

Triage's output deliberately carries no extracted parameters, even though SPRINT3.md's own text
originally described it that way — that line has since been corrected to match (see SPRINT3.md,
3.1). The reasoning: an unused field is a field that gets used later. Today
triage's output is a bare category name that nothing downstream can act on beyond picking which
agent runs, which is exactly what makes "an injection here can at most mis-route" a fact about the
code rather than a hope about how it will always be used. The instant some future change reads an
extracted parameter — say, to pre-fill a tool argument — triage stops being outside the system's
trust boundary and starts being inside it, and the sentence above stops being true. The raw request
text is not lost by leaving it out: the orchestrator audits it verbatim under the same `requestId`
regardless of outcome, and the agent that actually gets invoked extracts whatever it needs from
that same text itself, through its own tools, the same as it always has.

**`partiallyOutOfScope`, added in SPRINT3.md 3.3, is the one change to that contract, and it is
deliberately not a second exception to it.** Phase 3.1's own live run (see below) found that a
single-category classifier silently drops the half of a mixed-domain ticket it doesn't pick —
"my laptop is slow and also am I in finance" came back `unsupported` for the whole message, with
the answerable "am I in finance" half never reaching an agent at all. The fix is one boolean
alongside the category, `true` when the classifier believes part of the request falls outside
whichever category it chose. Nothing downstream reads it to decide anything: `orchestrator.ts`
turns it into a fixed sentence (`PARTIAL_SCOPE_NOTE`) appended to the reply, and that is the only
place it is ever consulted, whether the underlying classification landed on `routed` or
`unsupported`. That is what keeps this from being the extracted-parameter problem in disguise —
the field carries no data that changes which agent runs, what tool gets called, or what argument
it gets called with; its only effect is on text a human reads afterward. A flag that only changes
what the user is told does not weaken "triage stays outside the trust boundary," and it turns a
silent loss into a visible one: the user now knows to send the dropped half as its own request,
rather than assuming the system understood all of what they asked.

`orchestrator.ts` calls triage, then writes exactly one routing-decision record to its own audit
chain (`orchestrator-audit.ts`, `data/orchestrator.db` by default) before invoking anything — the
same audit-before-action ordering every other component in this system already follows. A
successful classification into `identity`, `mdm`, `knowledge` or `endpoint` is a `routed` record
naming the category and the agent invoked; an explicit `unsupported` classification or a failed
classification call is a
`denied` record, tagged `triage.unsupported`, `triage.invalid_output`, or `triage.request_failed`
depending on which of those three actually happened, so a reviewer can tell "triage said no" apart
from "triage broke" without reading code. Triage's own token usage is recorded here too, as a
`model_usage` record, alongside the routing decision — never on the invoked agent's own chain,
which agents write to themselves for their own turn.

This is a third audit chain, not a fourth kind of thing bolted onto an existing one — same
reasoning as Sprint 2's two separate gateway chains (Component 6, "a compromise of one cannot
rewrite the other's history"): the orchestration layer sees every request before any agent does,
so its own record of what it decided must live somewhere neither agent's chain could be used to
rewrite. A request that gets routed spans two files (the orchestrator's own, and whichever agent's
it dispatched to), correlated by the shared `requestId`, the same merge-by-`requestId` answer
Sprint 2 already gave for the two gateways' chains, not a merged table.

Triage holds nothing worth stealing: no gateway, no Entra registration, no tools, and the only
credential anywhere near it is the `ANTHROPIC_API_KEY` the classification call itself needs — which
is why, as of this phase, that key is no longer optional the way it is for the rationale generator.
Without it, `routeRequest()` cannot classify anything, and every request through the web app fails
closed as `triage_failed`, audited under `triage.request_failed`, rather than falling back to
guessing or skipping straight to an agent.

## Web app notes

Three server rendered pages on plain `node:http`, no framework and no build step for the UI: the
request form, the operator console (SPRINT4.md, section 3 — see "Operator console notes" below),
and the dashboard. Every value that ever came from a user, an agent, or a model is passed through
an HTML escaping function before it reaches a page. Route handling logic is written as plain
functions independent of HTTP and tested without starting a server; the HTTP layer itself is a
thin routing and body parsing wrapper, tested separately against a real server on an ephemeral
port. A missing rationale is rendered as an explicit sentence, never as a blank section. As of
Stage B this package holds no Graph credential: `decideApproval()` (now in `console-page.ts`,
originally `approvals-page.ts` before SPRINT4.md, section 3 folded that page in) is unchanged in
substance — it still just calls `deps.decide(input)` and catches `ApprovalError` — but `web.ts`'s
composition root now backs `decide` with an HTTP call to a gateway's decision endpoint rather than
an in-process `ApprovalWorkflow`, reconstructing an `ApprovalError` from the gateway's JSON error
response so that unchanged catch block keeps working. `ApprovalStore` stays a direct read against
the shared SQLite file for listing and displaying approvals — a read needs no credential and was
never the gap Stage B closes.

**SPRINT3.md, 3.4: `decide`, `listPendingApprovals` and `getApproval` now read and act across two
gateways, not one, and the page-rendering layer and `server.ts` needed zero changes to make that
true.** Both already depended only on the injected `WebDeps` functions, never on how many sources
backed them — the same decoupling `request-page.ts` already used for the orchestrator's result
shape. All of the new work is in `bin/web.ts`'s composition root: a second `ApprovalStore` reads
the endpoint gateway's own SQLite file (`ENDPOINT_HELPDESK_DB_PATH`, default
`data/endpoint-helpdesk.db`), a second `CertificateCredential` reuses the endpoint agent's own
app registration the same way the first already reused the identity agent's, and
`listPendingApprovals()` merges both stores' pending lists, sorted by `createdAt`, rather than
picking one. `getApproval()` and `decide()` both try each gateway's store in turn to find which
one actually holds a given approval id — ids are UUIDs, so a collision that would make this
ambiguous is not a real possibility — and `decide()` only reaches whichever gateway's own decision
endpoint actually owns that record, authenticated with that gateway's own credential. Each
gateway's approvals still live in its own database and its own audit chain, never merged
(SPRINT2.md, Component 6): this file is the one place that reads both, the same way it was
already the one place that reached the single gateway before this phase.

As of SPRINT3.md 3.1, `web.ts`'s composition root wires `routeRequest()` (`@helpdesk/agent`) in
place of calling `runIdentityAgent()` directly — the one line in this package that changed for
triage. `request-page.ts`'s own types (`RouteResult`, `SubmitRequestDeps`) mirror the
orchestrator's result shape structurally rather than importing it, the same deliberate decoupling
this file already used for the single-agent result before triage existed. The request page now
renders three additional outcomes beyond the original "ok" (renamed `routed`) and error/invalid
cases: `unsupported` (an honest, calm `.info` block, not styled as an error — a request the system
has no capability for is not a failure of anything) and `triage_failed` (styled as an error, since
it means the classification call itself did not complete). A routed reply also now names which
agent handled it, for the same transparency reason the audit trail names it.

As of SPRINT3.md 3.3, `RouteResult`'s category union gained `"knowledge"` (no other change to the
type was needed — the knowledge agent's reply renders through the same `routed` path as the other
two), and both the `routed` and `unsupported` variants gained an optional `note`, rendered by a
small `renderNote()` helper as an italic, muted line under the main reply whenever
`partiallyOutOfScope` was true. It is deliberately styled to look like an aside, not a warning:
the request still succeeded (or was still correctly refused) on its own terms, and the note is
informing the user of a second, separate thing, not qualifying the first. As of 3.4, the category
union gained `"endpoint"` the same way — the endpoint agent's reply, whether it lists devices,
creates a pending reboot approval, or relays `reset_password`'s refusal, renders through that same
unchanged `routed` path.

## Operator console notes

`console-page.ts` + `console-data.ts` (SPRINT4.md, section 3) replace `approvals-page.ts`
outright — deleted, not left running alongside a second page that overlaps it. One page, two
queues: pending approvals and active (open or taken) handoffs, each read live from its own store
on every render, the same "this page's own render is the verification" discipline
`dashboard-page.ts` already established (SPRINT3.md, 3.5).

**A queue row is built to be triaged without opening it.** `console-data.ts`'s `approvalRow()` /
`handoffRow()` reduce an `ApprovalRecord` or a `HandoffRecord` to the same small shape — age,
requester, a one-line summary, what action it needs — without forcing the two record types
themselves together. `summarizeApproval()` builds an approval's summary from its tool and
parameters (an `ApprovalRecord` carries no raw request text of its own); a handoff's summary is
its own `requestText`, truncated. `sortByAge()` orders each queue oldest-first, since age is the
number an operator acts on, not a timestamp they have to do arithmetic on — the same reasoning
that moved `formatDuration()` out of `dashboard-page.ts` and into `html.ts` so this page could
share it rather than duplicate it. The single oldest row in each queue gets its own CSS class
(`age oldest`), bold and amber, not the page's existing red — it should read as the thing to look
at first, not as something broken.

**An approval and a handoff are different kinds of work, and stay two render functions sharing
parts, not one function branching on kind.** `renderApprovalDetail()` and `renderHandoffDetail()`
both read top to bottom in the order SPRINT4.md specifies — raw request, what the system did and
why, what it could not do, then the actions — and both call the same `renderTrail()` /
`renderRawRequest()` helpers for the first two sections. Past that they diverge on purpose: an
approval's "what it could not do" is a fixed sentence (every group and device change needs a human
decision regardless of target — the normal, gated outcome, not a partial failure) and its actions
are approve/reject, note required either way. A handoff's "what it could not do" is its own
`reason`, verbatim — a model's or the orchestrator's account of why a person is needed — and its
actions are take (no note; an operator starting work has nothing yet to say) then resolve (note
required), the same two-step, one-note-required shape `HandoffStore` itself enforces. Bending
either render path to also fit the other's shape would have meant fields on the page that mean
nothing for one of its two cases — the same trade `@helpdesk/handoff-core` itself already declined
when it stayed off `ApprovalStore`/`ApprovalWorkflow` (see "Handoff core notes" above).

**The trail: "what the system did and why," read by request id, never a merged table.**
`console-data.ts`'s `getRequestTrail()` takes every chain's own read-only `AuditLog` and returns
every record carrying a given `requestId`, across all five chains, oldest first — the same
correlate-by-request-id-at-read-time discipline the dashboard already uses (SPRINT2.md, Component
6: the chains themselves are never merged). `rawRequestText()` reads the actual request text back
out of whichever record in that trail carries it — a `request` record's own `parameters` for an
approval's request, or a `routed`/`denied`/`handoff` record's `parameters.requestText` — rather
than reconstructing or re-typing it; a handoff needs no such lookup, since `HandoffRecord` already
carries its own `requestText` verbatim.

**Taking and resolving a handoff calls `HandoffStore` directly — no gateway, no HTTP, no
credential.** `bin/web.ts` opens one `HandoffStore` per chain, each sharing that chain's own
already-open db connection and `AuditLog` (the same sharing `ApprovalStore` and the dashboard's own
`AuditLog`s already do). This is the direct consequence of "Handoff core notes" above: resolving a
handoff is a human doing work entirely outside this system, so unlike an approval decision — which
must reach the owning gateway's own backend over HTTP, authenticated with that gateway's own
credential — there is no external system for this process to call into. `takeHandoff()` /
`resolveHandoff()` on the `WebDeps` interface are plain synchronous functions for exactly this
reason; `decide` stays the one `async` action on that interface, because it is the one action that
still crosses a process boundary.

**SPRINT4.md, section 4: the rationale control is built, on the opened approval, and it is where
generation happens now — not at creation time.** `renderRationale()` renders one of four states
from an `ApprovalRecord` alone: the generated text (unchanged styling); "No briefing has been
requested," with a form, while pending and the tool is one the generator can address; "No briefing
was requested before this was decided," no form, once decided; "This approval's gateway does not
generate a briefing," no form, for a tool outside the generator's scope. See "Approval store and
rationale notes" above for the backend side of this (`RationaleWorkflow`, `rationale_requested`,
`POST /approvals/rationale`) — this section covers only what changed in the console itself.

**The one JavaScript on this page, and why it exists.** Generation is a real Messages API call and
takes real seconds; nothing rendered server-side can acknowledge a click before the response it
produced comes back, because there is nothing to render until that response exists. Every other
control on this console (decide, take, resolve) is a plain `<form method="post">` with no such
problem, since each of those finishes fast enough that the browser's own between-pages loading
state reads as immediate. A multi-second wait behind an unchanged button is exactly what SPRINT4.md
asked not to leave an approver looking at ("a state between pressed and answered that does not
leave the operator wondering whether the click landed"), and no server-only mechanism can close
that gap — the gap is between the click and the request even reaching the server. `renderRationale()`
answers this with eleven lines of inline, vanilla script, scoped to exactly the one form that needs
it: on submit, disable the button and relabel it "Generating briefing… (a few seconds)." This is
the console's only departure from "no framework, no build pipeline for the UI" (SPRINT1.md,
Component 6), and it is a narrow one on purpose — no library, no bundler, nothing to build; a
single `addEventListener` next to the one form it affects, not a page-wide script or a shared
helper other forms opt into. It degrades honestly: with JavaScript unavailable, the form still
posts normally and the briefing still generates, just without the interim reassurance — the same
experience the page's other three forms already have today, not a broken one.

**Why generation stayed synchronous rather than becoming a background job with its own "pending"
state.** A `<meta http-equiv="refresh">` or a poll-until-done page could also show progress without
JavaScript, and was considered — but it does not actually solve the problem stated above: the
approver still sees an unchanged button for the entire first round trip before any "generating" page
could render at all, since that page is itself a response to a POST. Closing the real gap — between
the click and any visible acknowledgment of it — needs something that runs at the moment of the
click, with no network round trip, which only a client-side script can do. Given that, keeping
generation synchronous (the same shape `ApprovalWorkflow.decide()` already has: one request, one
response, no persisted "in flight" state to reconcile after a crash or a restart) was the simpler
choice once the script was already doing the real work.

**Two console fixes, found from a screenshot of the console in actual use.** Both are presentation
only — nothing about what is stored in a record changed, only how the trail renders it.

*The trail's Result column no longer cuts a value off mid-JSON.* Before, `renderTrail()` truncated
a long result to 80 characters with an ellipsis and relied on the page's own width to wrap it — but
`th`/`td` carried no wrapping rule at all, so an unbroken JSON string simply pushed the table wider
than the page rather than wrapping, and the ellipsis itself did nothing to stop that. `trailResultCell()`
now shows a short result in full, inline; a long one goes behind a native `<details>`/`<summary>`
disclosure — a preview visible immediately, the complete value, pretty-printed, one click away,
plain HTML, no script. Getting the table to actually respect the page's width took two more
pieces: `th, td { overflow-wrap: break-word; }` in `html.ts` (not `overflow-wrap: anywhere`, tried
first and reverted — `anywhere` also lowers a cell's *minimum* content width, which starved the
narrow columns and broke short words like "orchestrator" into three lines for no reason), and a
`.trail` class with fixed, explicit column-width percentages, because table auto-layout sizes a
column from its content's preferred width *before* any wrapping rule is applied — a long value
in one cell can still widen the whole table past its container even with wrapping turned on,
unless the columns are told their shares up front.

*The trail's Agent column no longer mixes a name and a GUID.* The same real actor was rendering two
ways: an agent process names itself literally ("identity-agent") on the records it writes directly
(`request`, `model_usage`, …), but a record the *gateway* writes in response to that same process's
own authenticated tool call carries the bearer token's client id instead (`session.agent`,
gateway-core/session.ts's `extra.authInfo?.clientId`) — a GUID, not a name. `agentNamesByChain()`
resolves this for display only, within one opened item's own trail: any literal name already
present on a chain stands in for every GUID on that same chain, and the GUID stays available as a
`title` attribute rather than being thrown away, exactly as asked — never rewriting what a record
actually says.

![The trail after both fixes: no GUID visible anywhere, every result contained inside the page, a long one behind a disclosure triangle](../evidence/console-fix-trail.png)

## Knowledge gateway notes

The knowledge gateway (`packages/knowledge-gateway`, SPRINT3.md 3.3) is `@helpdesk/gateway-core`'s
no-credential, no-backend-client case made real rather than hypothetical. `env.ts` asks for
`AZURE_TENANT_ID` and `KNOWLEDGE_GATEWAY_AUDIENCE` and nothing else — no client id, no
certificate, no thumbprint, because there is no credential for this gateway to hold. `bin/gateway.ts`
imports no `CertificateCredential` and no `GraphClient` at all, not merely leaves them unused: the
absence is structural, not a runtime choice. It exposes exactly one tool, `search_documentation`,
autonomous (`policy/decide.ts` has a single rule, `AutonomousSearchDocumentation`, and nothing to
gate behind an approval, since there is nothing here that changes state). `tools/handler.ts`'s
`execute()` is a plain callback into a local lexical index — the same seam `runToolCall()` already
generalized in 3.2 for a Graph call, unchanged for this gateway's very different kind of backend.

**The corpus.** Microsoft Learn documentation for Entra and Intune, vendored verbatim as Markdown
at a pinned commit from the same public repositories Microsoft Learn itself publishes from, so an
answer can always be traced back to an exact, reproducible version of its source:

| Source | Repository | Commit | Path prefix | Files vendored |
|---|---|---|---|---|
| Entra | `MicrosoftDocs/entra-docs` | [`a37c43a`](https://github.com/MicrosoftDocs/entra-docs/tree/a37c43ae5c2494cfc4211bb6242eb3151de6e40e) | `docs/` | 8 articles: *What is Microsoft Entra?*, *Learn About Groups, Group Membership, and Access*, *How to manage groups*, *Understand Microsoft Entra role concepts*, *Manage Microsoft Entra user roles*, *Build Conditional Access policies in Microsoft Entra*, *Conditional Access Setup: Users, Groups, Agents, and Workload Identities*, *What are Microsoft Entra registered devices?* |
| Intune | `MicrosoftDocs/memdocs` | [`4b5429d`](https://github.com/MicrosoftDocs/memdocs/tree/4b5429df8b47046c6b251e572ee61199fb5d4a5d) | `intune/` | 5 articles: *Get started with Microsoft Intune*, *Microsoft Intune core concepts*, *Step 5 – Enroll devices in Microsoft Intune*, *Device compliance policies in Microsoft Intune*, *Create device compliance policies in Microsoft Intune* |

Both are checked into `corpus/raw/<entra|intune>/`, read from disk once at process startup
(`corpus.ts`'s `loadCorpus()`) and never fetched again — this gateway has no network access to
fetch them with even if it wanted to.

**Sprint 4 prep: the corpus is a folder contract, not a hardcoded list.** Before this, the exact
commit and repo path prefix per source lived in a `SOURCES` array inside `corpus.ts` itself, so
adding a third product meant a code change to that file. `corpus.ts` no longer names "entra" or
"intune" anywhere: `loadCorpus()` discovers whatever subdirectories exist under `corpus/raw/`
(`listProductDirs()`) and reads each one's own `manifest.json` — the same four fields the old
`SOURCES` entries carried, now data instead of code:

```json
{
  "product": "entra",
  "repo": "MicrosoftDocs/entra-docs",
  "commit": "a37c43ae5c2494cfc4211bb6242eb3151de6e40e",
  "files": { "what-is-entra.md": "docs/fundamentals/what-is-entra.md", "...": "..." },
  "license": "CC-BY-4.0 (content) / MIT (code samples) — see this section for the full nuance"
}
```

(`files` used to be one shared `repoPathPrefix` string; see the Sprint 4 prep finding below for why
that changed and what it cost before it did.)

Widening coverage to a new product is a directory drop, not a code change: create
`corpus/raw/<product>/`, add its `manifest.json` and its vendored Markdown, and run
`pnpm knowledge-reindex` (`bin/reindex.ts`) to confirm it was picked up — the command reports each
product's file and chunk counts, or fails loudly, naming the exact directory, if a manifest is
missing or malformed. A directory present under `corpus/raw/` with no manifest is treated as a
malformed product folder, not an absent one, and `loadCorpus()` throws rather than silently
indexing nothing for it — the same "fail loudly on the unexpected" discipline this project already
applies to the simulation ticket loader. There is no persisted index file anywhere: the corpus is
small enough that every gateway process already rebuilds it from these same files at its own
startup, so `knowledge-reindex` does that same rebuild on demand, on a schedule a maintainer
controls, rather than needing to start the whole gateway to find out whether a new directory is
well-formed. Reindexing is deliberately a command, not a button in the admin panel: a refresh
control in the UI would be a write action, and would need to go through the policy engine and the
audit log like every other write in this project does — a later piece of work, not this one.
`sourceUrl` on every chunk is built the same way as before, from whichever manifest its directory
carries, so it still points at the exact file and commit it came from, not just a document title.

**Sprint 4 prep: the corpus widened, and half of what was asked for could not be — checked, not
assumed.** Before any vendoring code ran, every candidate product's public source repo was checked
with the same two-part method: a direct GitHub API repository lookup (`GET /repos/<owner>/<repo>`,
which does not depend on branch name) and a repository-name search, both from this machine, on
2026-09-25. The result:

- `MicrosoftDocs/OfficeDocs-SharePoint` (SharePoint + OneDrive for Business) — 404 from the API,
  absent from repo search; the only public trace left is a third-party fork,
  `magafaterr/OfficeDocs-SharePoint`, last updated 2018.
- `MicrosoftDocs/OfficeDocs-SkypeForBusiness` (Teams) — same result; the only public trace is
  `TomSpeijer/OfficeDocs-SkypeForBusiness`, last updated 2017.
- `MicrosoftDocs/windows-itpro-docs` (Windows client IT-pro docs — device policy, OS updates) —
  same result; the only public traces are forks from 2016–2022.
- Outlook end-user content is not published to GitHub at all; the admin side is Exchange Online,
  whose own docs repo is likewise unreachable by the same check.

All four clearly were public once — that is what the surviving forks prove — and are not now, by
the same check that confirms `entra-docs` and `memdocs` (this project's two existing sources) still
are. **This is a real gap, not a stylistic one, and it costs real coverage:** a meaningful share of
actual helpdesk volume is exactly these products' end-user questions, and there is currently no
public, pinned-commit source this project's own citation model can vendor for any of them. Rather
than substitute an unofficial or stale source — which would break the property that every answer
traces to a reproducible, currently-maintained version of its source — this is recorded as an open
gap, to revisit if or when Microsoft republishes rather than papered over with a fork or a
substitute product.

What widened instead, because it checked out as genuinely current and public:

| Source | Repository | Commit | Path prefix | Files vendored |
|---|---|---|---|---|
| Microsoft 365 admin — user management | `MicrosoftDocs/microsoft-365-docs` | [`eab9d76`](https://github.com/MicrosoftDocs/microsoft-365-docs/tree/eab9d7696cdff87474698b08a1fb328091102a2f) | `microsoft-365/admin/add-users` | 5 articles: *Add users and assign licenses in Microsoft 365*, *Delete a user from your organization*, *Reset passwords*, *Let users reset their own passwords*, *Assign admin roles in the Microsoft 365 admin center* |
| Microsoft 365 admin — licensing & app deployment | `MicrosoftDocs/microsoft-365-docs` | [`eab9d76`](https://github.com/MicrosoftDocs/microsoft-365-docs/tree/eab9d7696cdff87474698b08a1fb328091102a2f) | `microsoft-365/admin/manage` | 3 articles: *Assign or unassign licenses for users in the Microsoft 365 admin center*, *Assign or unassign licenses to a group in the Microsoft 365 admin center*, *Requirements to use centralized deployment for Office Add-ins* |
| Intune — Windows Update rings | `MicrosoftDocs/memdocs` | [`4b5429d`](https://github.com/MicrosoftDocs/memdocs/tree/4b5429df8b47046c6b251e572ee61199fb5d4a5d) | `intune/device-updates/windows` | *Manage Windows Update Ring Policies* |
| Intune — compliance | `MicrosoftDocs/memdocs` | [`4b5429d`](https://github.com/MicrosoftDocs/memdocs/tree/4b5429df8b47046c6b251e572ee61199fb5d4a5d) | `intune/device-security/compliance` | *Configure compliance policies with actions for noncompliance in Microsoft Intune* |
| Intune — enrollment | `MicrosoftDocs/memdocs` | [`4b5429d`](https://github.com/MicrosoftDocs/memdocs/tree/4b5429df8b47046c6b251e572ee61199fb5d4a5d) | `intune/device-enrollment` | *Overview of enrollment restrictions* |
| Intune — device configuration | `MicrosoftDocs/memdocs` | [`4b5429d`](https://github.com/MicrosoftDocs/memdocs/tree/4b5429df8b47046c6b251e572ee61199fb5d4a5d) | `intune/device-configuration` | *Device features and settings in Microsoft Intune* |

Four of these six sit in their own small product directory rather than folded into the existing
`intune` or new `microsoft365` ones. Splitting was the safe default at the moment they were
vendored — Microsoft's own restructuring means "device configuration," "compliance," "enrollment,"
and "Windows Update rings" content all live under different real subfolders of `memdocs`
(`intune/device-configuration/`, `intune/device-security/compliance/`, `intune/device-enrollment/`,
`intune/device-updates/windows/` respectively), not one shared path, and the manifest schema at the
time (`repoPathPrefix`, a single string) could only be correct for a directory if every file in it
shared one real parent folder. The directories stayed split after the schema was fixed (below) —
there was no reason to re-merge working, correctly-cited directories — but the fix means a future
addition does not have to split for this reason: one product directory can now vendor files from
several real subfolders of the same repo and still cite every one of them correctly.

**A pre-existing defect this widening surfaced — and fixed, not just flagged.** Checking why a
multi-subfolder `intune/` directory would break citations also meant checking whether the
*existing* `entra` and `intune` directories' own citation links already resolved, since both had
been vendored as one flat directory each, on the same `repoPathPrefix` scheme the new content was
about to strain further. They did not. `entra`'s manifest built
`docs/concept-conditional-access-policies.md` from `repoPathPrefix: "docs"`, and that URL 404ed —
the file actually lives at `docs/identity/conditional-access/concept-conditional-access-policies.md`
in `entra-docs`. `intune`'s manifest built `intune/core-concepts.md`, which 404ed the same way — the
real path is `intune/fundamentals/core-concepts.md`. Both of Sprint 3.3's original corpus
directories had been mixing files from more than one real subfolder under a single flat
`repoPathPrefix` since the commit that shipped them; the defect was not introduced by this
widening, only found by applying the same check to old content that was about to be applied to new
content anyway. Retrieval itself was never affected — nothing in `search.ts` or the agent fetches
`sourceUrl`, only stores and returns it — but a reader who clicked a citation on some of the
original 13 answered questions had been reaching a 404, not the source, since Sprint 3.3 closed.

The fix has two parts, both shipped in this same pass, not deferred:

1. **The schema changed.** `CorpusManifest.repoPathPrefix` (one string per directory) became
   `CorpusManifest.files` (`Record<localFileName, exactRepoPath>`, one entry per file — see
   `corpus.ts`'s own header comment on the type). `loadCorpus()` now refuses to index a directory
   at all if any `.md` file on disk has no `files` entry, or any `files` entry names a file that
   is not on disk — a mismatch that a shared prefix could never detect (a prefix is either right
   or wrong for everything at once; a missing or stale per-file entry is a specific, nameable
   error) is now caught the same way a malformed `manifest.json` already was: loudly, at load
   time, naming exactly which file. `entra`'s and `intune`'s manifests were corrected against the
   real paths above; every other manifest in this widening was built directly against a verified
   per-file path from the start.
2. **A command re-resolves every citation, so this cannot silently rot again.** `pnpm
   knowledge-verify-citations` (`bin/verify-citations.ts`) loads the corpus, takes every distinct
   `sourceUrl` it produces, and requests each one from GitHub directly — not a sample, and not a
   trust in the manifest that built the URL, the same posture `prove-isolation` takes toward a
   Graph permission grant rather than trusting it was configured correctly. A 404 fails the run.
   A transient 5xx or network error is retried a few times before being treated as one, since a
   verification command that reports transient noise as a broken citation trains its own reader
   to stop trusting it — confirmed necessary, not theoretical: GitHub returned a real 503 for one
   genuinely correct citation on this script's own first run. Run against the corpus as it stands
   after this widening: **all 25 distinct citations resolve** — committed at
   `evidence/knowledge-corpus-citations.txt`.

After the widening: 8 product directories, 25 files, 300 chunks (`pnpm knowledge-reindex`):

```
product              files  repo@commit                                license
-------              -----  -----------                                -------
entra                    8  MicrosoftDocs/entra-docs@a37c43a            CC-BY-4.0 / MIT
intune                   5  MicrosoftDocs/memdocs@4b5429d               CC-BY-4.0 / MIT
intune-compliance        1  MicrosoftDocs/memdocs@4b5429d               CC-BY-4.0 / MIT
intune-deviceconfig      1  MicrosoftDocs/memdocs@4b5429d               CC-BY-4.0 / MIT
intune-enrollment        1  MicrosoftDocs/memdocs@4b5429d               CC-BY-4.0 / MIT
intune-updates           1  MicrosoftDocs/memdocs@4b5429d               CC-BY-4.0 / MIT
microsoft365             5  MicrosoftDocs/microsoft-365-docs@eab9d76    CC-BY-4.0 / MIT
microsoft365apps         3  MicrosoftDocs/microsoft-365-docs@eab9d76    CC-BY-4.0 / MIT
```

**Re-running the 13-question retrieval set (`search.test.ts`) against the widened corpus: all 12
originally-passing questions and the Surface-return-policy "I don't know" check are unchanged** —
the new content did not bump any correct top hit and did not create new lexical noise for the
unrelated question. One result did move, and it is the interesting one. Question 14 (VPN profiles,
`questions.md`) was originally a "should say I don't know" case because the corpus held nothing
about device configuration at all; it now retrieves a real, on-topic passage —
`intune-deviceconfig/overview.md`'s own "VPN" section, vendored for an unrelated reason (a general
device-configuration overview, not a VPN-specific article), states plainly that VPN profiles exist
and that iOS/iPadOS is a supported platform. It does not contain the actual configuration steps,
which live in a separate, unvendored article the overview links out to. The honest answer this
corpus supports changed from a flat "I don't know" to a genuine partial answer — coverage improved
with no precision cost on this question. `search.test.ts`'s case for Q14 and `questions.md`'s own
entry were both updated to record this, the same way both were already updated once before, for Q8
and Q15, when Sprint 3.3's first real run disagreed with what was guessed before running it. This
is the concrete version of the risk a wider corpus was always expected to carry — it can cost
precision as well as buy recall — checked here rather than assumed, and on this pass it did neither
on the original 13 and genuinely helped on the 14th.

**Licenses.** Both repositories grant the same two licenses over two different kinds of content,
stated in each repo's own `ThirdPartyNotices.md` under "Legal Notices": the documentation and
other content is licensed under the [Creative Commons Attribution 4.0 International Public
License](https://creativecommons.org/licenses/by/4.0/legalcode) (each repo's own `LICENSE` file),
and any code sample within that content is separately licensed under the [MIT
License](https://opensource.org/licenses/MIT) (`LICENSE-CODE`). One discrepancy worth recording
rather than quietly smoothing over: `entra-docs`'s own `LICENSE` file is, on its face, worded as a
plain MIT license, not CC-BY-4.0 text the way `memdocs`'s `LICENSE` file actually is — but
`entra-docs`'s `ThirdPartyNotices.md` states the same CC-BY-4.0-for-content, MIT-for-code split as
`memdocs` does, in the same words, and that "Legal Notices" section is the more specific and more
recently-templated statement of the two, so it is the one this project relies on. Neither
repository's content is reproduced beyond short passages returned by search and quoted in an
answer, and no code sample from either repository is used anywhere in this codebase. Per both
notices, Microsoft, Windows, Microsoft Entra, Intune and any other Microsoft trademark referenced
in the vendored documentation remain Microsoft's; this project claims no rights to them and this
section is not itself a trademark license.

**Retrieval is lexical only, per SPRINT3.md's own instruction to try that first and stop there if
it works — and the honest result needs the adjustment made to it spelled out, not just the final
count.** `packages/knowledge-gateway/questions.md` was written and committed before `search.ts`
existed — 13 real questions the corpus should answer, each naming the source document and heading
a correct answer should cite, checked by hand against the downloaded files, plus 2 questions the
agent should honestly refuse. `search.ts` is a hand-rolled BM25 ranker (k1=1.5, b=0.75) with
English stopword filtering, chunked by Markdown heading (`corpus.ts`'s `chunkDocument()` — every
heading line, any level, starts a new chunk, so a match inside a specific subsection cites that
subsection, not just the document title).

The first run of `search.test.ts` against the real, loaded corpus — with the original test file,
unedited, asserting exactly what `questions.md` originally committed to — failed two checks, not
zero. **"What are Intune's three pillars?"** was originally required to retrieve a chunk headed
exactly "The three pillars," matching `questions.md`'s own original citation; the real corpus
returned the article's introduction instead (headed by the document's own title), because the
introduction states all three pillar names densely in one paragraph and the "three pillars"
section below it is mostly a table. In response, both files were edited: `questions.md`'s Q8 entry
was rewritten to accept the introduction as "the better citation in practice," and the test was
removed from the strict top-heading-match block and replaced with a new, separate test that checks
only the source document, not the heading. That is a real loosening of the bar for one of the 13,
made after it failed the original one — not a case of the original bar being met. The same first
run also failed the "should say I don't know" check for the unrelated Surface-return-policy
question (question 15, not one of the 13): originally asserted the search must return an empty
result set; the real corpus returned four non-empty results, because common corpus words
("Microsoft," "device," "policy") create genuine partial lexical overlap even for a clearly
unrelated query. That assertion was likewise loosened, from "empty" to "no result actually
discusses a return policy."

**The honest count, against the bar as each question originally committed to it, is 12 of 13, not
13.** The 9 questions checked by exact top-result-heading match, plus 3 more (registered-vs-enrolled
devices, what Entra is, assigning a role) whose looser "the right document appears in the results"
bar was written into the test from its first commit — before it was ever run — all passed
unedited on the first real run. Question 14 (a VPN-configuration question the corpus deliberately
does not cover) also passed unedited on the first run, with a bar that was also loose from the
first commit, not loosened afterward. Only question 8's citation and question 15's search-level
assertion were changed after seeing a real failure, and both changes are recorded above rather
than folded quietly into a clean pass. Whether 12 of 13 — one of them corrected mid-flight — still
counts as lexical search *not* "visibly failing," the threshold SPRINT3.md sets for building
embeddings, is a judgment call this document is not making unilaterally: the finding is recorded
here plainly so that call can be made with the real number, not a rounded-up one.

**The two rules for answers are enforced in the tool description, not just asked for in the system
prompt.** `tools/descriptions.ts` (reviewed the same way as every other gateway's tool
descriptions, with tests pinning the exact phrases that matter) tells the calling model, in the
tool's own description rather than only in the agent's system prompt: "you must not answer from
your own training instead," "say plainly that you don't know" when nothing relevant comes back,
that "an empty passages array is a normal, successful result," and to cite the `sourceTitle` and
`heading` "for every fact you state." Putting this on the tool description means it travels with
the tool itself, not with whichever agent happens to call it.

## Knowledge agent notes

`packages/agent/src/knowledge-agent.ts` mirrors `mdm-agent.ts` file for file: Agent SDK, every
built-in tool turned off, `allowedTools` naming exactly the one gateway tool
(`search_documentation`), its own `CertificateCredential` scoped to `KNOWLEDGE_GATEWAY_AUDIENCE`,
its own `request`/`no_tool_called`/`model_usage` audit records written the same way the other two
agents write theirs. The one structural difference worth naming: this agent's certificate is not
merely a separate credential from its own gateway's, the way the identity and MDM agents' are —
it is the *only* credential anywhere near the knowledge gateway, since the gateway itself holds
none at all. Its system prompt states plainly that it never claims to have performed an action,
changed anything, or looked anything up in the tenant, because it has no tool that could do any of
those things — the only tool it has reads a local, static corpus.

`knowledge-agent.test.ts` mirrors the other two agents' test suites, including the token-usage
`describe` block SPRINT3.md 3.1 asked be retrofitted everywhere — this agent was built after that
retrofit, so it has token-usage recording from its first commit rather than needing one added
later, the one agent in this project for which that is true.

## Endpoint gateway notes

SPRINT3.md's original plan for 3.4 was two backends: a real, approval-gated Graph integration for
resetting another user's password, and an openly fake stub for a device or printer service. Before
any code for this phase was written, the first half was replaced with something narrower: password
reset moved into the "never automated" action class (see "Action classes" above) instead of being
built at all. This section is the reasoning the project asked to be recorded here, plainly, rather
than left as an unexplained gap between what SPRINT3.md originally described and what actually
exists.

**Why a policy decision instead of a Graph integration.** A helpdesk agent that resets passwords
has to answer one question first: is the person asking who they say they are? This system has no
way to answer that question, and the reason is structural, not a missing feature that a better
prompt or a cleverer check would close. A remote-first organisation cannot verify identity over a
chat channel the way a receptionist can verify identity by looking at someone's badge — voice,
writing style, and a UPN in a form field are all things the *caller* controls, not things the
system can independently confirm. Helpdesk password reset over an unverified channel is also a
well documented social engineering path in its own right: an attacker who can produce a
plausible-sounding request has historically been enough to get a real helpdesk to reset a real
password, and an AI agent asked the same question is not in a better position to tell the
difference than the human analogue it replaces. Given that, the honest options are to pretend this
system can verify identity (it cannot), or to decline and say so. This project takes the second
option: the system declines rather than pretending it can verify who is asking.

**Why the refusal lives in the policy engine and not the system prompt.** A rule written into an
agent's system prompt is text the model reasons over, alongside everything else in the
conversation — it can be argued with, reframed, or simply outweighed by a sufficiently persistent
or well-constructed request, the same way any instruction given to a model in natural language
can be. A rule written into `policy/decide.ts` is code the model never sees and cannot address:
`Rule.DenyPasswordResetNeverAutomated` matches on the tool name alone, before any parameter is
inspected, and there is no branch anywhere that lets a decision go the other way. Putting it there
also means the refusal is auditable the same way every other decision in this system is — with a
named rule, on the record, before anything (or in this case, nothing) happens — rather than being
a sentence a model happened to produce that leaves no structured trace of the decision it embodies.

**What "not implemented as a tool" means precisely, since the phrase could be read two ways.**
`reset_password` *is* declared in `policy/schemas.ts`, discoverable in `tools/list`, and in the
endpoint agent's own `allowedTools` — it is not hidden from the model. What it is not is wired to
anything: `tools/handler.ts`'s `execute()` has no case for it at all, because `policy/decide.ts`'s
deny tier matches it unconditionally, before `execute()` is ever reached (see `tool-call.ts`'s call
order in "Gateway template notes" above — a `denied` decision returns before the autonomous branch
runs). No Graph permission for password operations was ever requested in this gateway's Entra app
registration, because there is no code anywhere that would use one. Making the tool discoverable
rather than omitting it entirely is what turns "the model tried to reset a password" into a
specific `deny.password_reset_never_automated` record instead of a generic `deny.unknown_tool` one,
or worse, a refusal the model invents on its own with no gateway involvement and nothing in the
audit log at all.

**What the requester is actually told.** Both the tool's own description and the policy engine's
`deniedMessageSuffix` say the same thing: this system never resets a password, for anyone, under
any circumstance; try Self-Service Password Reset first; if SSPR is not available, ask a manager.
The refusal points somewhere rather than just closing the door — a flat "no" with nowhere to go is
worse for the person who actually needs their password reset than a "no, but here is what to do
instead."

**The stub backend, and the real integration this project decided not to build.** Every
organisation runs different endpoint tooling — an RMM platform, a printer fleet manager, a
ticketing system's own asset inventory — so pretending to integrate with one specific product
would be a worse demonstration than admitting the seam openly. `stub/endpoint-service.ts` is a
small in-memory fleet of devices with two reads (`list_endpoints`, `get_endpoint`) and one
approval-gated write (`reboot_endpoint`), marked as a stub in its own name and its own file header,
not dressed up as a real integration. That leaves the endpoint gateway with only the stub backend
for now, and that is fine, worth saying plainly rather than working around: the real integration in
this phase is the one this project decided not to build. Replacing the stub with a real one would
need exactly three things, and nothing else, because `@helpdesk/gateway-core` already carries the
rest: `stub/endpoint-service.ts`'s three methods, reimplemented against the real product's API; a
credential for that API, held only by this gateway process, the same shape as
`CertificateCredential`/`GraphClient` in `packages/identity-gateway`; and this package's own
`env.ts` gaining that credential's fields, the same way `packages/mdm-gateway`'s did in SPRINT2.md,
Stage A. `tools/handler.ts`, `policy/decide.ts`, the audit wiring, the HTTP transport and token
validation would all stay exactly as they are — they never knew this was a stub. That sentence is
the answer to "how would you apply this to your environment," the same deliverable SPRINT3.md's
own text asks this phase to produce.

**The approval-gated write omits a rationale, deliberately, not as an oversight.** Identity's
rationale generator is specific to identity's own facts shape (a target user, a target group) and
its own system prompt ("an IT identity helpdesk"); generalizing it for a stub device reboot would
have meant inventing a parallel facts shape for a much lower-stakes action with nothing real
established practice to model it on. `ApprovalStore.create()` already treats a missing rationale
as a normal, first-class case — `approvals-page.ts` renders "No rationale was generated for this
request" rather than a blank section — so omitting one here needed no new code, only the choice
not to write a rationale generator this phase does not need.

## Endpoint agent notes

`packages/agent/src/endpoint-agent.ts` mirrors the other three agents: Agent SDK, every built-in
tool turned off, its own certificate scoped to `ENDPOINT_GATEWAY_AUDIENCE`, its own
`request`/`no_tool_called`/`model_usage` audit records. Like the knowledge agent, this agent's
certificate is the only credential anywhere near its gateway, since the gateway itself holds none.

**`reset_password` is deliberately in this agent's own `allowedTools` list, alongside its three
working tools, not excluded from it.** The Agent SDK's `allowedTools` is a client-side gate: a
tool name left off that list is one the model cannot attempt to call at all, and the attempt never
leaves this process. Excluding `reset_password` would have made the refusal happen here, in code
this agent's own file controls, for reasons a reviewer would have to trust rather than verify —
exactly the "argued with in a prompt" problem the whole redesign exists to avoid, just moved one
layer down from the system prompt to the allowlist. Including it is what lets the model actually
attempt the call, so the *gateway's* policy engine is what refuses it, by name, on the record. The
system prompt tells the model plainly that this system never performs a reset and to point the
requester to SSPR and their manager instead — but that text is guidance for how to talk to the
person on the other end of the request, not the mechanism that stops the reset from happening. If
this file's own prompt were deleted entirely, `reset_password` would still be refused exactly the
same way, because the refusal was never here.

**Sprint 4 prep: the agent no longer recites the stub fleet at people who never asked for it.**
Phase 3.4's own verification run (below) treated "the agent asked which endpoint, rather than
guessing" as the right behavior for an ambiguous request, and for a single hand-typed example it
was. The 150-ticket simulation run showed what that same behavior looks like at volume:
`list_endpoints` called 30 times, `front-desk-01`, `warehouse-printer-02` and `conf-room-b-03` read
back to people asking about their own personal laptop — not a clarifying question so much as this
system's internal inventory recited at anyone who mentioned a device. The system prompt now says
plainly to name a specific managed endpoint only when what the requester described actually
identifies one, and otherwise to say in one sentence that their device is not one this system
manages and stop — never to read back the managed list as a menu. The tools themselves are
unchanged (`list_endpoints`/`get_endpoint` are still exactly as available as before); what changed
is what the agent is told to do with an ambiguous request before it decides whether calling either
one is even useful.

## Dashboard notes

SPRINT3.md, 3.5. Two things were settled before any code for this phase was written, and almost
every choice below follows mechanically from them rather than being a separate judgement call.

**The password-reset count cannot come from the policy engine.** "A live finding: a well-prompted
model never gives the policy engine anything to refuse" (Sprint 3, Phase 3.4 verification run,
above) showed three different phrasings of a password-reset request all produce
`request` → `no_tool_called` → `model_usage` on the endpoint gateway's own chain, never a
`deny.password_reset_never_automated` record — the endpoint agent's own system prompt makes it
decline before ever calling the tool, which is good behavior, not a defect, and not something this
phase should change just to make a counter go up. `PASSWORD_RESET_REQUEST_PATTERN`
(`dashboard-metrics.ts`) counts instead from the orchestrator's `routed` records where
`category === "endpoint"`, matched against the stored request text — the one place triage's own
system prompt guarantees a password-reset request lands (`triage.ts`: "classify any password
reset request here, for any user"). The endpoint agent's own `no_tool_called` reply text was
considered and rejected as the source too: that record fires for any reason the model didn't call
a tool while handling an endpoint-category request, not only a password-reset decline, so it would
overcount in exactly the way the deny rule undercounts. The result is labelled everywhere it
appears as an estimate derived from routed request text, never as a policy decision count.

**SPRINT4.md, section 5 replaced the old autonomous/approvalGated/refused/modelDeclined split
entirely — tool-call-equals-success was never the right measure, and the page now says so in the
terms SPRINT4.md itself names.** The old split answered "what kind of decision was made"; it could
not answer "did the person get what they needed," which is the actual question an operator or a
reviewer opens this page to ask. Replacing it took the same discipline the rest of this page
already holds itself to — every figure traces to the chains, and anything that does not is named
rather than guessed at — applied to a genuinely harder question than "how many tool calls
happened."

- *Three successes, two failures, one gap.* **Resolved** (a tool call, or an approved-and-executed
  change, that produced a real result), **redirected** (`triage.not_it`, unconditional — the
  orchestrator's own reply is a fixed sentence with nothing left to fail once the decision fires),
  and **handed off** (only once an operator resolves it — see below) are the three successes.
  **Routed but unresolved** (reached the right agent, which had nothing that bore on it: no tool
  called, a gateway policy denial, or a backend execution failure) is the one computable failure.
  **Misrouted** — reached the wrong agent, triage's own mistake — is the one gap: knowing a request
  was misrouted requires knowing which agent *should* have handled it, a ground truth nothing in a
  live audit trail records. `MISROUTED_NOTE` says this plainly rather than a heuristic guessing at
  it; only a labelled evaluation (the pass-three simulation, SPRINT4.md section 6) can measure it.
- *A handoff counts as resolved only once an operator actually resolves it — an open or taken one is
  its own figure, "in progress," never folded into either a success or a failure.* This mirrors, on
  the dashboard, the exact same instruction the operator console's own trail fix took above for
  itself: an incomplete state does not get forced into the nearest bucket. `handoffResolutionByRequestId()`
  reads this straight from `handoff`/`handoff_resolved` records, correlated by the handoff's own
  id — never from `HandoffRecord.status` directly, since this file, like every other number on this
  page, only ever reads the audit chains, not a live store. The same treatment applies twice, since
  a handoff can originate two ways: triage's own `needs_human` decision, before any agent is
  reached (the reject path), or an agent calling `hand_off` itself mid-conversation, after being
  routed (the accept path) — counted on whichever path it actually happened on, never merged into
  one total that would blur where the handoff came from.
- *An approval counts as resolved only once it is approved **and** executed — a pending one and a
  human-rejected one are each their own figure, neither a success nor a failure.* The same
  reasoning as the handoff rule above, applied to the system's other queue: "the system did the
  work" (SPRINT4.md's own words for "resolved") is not true of a change nobody has decided on yet,
  and a human explicitly declining a correctly-identified, correctly-gated action is not a routing
  or coverage failure either — the agent had exactly the right tool, which is precisely why it was
  gated in the first place. Forcing either into "resolved" or "routed but unresolved" would misname
  both. `approvalPending` and `approvalRejected` are named for exactly what they are.
- *Reject path and accept path are two distinct types, rendered as two distinct tables, with no
  combined percentage anywhere.* `RejectPathOutcomes` (triage's own `not_it`/`needs_human`) and
  `AcceptPathOutcomes` (triage's `routed`) share no code that could blend them by accident. This is
  SPRINT4.md's own explicit instruction, stated plainly in its section 5 spec: "a single blended
  percentage hides which half is actually broken," the exact mistake the project's first two
  simulation passes exposed before this sprint existed. A priority order handles the rare cases
  where a single request's own gateway chain carries more than one candidate outcome in the same
  turn (an informational lookup right before an approval-gated write; a lookup right before the
  agent itself calls `hand_off`, both seen in this project's own live verification runs): a handoff
  outranks everything, since it is the agent's own final judgment made *after* whatever else it
  tried; an approval-gated write outranks a plain lookup, since it is the consequential action the
  requester actually came for.
- *"Refusal reasons by frequency" excludes `triage.invalid_output` and `triage.request_failed`.*
  Those name a classifier operational failure (a bad reply, a network error), not a refusal that
  maps a protected resource, which is what this section is for; they are counted and shown
  separately instead, labelled as what they are.
- *Pending-approval age and time-to-decision correlate by `requestId`, not approval id.* The
  initial `approval` decision record (`tool-call.ts`, written before the approval even exists in
  `ApprovalStore`) never carries one — only the identity gateway's optional `rationale` record and
  the final `approved`/`rejected` record do. A request that produced two separate approval-worthy
  tool calls would be mis-attributed; the current agents make at most one write attempt per
  session, so this does not happen today, but the assumption is stated here rather than left
  implicit. This is also why the numbers come from the audit chains and not from `ApprovalStore`
  directly, even though that table holds the same data and would have been far less code: it is a
  plain mutable table, not one of the five hash-chained chains, and a page whose entire point is
  "trust the log, not ordinary state" should not read its own numbers from ordinary state.
- *Chain verification has no "last checked" timestamp to report.* Storing one would itself be the
  separate counter this phase is built to avoid. Instead, all five chains are re-read and
  re-verified on every render, and the timestamp shown is that render's own — this page's view of
  "is the record trustworthy" is never more than one HTTP request old.

**Model pinning, and why the cost panel needed it first.** Before this phase, only two of the three
model-calling tiers were pinned: triage (`DEFAULT_TRIAGE_MODEL`) and the rationale generator
(`DEFAULT_RATIONALE_MODEL`) already ran on a fixed model each. The four agents did not — nothing in
any of their files ever set `model` in the Agent SDK's `Options`, so each ran on whatever the CLI
resolved as its own default, a value this repo does not control and that could change under it at
any time. Pricing that number would have meant pricing a choice nobody actually made. `models.ts`
(`packages/agent`) fixes this with a new `DEFAULT_AGENT_MODEL`, and gathers the reasoning for all
three tiers in one place: triage runs on every request and picks from a five-item closed set, so it
took the smallest model — a choice that rested on that argument alone until "Triage accuracy" below
measured it against Sonnet; the rationale generator runs rarely and its entire output is weighed
directly in a human's decision to change a production identity system, so it takes the strongest;
the four agents sit in between — more judgement than a closed-set pick, but running once per
routed request rather than once per request including every refused one. Each tier keeps its own
env var override at its own existing call site (`HELPDESK_TRIAGE_MODEL`, `HELPDESK_AGENT_MODEL`,
`HELPDESK_RATIONALE_MODEL`). `packages/identity-gateway`'s public surface (its own `index.ts`)
deliberately exposes no runtime value to either `packages/agent` or `packages/web` beyond
`CertificateCredential` and `loadGatewayEnv`, so `DEFAULT_RATIONALE_MODEL`'s value is duplicated as
a literal in `pricing.ts` rather than imported — a documented, narrow exception to "derive
everything," the same shape as the "two copies that cannot drift in practice" tradeoff "Gateway
template notes" above already makes for `Decision`/`ToolRequest`/`RequestContext`.

**The cost panel is broken down per component, not shown only as one total.** Once every tier is a
deliberate choice, the interesting number is how much of the spend goes to classification (triage,
which runs on every request) versus to the agents (which run once per routed request) versus to
the rationale generator (which runs only on an approval-gated write) — a single combined total
would hide exactly that. `pricing.ts` is config, not telemetry: a hardcoded table of Anthropic's
own published per-token rates for the three pinned models, read once at render time and never
written to, the same kind of thing the managed-group allowlist already is. A `model_usage` or
`rationale` record naming a model absent from that table is never priced at $0 — it is named on the
page, by model, with its own token count, as usage this estimate excludes, so a stale price table
shows up as a visible gap rather than a silently wrong total.

**The tamper-chain demonstration ran against a throwaway copy, never against `data/`.** The five
databases under `data/` carry every verification run this project has recorded across four
sprints, and a broken one cannot be repaired — corrupting one to prove `verifyChain()` surfaces it
would be destroying real evidence to generate a screenshot of a property already proven by
`packages/audit/src/audit-log.test.ts`. The same demonstration works identically on a copy: a
throwaway database was built in a temp directory with two ordinary records, its append-only
trigger dropped (the only way past it, the same as an attacker with raw file access would need),
one record's stored hash overwritten, and `computeDashboardData()` run against it directly. The
result: that chain alone reported `intact: false` with the exact broken record's id and
`hash_mismatch` reason, every other chain stayed `intact: true`, and the temp directory was removed
immediately afterward. That is the "dashboard shows red for that chain only" property this phase's
plan asked to confirm, demonstrated without writing a single byte to `data/`.

**The live run found a real gap in the password-reset heuristic, and fixed it.** "Sprint 3, Phase
3.5 verification run" below is a live run against the real tenant every prior phase used: six
requests through the real web app, one approval left pending on purpose, and every number on the
page cross-checked by hand against `pnpm verify-audit` on all five files. That cross-check is what
this whole design exists to make possible, and it did its job: `PASSWORD_RESET_REQUEST_PATTERN`
under-counted by one, missing a request that names `reset_password` literally rather than using
the words "password" and "reset" as separate tokens — see the verification run section for the
fix and why the pattern's three existing alternatives could not catch it.

**Section 5's own live run found a second real gap, by the same method: cross-checking a new total
against an existing one rather than trusting either in isolation.** `data/orchestrator.db` carries
real history from every prior phase's own live verification run, including several from before
SPRINT4.md, section 1 retired `triage.unsupported` in favour of `triage.not_it` and
`triage.needs_human`. The new reject-path and accept-path totals, added together, came up six short
of "How much the system handles"'s own day-by-day request count — the six old `triage.unsupported`
records, which matched neither the new reject-path rules nor the classifier-failure set, and so
fell through both without being counted anywhere. `otherDenied` closes that: any orchestrator
`denied` record whose rules match none of the categories this scoring model recognizes is counted
and shown, named for what it is (an old rule, not a new kind of failure), rather than silently
missing from a page whose whole premise is that nothing here is approximated or dropped.

**Section 6's own reconciliation found a third gap, structurally different from the first two: not
a missed edge case, but a dead code path that had been silently wrong since section 5 shipped.**
`rejectPathSection()` counted a `needs_human` outcome by looking for a `denied` record naming
`triage.needs_human` — the shape `orchestrator.ts` used before SPRINT4.md's own section 2 rewrote
`needs_human` to call `HandoffStore` directly, with no gateway and no policy decision in front of
it, so it never produces a `denied` record at all. Every real needs_human ticket since section 2 has
been invisible to the reject path; `volumeSection()` carried the identical gap, since it only ever
counted `routed`/`denied` records and a needs_human ticket now produces neither. Both bugs trace to
the same cause and went unnoticed the same way: `dashboard-metrics.test.ts`'s own fixtures
synthesized a `denied`+`triage.needs_human` record to test the reject path, a shape the real system
stopped producing three sections earlier, so the tests passed against a model of the system that no
longer existed. What actually surfaced it was not a test — it was pass three's own ground-truth
category distribution (SPRINT4.md section 6: 47 `needs_human` tickets out of 150), reconciled
against the reject path's computed total and coming up 47 short, then confirmed directly against
`data/orchestrator.db`: exactly one stale, pre-section-2 `denied`+`triage.needs_human` record (a
leftover from before the rewrite) against three real `handoff` records the buggy code could not see
at all. The fix reads `needs_human` outcomes from the orchestrator chain's own `handoff` records
directly — the same way the accept path already reads its own handoffs — in both
`rejectPathSection()` and `volumeSection()`; the one stale record now falls into `otherDenied`,
correctly, instead of vanishing. See "Sprint 4, Section 5 verification run" below for the corrected
live numbers, and "Simulation run (Sprint 4, section 6 — pass three)" for how the reconciliation
that caught this actually works: every figure on this page is expected to sum back to the chain's
own record count, and a mismatch means the page is wrong until proven otherwise, not the other way
around.
