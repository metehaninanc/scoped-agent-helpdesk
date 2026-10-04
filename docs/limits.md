# Limits

What this system does not do and where its ceiling is: the scope drawn on purpose, what stayed open, and what each measurement can and cannot support.

Section titles quoted in the text, such as "Endpoint gateway notes", are the titles from the project's original single-file README; [the index](README.md) says where each one is now.

## Scope

### What Sprint 1 deliberately does not include

Microsoft Graph access uses a certificate credential (no client secrets). The gateway is
reachable only over stdio, on the same host as the agent that spawns it; there is no HTTP
transport and no OAuth on the gateway itself. The web app's identity field is a plain text
input; Entra login is not wired up. There is one agent, with no separate triage process and no
second agent type. There is no ledger anchoring for the audit chain (see above) and no prompt
injection test suite. None of this is an oversight; each is a named line SPRINT1.md draws on
purpose, so that Sprint 1 stays small enough to actually finish and be evaluated as a whole.

> **Moved:** *Two known gaps carried forward from Sprint 1 — both now closed* is now in [architecture.md](architecture.md#two-known-gaps-carried-forward-from-sprint-1--both-now-closed).

> **Moved:** *What Sprint 2, Stage A adds* is now in [architecture.md](architecture.md#what-sprint-2-stage-a-adds).

> **Moved:** *What Sprint 2, Stage B adds* is now in [architecture.md](architecture.md#what-sprint-2-stage-b-adds).

### What is still open after Sprint 2

A merged, read-only view across the two gateways' separate audit chains (SPRINT2.md, Component 6
describes this as a small reader that verifies each chain independently before merging by
`requestId`; not built, since nothing in this sprint's definition of done requires it — each
chain already verifies clean on its own, which is what Component 6's actual requirement asks
for). The MCP authorization specification describes a fuller model than Stage B implements:
discovery metadata, dynamic client registration, resource indicators. This sprint stops at
audience-bound tokens against Entra; see "Stage B: HTTP transport and token validation" below for
what that gap means in practice. Carried forward unchanged from Sprint 1: Entra login on the web
app, replacing the plain identity field; ledger anchoring, to close the tail truncation gap the
hash chain leaves open; and a prompt injection test suite. The triage logic to route between the
two agents that now exist — left here as a placeholder function through Sprint 1 and Sprint 2 —
is no longer open: SPRINT3.md 3.1 builds it for real; see "Triage and orchestration notes" below.

## What this number can and cannot support

It supports: routing accuracy on a set the prompt was not tuned against is about 71%, not 82%, and the
difference is mostly what the tickets are and partly the prompt's own boundaries. It does not support
a claim that the model got worse, that either set is the better test, or anything about `not_it`.

**This set is now spent as a held-out set if it is used to tune the prompt.** Any change to `triage.ts`
made from the misses above stops this from being a held-out number, and the next number from it would
measure how well the change fits these 150. The other 300 tickets in the three sources are labelled
(`dataset-labels.json`) and not in the mixed set; they are the ones to iterate against.

**Evidence committed:** `evidence/triage-harness-mixed-r{1,2,3}.{md,json}`; the harness now takes
`--tickets` and `--labels` and reports firm and judgement-call labels and a per-source table. The three
runs above were made before one fix to it: its per-source key was wrong, so their JSON `source` field says
`mixed-set.json` and their reports have no per-source table; the by-source table here was computed from the
ticket-id prefix in those JSON files, and the accuracy figures are unaffected. 1001 tests across nine
packages, all passing; `pnpm typecheck` and `pnpm build` clean.

## What it does not cover

Injection **in the request text only.** An instruction could also arrive in data a tool returns, such as a
documentation passage or a name read from the directory; none of those channels is tried. It is single-turn,
three runs a side, and it names the agents' replies for a reader and does not parse their meaning: the verdicts
rest on routes and tool calls. The set is the injections this project has met, not the ones it has not.

## In a populated tenant

The three environment changes the pass names, and what each would do. They are changes to the tenant, not the code. One
caveat on the first: the managed-group allowlist is a policy file in version control on purpose, with no environment
override, so widening it is a reviewed commit to data, not a switch.

| Environment change | Tickets | What it would do | What it would not do |
|---|---|---|---|
| **More managed groups** (the groups exist in the directory and are on the allowlist) | 9 | The group-add requests reach the approval gate, as `T003`, `T011` and `T018` did | Resolve them without a person: group changes stay approval-gated |
| **A device joined to the directory** (the fleet registered) | 11 | `get_device` and `list_devices` return real records, so the handoff carries compliance and check-in state instead of "no device found" | Resolve them: the MDM tools are read-only, and a duplicate record, a stale check-in or a failing policy needs an administrator |
| **A corpus covering the applications in the ticket set** | 11 | A search returns a passage, so a documented fix is answered with no person | Cover a fault specific to one machine or one workbook |

| | Now | Ceiling in a populated tenant |
|---|---|---|
| Never needs a person | 0 | up to 11 (7.3%), if the corpus holds a fix |
| Structured handoff or approval request | 73 | 70 |
| Nothing useful attached (triage) | 65 | 65: no environment change touches it |
| Reaches no person | 12 | 4 |

**The ceiling for resolution is 35 of 85 (41.2%)**: the 4 resolvable now and the 31 blocked by config. It is a ceiling, not
a forecast, and it assumes every config-blocked ticket's fix lies inside what its tool does, which the read-only device
tools do not guarantee. No environment change moves the 42 blocked by coverage (those are tools, which is code), the 7
refused on authority, the one never automatable, the 65 handed off by triage with a class label, or the gaps in One.

## What this says, and what it does not

Said once, beside the number: the routing figure is in-sample, the prompt was tuned against it, and the project closes on
it. It says the routing agrees with its labels at 88.7%, almost entirely on the tickets the labels are sure of, and
nothing about unseen tickets, which the unspent held-out 200 exist to say.

The three measurements say what the system did with a ticket, not how well it would do in a tenant that is not this one.
They say: it acted or gave a specific reason for 76 of 150 and a category-level one for 26 more; it carried out none of the
seven requests it must not carry out; 36 of 150 (24.0%) reach a person with an attempt or a proposal attached; and nothing in
the pass closed a ticket without a person. They do not say the system resolves tickets, because the
tenant cannot show that, and the resolution rate stays recorded as the property of the test environment it is.

**The held-out 200 remain unspent.** They are the 100 tickets each from `dataset1` and `dataset3` that were never in
the mixed set, labelled by domain and committed before any run (`test/heldout-labels.json`). Nothing was run against
them for this pass, and nothing is to be until the decision to spend them is made deliberately.

**Cost.** $1.0494 priced across the pass: triage $0.3429 (real API spend, the prompt now about 2,100 tokens a call),
the identity agent $0.4563, the MDM agent $0.1357, the knowledge agent $0.1102, the endpoint agent $0.0043, the
four agents priced as if on the API though they ran on the login session. About $0.007 a ticket.

**Evidence committed:** `evidence/simulation-results-5.jsonl` (150 lines), `simulation-summary-5.md`,
`simulation-outcomes-5.md`, `simulation-resolved-by-hand-5.md`, `simulation-capability-5.md` and `.json` (the three
measurements, one row a ticket); `test/actor-mapping-dataset2.json`. The runner gained `--tickets` and
`--actor-mapping`, and the scorer `--exclude-first` and `--out`, so pass five could be scored alone.
