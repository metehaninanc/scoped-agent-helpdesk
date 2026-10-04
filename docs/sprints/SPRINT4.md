# Sprint 4 — Resolution, Not Routing

Two simulation passes over the same 150 realistic tickets established what is actually wrong, and
it is not the security model. Routing improved between the passes. What the passes exposed is that
a request reaching the right agent still has nowhere useful to go about half the time, and that the
system has no way to record a correct outcome that is not a tool call.

Sprint 4 fixes that. It is a product sprint, not an architecture sprint. Nothing about the
credential boundary, the policy engine or the audit chain changes.

---

## What the passes showed

Classified by what a human helpdesk would actually do with each ticket:

| | Count | A human would |
|---|---|---|
| The system could act | 88 | Do the work |
| Needs hands | 35 | Open a hardware or logistics ticket |
| Not IT at all | 27 | Redirect to the right team and close |

Against that, pass two:

- Of the 27 not-IT tickets, 15 were declined by triage and 12 reached an agent and spent tokens
  finding out they could not help. Triage precision on the reject path is 56 percent.
- Of the 88 the system could act on, 44 reached a tool. Of those that did not, 18 sat in endpoint
  and 17 in knowledge.
- Of the 35 needing hands, none can be scored as a success today, because handing off is not an
  outcome this system knows how to record.

The last line is the important one. Today the only thing counted as success is a tool call, so
correctly telling someone that IT does not handle their landlord is indistinguishable from failing
them. The ceiling with today's outcomes is 115 of 150. The current figure is 59.

---

## Definition of done

1. Triage makes two decisions rather than one, and the first has three outcomes: not IT, needs a
   human, or routable to an agent.
2. A handoff queue exists. A ticket that needs a human is recorded as handed off, not declined,
   and appears in an operator queue.
3. An operator console exists: the handoff queue and the approval queue in one place, designed for
   someone working through them, not for a demo screenshot.
4. The rationale briefing is generated on request rather than automatically, and requesting it is
   itself audited.
5. The dashboard scores three kinds of success separately: resolved, correctly redirected,
   correctly handed off.
6. A third simulation pass runs over the same 150 tickets and is compared against passes one and
   two on the new scoring.

---

## 1. Triage: two decisions

Today triage picks one of five categories in a single step. Four of the five are IT domains, so a
request about a coffee machine finds a nearest match rather than falling out.

Split it.

**Decision one: can this system do anything about this request?**

Three outcomes:

- `not_it` — facilities, HR, expenses, personal devices, family members, deliveries, anything a
  corporate IT function would not own at all. The reply names the team that would own it where
  that is obvious, and the ticket closes.
- `needs_human` — genuinely IT, but requiring physical action, procurement, logistics or an
  account this system does not administer. Hardware faults, replacements, shipping, lost or stolen
  devices, an ex employer's laptop. These go to the handoff queue.
- `routable` — the system has tools that bear on it. Proceed to decision two.

**Decision two: which agent.** The existing four categories, unchanged.

Both decisions can be one model call returning two fields, or two calls. Prefer one call, since
triage runs on every request. What matters is that the first decision is made explicitly and is
recorded with its own value, not inferred from which category was picked.

Keep the closed set discipline. Both fields come from fixed enumerations and anything outside them
fails validation, is audited, and does not route.

**The partially out of scope flag stays**, and now applies to the first decision too. A ticket that
is half a group request and half a cracked screen should route the half it can and say the other
half was not handled.

---

## 2. The handoff queue

A handoff is an outcome, not a refusal. It gets its own audit decision kind and its own record.

The record carries: the requestId, the actor, the original request text, why it was handed off
(the triage reason), and its state. States are open, taken, and resolved.

An operator takes a handoff, works it outside this system, and resolves it with a note. The note
is required, the same rule the approval flow already enforces, and for the same reason: the audit
trail should say why a human decided what they decided, not only that they did.

**The endpoint agent becomes mostly a handoff producer.** Pass two showed all 35 of its tickets
reaching no tool, which is honest but useless. Rather than pretending otherwise, an endpoint
request that names no managed device should hand off with a clear reason rather than ending the
conversation. Its stub backend stays for the reboot demonstration and nothing more.

Say plainly in the README that this reflects reality rather than a limitation of the design. Most
endpoint work needs hands, and a system that routes it to a human quickly is doing the right thing.

