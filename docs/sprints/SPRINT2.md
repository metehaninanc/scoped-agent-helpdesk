# Sprint 2 — Enforcement Depth

Sprint 1 proved the shape. One agent, one gateway, one certificate, deterministic policy, an audit
chain that holds. What it did not prove is the claim the whole project rests on: that an agent's
reach is bounded by its credentials rather than by its instructions.

Sprint 2 proves that, and the proof is a call that fails.

Read this before writing code. If something here turns out to be wrong, change this file first.

---

## What this sprint proves

Two boundaries, at two different layers, each provable on its own.

**Boundary one, agent to gateway.** The identity agent presents a token minted for the identity
gateway. The MDM gateway rejects that token because it was not issued for it. Nothing in the
model's output can change which token the agent holds.

**Boundary two, gateway to Graph.** The identity gateway's service principal has no device
permissions. When its token is used against a device endpoint, Microsoft refuses it. This refusal
comes from outside the project, which is what makes it worth recording.

The second one is the headline. A control enforced by your own code is a design choice. A control
enforced by the identity provider is a fact.

---

## Definition of done

1. Two app registrations exist with genuinely disjoint Graph permissions. The identity gateway can
   read users and write group membership. The MDM gateway can read devices. Neither can do the
   other's job.
2. Both gateways run over HTTP transport, not stdio, and validate a bearer token on every request.
3. An agent holding an identity gateway token is refused by the MDM gateway with a 401 naming
   audience mismatch, and the refusal is audited.
4. The identity gateway's own token, pointed at a Graph device endpoint, returns 403 from Microsoft.
   The raw request and response are captured as an evidence artifact in the repo.
5. The web app no longer holds a Graph credential. It reaches Graph only through a gateway.
6. `remove_user_from_group` exists, approval gated, and the demo revert no longer needs a manual
   Graph call.
7. Each gateway owns its own audit chain, and both verify clean after a full run.

---

## Build order

The sprint splits in two. Stage A must be working before Stage B begins, because Stage B's
authentication has no meaning until there are two separate identities to authenticate as.

**Stage A: two identities.** Second app registration, MDM gateway, MDM agent, and the
gateway-to-Graph refusal captured. Still stdio, still no gateway auth. At the end of Stage A,
DoD items 1, 4 and 6 are done.

**Stage B: the network boundary.** HTTP transport, Entra issued tokens, audience validation, and
the web app losing its credential. At the end of Stage B, items 2, 3, 5 and 7 are done.

If Stage B runs long, Stage A on its own is still a complete and defensible sprint. Do not start
Stage B until Stage A's evidence artifact is committed.

---

## Azure setup

### Stage A

1. Create a second app registration, `helpdesk-mdm-gateway`, single tenant, no redirect URI.
2. Generate a separate certificate for it. Do not reuse the identity gateway's key. Separate
   identities with a shared private key are not separate identities.
3. Grant application permission `Device.Read.All` only. Grant admin consent. Do not grant any
   group, user write, or directory permission. The narrowness is the point.
4. Confirm in the token's `roles` claim that it carries exactly one permission.

There are no devices in the tenant and none are needed. `GET /devices` returning an empty list is
a successful call. What matters is which calls succeed and which are refused.

### Stage B

Each gateway becomes a protected API in Entra.

5. On each gateway app registration, under Expose an API, set an Application ID URI such as
   `api://helpdesk-identity-gateway`. Define one app role, for example `Gateway.Invoke`, with
   allowed member type Application.
6. Create one app registration per agent: `helpdesk-identity-agent`, `helpdesk-mdm-agent`. Give
   each a certificate.
7. Grant the identity agent the `Gateway.Invoke` role on the identity gateway API only. Grant the
   MDM agent the same role on the MDM gateway API only. Admin consent both.
8. Do not cross grant. The entire demo depends on these grants being disjoint.

The agent now holds a credential, which Sprint 1 deliberately avoided. That is a real change and
the README must say why: the agent's credential authenticates it to its own gateway and carries no
Graph permission at all. It cannot be replayed against Graph, and it cannot be replayed against the
other gateway. The Graph certificates stay where they were.

---

## Component 1: MDM gateway

Same structure as the identity gateway. Its own policy config, its own audit chain, its own
certificate.

Two tools:

**`list_devices`** — autonomous. Returns id, displayName, operatingSystem, and compliance state
for devices in the tenant. `GET /devices`.

**`get_device`** — autonomous. One device by id.

No write tools in Sprint 2. The MDM gateway exists to prove separation, not to manage devices.
Adding a device action here would widen the permission set for no gain.

The policy engine is shared code but not shared config. Each gateway loads its own rule set. A rule
that only makes sense for one gateway does not belong in the other's configuration.

---

## Component 2: the refusal evidence

This is the deliverable of Stage A. Treat it as a build artifact, not a manual test.

Write a script, `pnpm prove-isolation`, that runs four checks and prints a table:

