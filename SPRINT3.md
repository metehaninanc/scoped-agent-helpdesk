# Sprint 3 — From Demonstration to Tool

Sprints 1 and 2 proved the claim. One request path, then two identities, with both boundaries
enforced outside our own code.

Sprint 3 turns that into something with enough coverage to actually reduce helpdesk load, and makes
adding the next backend a filling-in exercise rather than a rewrite.

Five phases, in order. Each leaves the repo working. Do not run them in parallel.

---

## What Sprint 3 adds

| Phase | What lands |
|---|---|
| 3.1 | Triage. Raw user text finally has a place to land that holds nothing. |
| 3.2 | Gateway template. The shared spine every gateway is built from. |
| 3.3 | Knowledge agent. Documentation answers, zero permissions, the largest ticket category. |
| 3.4 | Endpoint agent. Built on the template, proving the template is real. |
| 3.5 | Dashboard. What the system did, for someone who will never read the code. |

The simulation run moves to Sprint 4, together with the prompt injection suite and the recorded
walkthrough. Sprint 3 builds the capability. Sprint 4 exercises and presents it.

---

## 3.1 Triage

Triage classifies a request and names which agent should handle it. That is its entire job.

**It gets no gateway, no Entra registration, and no tools.**

This is a deliberate reversal of the pattern every other agent follows, and the reasoning belongs in
the README. Giving triage a gateway would give it an identity. An identity is a thing that can be
misused, stolen, or over-granted later. The strongest boundary available here is not having one at
all. Triage is a classification function with a model inside it.

**The output is a closed set, not free text.** Triage returns exactly one value from a fixed list
of categories — nothing else. The router rejects anything outside that list rather than passing it
along. Triage does not extract or return parameters, even informationally: the moment a downstream
component reads something triage pulled out of the request text, triage is inside the trust
boundary the closed set exists to keep it outside of. See the README for the reasoning.

This is the threat model, and the README should state it plainly. Triage is where injected
instructions arrive. The worst an injection can achieve is mis-routing, and a mis-routed request
lands at an agent that has its own credential, its own gateway, and its own policy engine, all of
which refuse it exactly as before. Nothing downstream trusts triage's judgement about permission,
only about destination.

**The routing decision is audited** by the orchestration layer, not by triage. Which agent handles
a request determines which credential set is in play, so it is security relevant and belongs in the
log.

**One addition that everything after this depends on:** every model call in the system must record
its token usage in the audit record. Input tokens, output tokens, model name. Triage adds a third
model call per request, and phase 3.5 cannot report cost without this. Add it here, retrofit it to
the existing agent and rationale calls in the same phase.

---

## 3.2 Gateway template

Four gateways exist or will by the end of this sprint. Three of them will have been written by
hand. Stop before writing a fourth.

Extract a `@helpdesk/gateway-core` package carrying everything that is the same every time:

- HTTP transport and the MCP server wiring
- token validation: signature, issuer, audience, app role
- the call order, unchanged: validate, decide, commit the audit record, then branch
- audit log wiring and the session record conventions
- the refusal shapes and their audit records

What a new gateway supplies:

- its tool definitions and their schemas
- its tool descriptions, still in one reviewable file
- its policy rules
- its audience and its own audit database path
- a backend client, optionally, and a credential, optionally

The optional parts matter. A gateway with no credential must be a first class case, not a
workaround, because 3.3 needs exactly that.

**Write a conformance test suite in the core package** that any gateway can run against itself.
It should prove, for that gateway: the audit record is committed before the backend is touched,
an unknown tool name is denied and audited, malformed input is denied and audited rather than
throwing, a request with no token is refused with 401 and audited, and a token for a different
audience is refused.

Then run it against all four gateways. A template whose guarantees are only described is a
convention. One whose guarantees are tested is a template.

Refactoring the two existing gateways onto the core is part of this phase. If the refactor reveals
that they differ in some way that cannot be shared, that difference is a finding worth writing
down rather than papering over.

---

## 3.3 Knowledge agent

The largest category of helpdesk tickets is people asking how something works. This agent answers
those, and it is the clearest demonstration in the project that an agent does not need permissions
to be useful.

**Identity:** its own app registration, granted `Gateway.Invoke` on its own gateway, and no Graph
permission whatsoever. The API permissions page in Entra should be empty.

That empty page is the point. Elsewhere the project argues that least privilege applies to agents.
Here it is visible in the portal rather than described in a README.

**Gateway:** one tool, `search_documentation`, autonomous. No credential, no backend client, no
network access. It reads a local index and returns passages with their source.

**Corpus:** Microsoft Learn documentation for Entra and Intune, from the public docs repositories.
Ingest them as markdown at a pinned commit and record which commit in the README, so an answer can
always be traced to a known version of the source. Check the license on those repositories and
record it, with attribution if required.

Keep the corpus narrow. This agent answers questions about the same domain the rest of the system
operates in, which is what makes it part of the project rather than a separate product bolted on.

**Retrieval, in two steps.** Do not start with embeddings.