---

## 3. The operator console

This is the first part of the project built for someone doing a job rather than someone evaluating
a design, and it should be built that way.

**One page, two queues.** Approvals waiting on a decision, and handoffs waiting to be taken. The
operator should be able to see both and work down them without navigating.

**A queue row shows enough to triage it without opening it:** when it arrived, who asked, a one
line summary of the request, and what kind of action it needs. Oldest first by default, since age
is the thing that hurts.

**An opened item shows, in this order:**

1. The raw request, exactly as the person typed it
2. What the system did and why: which category, which agent, which tools, which policy decision
   and which rules fired
3. What it could not do and why
4. The actions available

For an approval the actions are approve and reject, both requiring a note, with the requester and
approver still forced to differ. For a handoff they are take and resolve, resolve requiring a note.

**Design direction.** An operations console. Dense, quiet, monospaced figures, generous line
height, no cards, no shadows, no icons that do not carry information. Age shown as elapsed time
rather than a timestamp, because that is the number an operator acts on. The oldest item in each
queue should be visually distinct without being alarming. Someone should be able to work through
twenty items without the interface getting in the way.

The existing approvals page folds into this. Do not leave two pages that do overlapping things.

---

## 4. Rationale on request

The briefing currently generates automatically whenever an approval record is created. Most
approvals do not need it, it costs money and latency on every one, and the approver has no say.

Make it a control on the opened approval. The approver asks for it, it generates, it is stored
verbatim in the audit log exactly as today.

Three things to keep:

- The generator still receives raw facts only, never the agent's conversation. That property is
  the reason it can be trusted at all and it does not change.
- The request itself is audited: who asked for a briefing, for which approval, and when. An
  approver reaching for help before deciding is useful signal.
- The absent state is now normal rather than a failure. The screen should say no briefing has been
  requested, with the control next to it, and keep saying so plainly rather than leaving an empty
  space.

---

## 5. Scoring

The dashboard currently counts a tool call as the only success. Replace that with three outcomes,
each counted separately and each a success:

- **Resolved** — the system did the work. A tool call that produced a real answer or a real change.
- **Redirected** — correctly identified as not IT and closed with a pointer.
- **Handed off** — correctly identified as needing a human and placed in the queue, then resolved
  by one.

And two failure modes, also counted separately, because they have different fixes:

- **Misrouted** — reached an agent that could not help with it. Triage's problem.
- **Routed but unresolved** — reached the right agent, which had nothing that bore on it. Coverage's
  problem.

Every one of these is computable from the chains as they will exist after sections 1 and 2. If any
of them is not, say so rather than adding a counter, the same rule as every other number on that
page.

The dashboard should show the reject path and the accept path as separate figures. A single
combined percentage hides which half is broken, which is exactly the mistake the two passes
corrected.

---

## 6. Pass three

Same 150 tickets, same actor mapping, same single turn rule, a third set of databases and evidence
files. Passes one and two stay untouched.

Compare all three on the new scoring. Report the reject path precision and the accept path
coverage separately, and list every ticket whose outcome changed against pass two, regressions
first.

The corpus will have been widened before this runs, so expect knowledge to move. Separate that
effect from the triage change where the data allows it, and say where it does not.

---

## Out of scope for Sprint 4

- Prompt injection test suite and the recorded walkthrough. They close the project after this.
- Entra login for human users. The actor is still a parameter, and the operator console does not
  change that.
- Actor validation against the directory. Worth doing, but it is a separate correctness fix and
  folding it in here would muddy the measurement.
- Any new agent, any new gateway, any new Graph permission.
- Embeddings for retrieval. Widening the corpus comes first and may settle the question.

---

## Working notes for Claude Code

- Read `SPRINT1.md` through `SPRINT3.md` and `README.md` first. Every convention carries forward.
- Sections in order. Triage before the handoff queue, the queue before the console, the console
  before the scoring, the scoring before pass three. Each one is the input to the next.
- The handoff queue is a new writer to the audit chains. It follows the same call order and the
  same record shape as everything else, through gateway-core, not beside it.
- The operator console is the one place in this project where interface quality is part of the
  deliverable. Spend the time.
- Never widen a Graph permission. Nothing in this sprint needs one.
- When a number on the dashboard cannot be computed from the chains, name the gap rather than
  filling it.