| check | expected |
|---|---|
| identity gateway token against `/users` | 200 |
| identity gateway token against `/devices` | 403 |
| MDM gateway token against `/devices` | 200 |
| MDM gateway token against `/users` | 403 |

For each check, capture the HTTP status, the Graph error code, and the `roles` claim of the token
used. Never log the token itself or the assertion.

Write the output to `evidence/isolation-run.txt`, commit it, and reference it from the README. Any
row that does not match the expectation makes the script exit non zero. If Azure permissions drift
later, this script catches it.

The README should state plainly what this proves and what it does not. It proves that Microsoft
enforces the separation. It does not prove that the gateway process cannot read the other
gateway's certificate from disk, which is a host level concern and is addressed by running them
under separate users, or on separate hosts.

---

## Component 3: `remove_user_from_group`

Approval gated, same class as the addition. `DELETE /groups/{id}/members/{userId}/$ref`.

It inherits every existing deny rule without a new one being written, which is worth confirming in
a test rather than assuming. If a new rule turns out to be necessary, that is a finding worth
writing down.

With this tool in place, the demo revert runs through the same audited, approved path as the
change itself. No more manual Graph calls outside the system.

---

## Component 4: HTTP transport and token validation

Stage B. Both gateways move from stdio to HTTP.

Each gateway:

- accepts MCP over HTTP on its own port
- requires a bearer token on every request
- validates the signature against the tenant's published keys
- validates that the `aud` claim matches its own Application ID URI, and rejects it otherwise
- validates that the expected app role is present
- takes the calling agent's identity from the validated token, never from the request body

That last point carries forward the Sprint 1 rule. Identity was a spawn argument because nothing
the model produced could reach it. Now it comes from a signed token, which is stronger, and the
same property holds.

A rejected token produces a 401 and an audit record. A request that fails authentication is still
a request that happened, and the audit log is the place where that is visible.

Do not forward the incoming token to Graph. The gateway obtains its own Graph token with its own
certificate. Passing a caller's token upstream is the pattern the MCP authorization spec forbids,
and for good reason. State this in the README as a deliberate choice rather than an accident.

**Known gap to document rather than solve.** The MCP authorization specification describes a fuller
model than this: discovery metadata, dynamic client identity, resource indicators. This sprint
implements audience bound tokens against Entra and stops there. Name the gap in the README. A
reader who knows the spec will respect the accurate boundary more than an overstated claim.

---

## Component 5: web app loses its credential

The Sprint 1 web app holds a `CertificateCredential` directly because there was no other route to
Graph. With HTTP transport, that route exists.

The web app becomes a client of the identity gateway like any agent. It gets its own app
registration and its own `Gateway.Invoke` grant. Delete the credential and the `GraphClient` from
the web package entirely, do not leave them behind a flag.

The approval executor moves with it. When an approval is granted, the execution call goes through
the gateway, through the policy engine, and into the audit log like everything else. Today it
bypasses all three, which is the last place in the system where a Graph write happens outside the
control path.

---

## Component 6: audit chains

Each gateway owns its own chain in its own database file. Do not merge them into one.

The reasoning is a threat model, not a preference. A single shared chain means every writer holds
write access to every other writer's history. Two chains mean a compromised MDM gateway cannot
rewrite what the identity gateway recorded.

The cost is that a single request touching two gateways spans two chains. Accept it, and write a
small reader that merges records by `requestId` for a combined view. The reader is read only and
verifies each chain independently before merging.

This is a decision worth a paragraph in the README. Choosing isolation over convenience, and saying
why, is the kind of reasoning the project is meant to demonstrate.

---

## Out of scope for Sprint 2

- Reviewer agent. The rationale generator covers this ground and does it more honestly.
- Endpoint support agent, knowledge agent, and everything else from the original agent table.
- Triage as a separate process. The seam stays a placeholder.
- Device write actions of any kind.
- Ledger anchoring and the tail truncation gap.
- Entra login for human users of the web app. The actor is still a parameter.
- Prompt injection test suite. That is Sprint 4 and it needs the finished architecture to be
  meaningful.
- Any hardening pass. Correctness first, then hardening as its own deliberate sprint.

---

## Working notes for Claude Code

- Read `SPRINT1.md` and `README.md` first. The conventions established there carry forward:
  audit before action, identity never from model output, policy config in version control, tool
  descriptions in one reviewable file.
- Stage A before Stage B, without exception. Commit the evidence artifact before starting Stage B.
- Never widen a Graph permission to make something pass. A refusal is usually the correct result
  in this sprint, and a widened scope silently destroys the thing being demonstrated.
- The two gateways share code but not configuration and not credentials. If sharing config starts
  to look convenient, that is the signal to stop and ask.
- When the isolation script's expectations and reality disagree, the script is not the thing to
  change first. Check the Azure grants.
- Keep the README honest about what each control covers. Every gap named in this file should be
  findable in the README by the time the sprint closes.