Step one is lexical search over the indexed passages. Get the whole path working: ingestion,
chunking by heading, search, passage selection, an answer that cites its sources, and the audit
record showing which passages were used.

Step two is embeddings, and only if step one's retrieval quality is visibly insufficient on a set
of real questions you write down first. If lexical search answers them, stop there and say so.

This ordering exists because retrieval quality work can absorb the entire sprint. The spine first,
then widen, the same discipline as every sprint before it.

**Two rules for the answers.** Every answer cites the source document and heading. If nothing
relevant is retrieved, the agent says it does not know rather than answering from the model's own
knowledge. And this agent never claims to have performed an action, because it cannot perform any.

---

## 3.4 Endpoint agent

Built on the template from 3.2. If building it requires changing the core, the template was not
finished, and fixing that is part of this phase.

Two backends, one real and one openly fake.

**Real: password reset.** Resetting another user's password through Graph, approval gated, never
autonomous. Choose the narrowest Graph permission that actually works for this operation rather
than a broad directory write, and confirm on a live token that the roles claim carries only what
was intended.

Policy rules for it: denied outright when the target is a break glass account or holds a directory
role, approval gated otherwise. Confirm by test that the existing deny rules apply rather than
assuming they generalise.

**Stub: a device or printer service.** Every organisation runs different endpoint tooling, so
pretending to integrate with one specific product would be a worse demonstration than admitting
the seam. Build a small local service that stands in for one, with two or three read operations
and one gated write.

Mark it clearly, in the code and in the README, as a stub rather than an integration. Then say
what replacing it would involve: the tool definitions, the policy rules, the credential, and
nothing else, because the template carries the rest. That sentence is the deliverable of this
phase. It is the answer to "how would you apply this to our environment".

---

## 3.5 Dashboard

An operations view for someone who will never read the code and needs to decide whether to trust
the system.

**Where:** inside the admin area, behind the same protection as the approval screen. Not a public
URL.

The data looks harmless and is not. A distribution of which rules fired tells a reader where the
walls are, and the refusal reasons map the protected resources. Audit data is open to the people
who audit, not to everyone.

**Source:** derived entirely from the audit log. No separate telemetry, no metrics database, no
counters maintained alongside. If a number cannot be computed from the log, either it does not
belong on the dashboard or the log is missing something. State this on the page itself.

**What it shows**, grouped by the question each group answers:

*Is the record trustworthy.* Total records per chain, chain verification status, when it was last
verified. This sits at the top, because every other number on the page depends on it.

*How much the system handles.* Requests over time, and the split between autonomous, approval
gated and refused.

*How busy the humans are.* Pending approvals, age of the oldest one, median time to a decision.

*What was stopped.* Refusal reasons by frequency, and which rules fired most often.

*What it costs.* Average cost per request, estimated monthly total, and the share of decisions
that reached an outcome without any model call at all. Label the totals as estimates, since model
pricing changes.

That last number is the one worth putting next to the cost. Most decisions in this system are made
by deterministic code and cost nothing, which is a consequence of the architecture rather than an
optimisation. A non technical reader who understands that one line understands why the system was
built this way.

**Design direction:** an operations console, not a marketing page. Dense, calm, monospaced
figures, clear units, no gradients, no drop shadowed cards, no decorative icons. The chain
verification line should read as a status, green or red, with no ambiguity. Someone should be able
to look at this page for five seconds and know whether anything needs attention.

---

## prove-isolation

The knowledge agent adds rows. Its token against `/users` and `/devices` should be refused by
Graph, and against every other gateway with an audience mismatch. An identity that can reach
nothing, proven rather than asserted.

Keep the script as the single place where these expectations live. When it grows past a screen,
that is fine. It is the file a reviewer will open first.

---

## Out of scope for Sprint 3

- The simulation run with realistic ticket data. Sprint 4.
- Prompt injection test suite. Sprint 4, and it needs triage to exist first, which is why triage
  comes first here.
- Recorded walkthrough. Sprint 4.
- Ledger anchoring and the tail truncation gap.
- Entra login for human users. The actor stays a parameter.
- Any further agents beyond the five.
- Embeddings, unless 3.3 step one demonstrably falls short.
- Any hardening pass. Correctness first, hardening as its own deliberate sprint.

---

## Working notes for Claude Code

- Read `SPRINT1.md`, `SPRINT2.md` and `README.md` first. Every convention established there carries
  forward: audit before action, identity never from model output, policy config in version control,
  tool descriptions in one reviewable file, evidence committed rather than described.
- Phases in order. Do not start a phase before the previous one is committed.
- Token usage recording in 3.1 is a dependency for 3.5. If it is skipped, 3.5 cannot be built
  honestly.
- The knowledge gateway having no credential is a designed case, not a gap. If the template makes
  it awkward, fix the template.
- Never widen a Graph permission to make something pass. In this project a refusal is usually the
  correct result.
- When the README and the code disagree, the README is the thing that misleads a reader. Fix it in
  the same commit.
