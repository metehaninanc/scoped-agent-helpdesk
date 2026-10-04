# Findings worth reading on their own

The bugs and wrong assumptions this project turned up, each with what found it and what changed, taken out of the sections they were found in.

Section titles quoted in the text, such as "Endpoint gateway notes", are the titles from the project's original single-file README; [the index](README.md) says where each one is now.

## Contents

- [Two bugs a live tenant found that the test suite could not](#two-bugs-a-live-tenant-found-that-the-test-suite-could-not): Triage's model rejected a parameter the code sent and wrapped valid JSON in a code fence; both surfaced in the first two live submissions (Sprint 3.1).
- [One real bug the extraction surfaced, not merely moved](#one-real-bug-the-extraction-surfaced-not-merely-moved): Extracting shared code into gateway-core showed the MDM gateway had been logging its refusals under the identity gateway's label (Sprint 3.2).
- [A live tenant finding: Entra mints a Graph-scoped token regardless of app role assignment](#a-live-tenant-finding-entra-mints-a-graph-scoped-token-regardless-of-app-role-assignment): The isolation proof predicted the wrong mechanism for a credential with no permissions: Entra mints the token and refuses at the request (Sprint 3.3).
- [A live finding: a well-prompted model never gives the policy engine anything to refuse](#a-live-finding-a-well-prompted-model-never-gives-the-policy-engine-anything-to-refuse): A well-prompted model declined to ask for what the policy engine must refuse, so a conversation never exercises that refusal and it is proved directly instead (Sprint 3.4).
- [A real finding: the password-reset heuristic missed a literal tool-name mention](#a-real-finding-the-password-reset-heuristic-missed-a-literal-tool-name-mention): The dashboard's password-reset counter missed a request that named the tool literally; a cross-check against a by-hand read found it (Sprint 3.5).
- [A real infrastructure finding, before any of that](#a-real-infrastructure-finding-before-any-of-that): Pass three's first attempt failed 45% of its tickets because the agent subprocess had silently fallen back to a different authentication path.
- [A real data-integrity finding, fixed generally, not just for this pass](#a-real-data-integrity-finding-fixed-generally-not-just-for-this-pass): Failed tickets left partial, un-deletable traces on the append-only chain, and the summary stopped reconciling until it was found; the fix is general.
- [Finding: a test proves the code does what it was written to do, not that it is right](#finding-a-test-proves-the-code-does-what-it-was-written-to-do-not-that-it-is-right): Dead code that passed its own tests: the dashboard's reject path read a record shape the system had stopped producing, and its test fixtures synthesized the same retired shape.
- [Finding: the comparator itself assumed reaching a tool is success — the same fallacy section 5 exists to correct, left standing in the tooling](#finding-the-comparator-itself-assumed-reaching-a-tool-is-success--the-same-fallacy-section-5-exists-to-correct-left-standing-in-the-tooling): The comparator counted reaching a tool as success and called 20 tickets regressions; nineteen were not.
- [Finding: an unattributed improvement, named as one rather than folded into either named effect](#finding-an-unattributed-improvement-named-as-one-rather-than-folded-into-either-named-effect): An improvement nobody intended, named as unattributed rather than credited to either change: five tickets began handing off.
- [Method note: an implausible result gets investigated; a plausible wrong one gets published](#method-note-an-implausible-result-gets-investigated-a-plausible-wrong-one-gets-published): A model-tier comparison whose first result was implausible (74 of 150 for a larger model) and was investigated before it was published.
- [Finding: `HELPDESK_TRIAGE_MODEL` pointed at a thinking-capable model silently broke classification](#finding-helpdesk_triage_model-pointed-at-a-thinking-capable-model-silently-broke-classification): Pointing the triage model setting at a thinking-capable model silently failed 68 of 150 tickets.
- [Finding: the stop-guard watched session limits, not billing — a credit-exhausted run wrote 0/150 as data](#finding-the-stop-guard-watched-session-limits-not-billing--a-credit-exhausted-run-wrote-0150-as-data): The stop-guard watched session limits, not billing, so a credit-exhausted run wrote 0 of 150 as data.
- [The format failure: the fields are too easy to confuse](#the-format-failure-the-fields-are-too-easy-to-confuse): Every triage format failure was the same mistake: a category name in the scope field.
- [Finding: renaming the fields changed valid answers, not only invalid ones](#finding-renaming-the-fields-changed-valid-answers-not-only-invalid-ones): Renaming the fields to fix the format failure also changed answers that were well formed.
- [`T004`: a correct answer that scores as wrong](#t004-a-correct-answer-that-scores-as-wrong): `T004`: a correct answer that scores as wrong, because its label predates the boundary rule.

## Two bugs a live tenant found that the test suite could not

Both surfaced in the first two submissions, before the run below starts. Recording them here
rather than quietly fixing and re-running is the same discipline Stage B used for the v1.0/v2.0
token discovery above: a live tenant catches things a design document, and a hand-written test
fake, cannot.

**`claude-haiku-4-5-20251001` rejects the `effort` parameter outright.** `triage.ts` originally
sent `output_config: { effort: "low" }`, copied from the rationale generator's own call. The
rationale generator's model, `claude-opus-5`, accepts it; triage's model does not, and the API
returned `400 invalid_request_error: "This model does not support the effort parameter"` on every
call. `TriageError`'s own `api_error:400` handling worked exactly as designed — the request was
refused cleanly and audited as `triage.request_failed` (record 1 below) rather than crashing the
web app — but the classifier could not classify anything until the parameter was removed. Fixed by
dropping `output_config` from the call entirely; a three-word classification does not need effort
tuning either way.

**`claude-haiku-4-5-20251001` sometimes wraps its JSON reply in a markdown code fence, despite
the system prompt explicitly asking for none.** The next call after the fix above returned
`{"category": "identity"}` — the correct answer — inside a markdown code fence, which `JSON.parse`
rejected outright. `TriageError`'s `invalid_output` path caught this correctly too (record 2
below): the closed-set validation never let a malformed reply through, it just meant a
syntactically correct answer was thrown away over formatting. Fixed by stripping a leading/trailing
fence before parsing — a tolerance for how the model actually replies, not a relaxation of what the
schema accepts: `triage.test.ts` also asserts a fenced-but-out-of-set category is still rejected,
unchanged.

Both fixes are in the code this document already describes; the failed attempts stayed in the
chain rather than being reset out of it, since a refusal — even one caused by this project's own
bug — is exactly the kind of thing the audit log exists to show.

## One real bug the extraction surfaced, not merely moved

`http-listener.ts`'s `log.warn(...)` calls used to import `log` from whichever package physically
contained the file — which was always the identity gateway's own `../log.js`, since that is
where the file lived before this phase and the MDM gateway only ever imported the function, never
copied it. That meant every 401 or 400 the MDM gateway's own listener refused was logged to
stderr under the `[gateway]` prefix — the identity gateway's own label — not `[mdm-gateway]`.
Harmless (the audit record itself was always correctly attributed; only the human-readable log
line was not) but wrong, and invisible until the file had to move somewhere that could not
silently keep pointing at one gateway's own logger. `createRequestListener` now takes `log` as an
injected dependency, same as `validator` and `audit`, defaulting to a neutral one; both
`bin/gateway.ts` files now pass their own. Confirmed live below: the two gateways' startup lines
already showed the right prefixes even before this run (`[gateway]` and `[mdm-gateway]`
respectively), and this run's refusals — none occurred, since every request below was
well-formed — would have shown the same if it had.

## A live tenant finding: Entra mints a Graph-scoped token regardless of app role assignment

Before this run could produce any evidence at all, a small environmental issue blocked it: the
knowledge agent's certificate thumbprint in `.env` had a stray embedded space (a copy-paste
artifact, 41 characters instead of 40), which `prove-isolation.ts`'s own zod schema correctly
refused to accept rather than silently truncating or misreading it. Fixed by stripping the
whitespace and confirming the resulting value is exactly 40 hex characters — a data-entry mistake,
not a code bug, but exactly the kind of thing a live run catches and a hand-written fake cannot.

The real finding is in what `prove-isolation.ts` originally *predicted* for the knowledge agent's
two Graph-level checks, versus what Entra actually did. `runGraphCheck()` originally assumed that
an application with no app role assignment on Graph's resource whatsoever would be refused a
Graph-scoped token at acquisition time — before any HTTP call to Graph even happened — and treated
a caught `TokenError` there as a synthetic 401. Run against the real tenant, that assumption was
wrong: client-credential token acquisition with a valid certificate succeeds regardless of app
role assignment on the target resource, producing a token with an empty `roles` claim. The refusal
happens exactly where it happens for the identity and MDM agents' own out-of-scope calls above —
at the moment Graph's authorization layer evaluates the actual request — with the identical `403
Authorization_RequestDenied` those checks already get. The fix was to stop predicting a different
mechanism for "zero permissions" than the one already proven for "the wrong permissions": both
`expectedStatus` fields became `403`, and the speculative `TokenError`-catching branch in
`runGraphCheck()` was removed rather than kept as unreachable code, since the codebase already has
this project's own standing rule against validating for scenarios that cannot happen. This makes
the proof stronger, not weaker — the same enforcement mechanism covers both cases, which is one
fewer thing that could silently drift between them.

## A live finding: a well-prompted model never gives the policy engine anything to refuse

The single most interesting result of this run was not a bug. Three different phrasings of "reset
my password" — a plain ask, an insistent retry ("right now"), and an explicit "call it so I can see
what it returns" reframing — were submitted through the real web app. All three produced exactly
the right answer: a plain refusal, pointing to Self-Service Password Reset first and the manager
second. None of them called `reset_password`. Each one's audit trail on the endpoint gateway's own
chain is just `request` → `no_tool_called` → `model_usage` — no `deny.password_reset_never_automated`
record, because the policy engine was never asked to decide anything.

The cause is the endpoint agent's own system prompt (`endpoint-agent.ts`), which tells the model
the outcome of calling `reset_password` in advance and says not to retry it. A model that already
knows a tool call cannot succeed, and has been told so explicitly, correctly treats calling it
anyway as wasted latency for no benefit — the same reasoning that makes a competent human support
agent tell a caller "we don't do that" rather than dialling into a system they already know will
refuse them. This is good behavior, not a defect, and changing the prompt to force a needless tool
call purely so a demo would produce a certain audit record would be optimizing the system for being
watched rather than for working well. Nothing about this weakens the actual guarantee: the refusal
the user receives is still accurate, still points them somewhere, and the mechanism that would
refuse the call if it were ever attempted (by this agent, a different one, or a future change that
removes this prompt's caution) is real, independently proven by
`packages/endpoint-gateway/src/tools/server.test.ts`, and — since a unit test is not a live-tenant
claim — proven again below with a real bearer token against the real running gateway.

`pnpm reset-password-smoke` (`packages/agent/src/bin/reset-password-smoke.ts`) is that proof: it
mints a real token with the endpoint agent's own certificate and makes one authenticated MCP call
to `reset_password` directly, without a model anywhere in the path.

```
requestId: reset-password-smoke-f4822e6b-dd37-4bfe-90b9-070c9213a4c1
{
  "status": "denied",
  "rules": [
    "deny.password_reset_never_automated"
  ],
  "message": "Refused by policy: deny.password_reset_never_automated. Nothing was reset, changed, or looked up. This system never resets a password: use Self-Service Password Reset, or your manager if SSPR is not available."
}

PASS: denied by policy, named deny.password_reset_never_automated.
```

The endpoint gateway's own audit chain recorded it identically to how it would record a denial
reached through any agent: `{"requestId":"reset-password-smoke-f4822e6b-dd37-4bfe-90b9-070c9213a4c1","actor":"reset-password-smoke@local","decision":"denied","tool":"reset_password","rules":["deny.password_reset_never_automated"]}`.
This is the refusal record with its rule name the phase's own definition of done asked for — reached
by a direct, live call rather than waiting on a model to decide to make one, which this run showed
it reasonably will not.

## A real finding: the password-reset heuristic missed a literal tool-name mention

The cross-check above initially found a mismatch of exactly the kind this phase's directive said to
treat as a bug: `PASSWORD_RESET_REQUEST_PATTERN` reported 3 password-reset requests, but a by-hand
read of the orchestrator's `endpoint`-category request texts found four genuine ones — the three
phrasings from the 3.4 live run ("reset my password", "...reset the password for alice@... right
now", and "Please call the reset_password tool for alice@... and show me exactly what it returns")
plus this run's own "I forgot my password, can you reset it for me?" The third of the four does not
contain a standalone word "password": it names `reset_password`, the tool itself, and `_` counts as
a word character, so `\bpassword\b` finds no boundary between `reset` and `password` inside that
one token. `PASSWORD_RESET_REQUEST_PATTERN` (`dashboard-metrics.ts`) gained a fourth alternative,
`\breset_password\b`, to catch a request that names the tool literally — as strong a signal as any
of the three plain-English phrasings it already matched. `dashboard-metrics.test.ts` gained a test
naming this exact phrasing so the gap cannot reopen silently. After the fix and a restart, the page
read 4, matching the by-hand count exactly — captured in the evidence screenshot below.

## A real infrastructure finding, before any of that

Pass three's first attempt failed on 45% of its tickets with what looked like an ordinary runner
error. It was not: the Agent SDK's own `apiKeySource` field, checked directly rather than assumed,
confirmed the subprocess had silently stopped authenticating with `.env`'s `ANTHROPIC_API_KEY` and
fallen back to the Claude Code session's own usage allowance instead — a session under real pressure
from an earlier, accidental concurrent double-run of this same simulation. Waiting for the session's
own reset would have left the identical failure mode in place for every future run, so the fix is
permanent rather than a one-time workaround: `runStoppingReason()`
([sdk-usage-errors.ts](../packages/agent/src/sdk-usage-errors.ts)) checks every SDK error against the
Agent SDK's own `USAGE_LIMIT_ERROR_PREFIXES`/`ORG_POLICY_LIMIT_PREFIXES` and an authentication-error
pattern; `bin/simulate.ts`'s catch block now stops the whole run the moment one fires, rather than
recording a usage or authentication failure as though it were a system outcome. Confirmed on one
ticket before resuming: `apiKeySource: 'ANTHROPIC_API_KEY'`, not `'none'` or a login-managed key.
The run's error entries were pruned and the remainder resumed against the confirmed key — the
runner's own resumability meant nothing already recorded was lost.

## A real data-integrity finding, fixed generally, not just for this pass

Triage's own decision writes to the orchestrator chain before the routed agent's own call can fail,
so each of the interrupted run's failed tickets left a real, permanent, partial trace on the
append-only chain — un-deletable by the hash chain's own design — under a `requestId` the resumed
run's fresh attempt never reused. `evidence/simulation-summary-3.md`'s first draft didn't reconcile
(176 orchestrator requests where 150 tickets should produce at most 150) until this was found and
named. `filterChainToRequestIds()`/`requestIdsOf()` ([simulation-compare.ts](../packages/web/src/simulation-compare.ts))
now restrict every simulation reader — `simulate-summary`, `simulate-compare`, `simulate-score`, not
only this pass's own — to a run's own recorded `requestId`s before any cost or outcome figure is
computed from a chain, the same way the dashboard itself is never allowed to read the chain in
one form and a hand-derived total in another.

## Finding: a test proves the code does what it was written to do, not that it is right

Scoring this pass on section 5's outcomes model surfaced a real bug already shipped: `103` routed
and denied orchestrator records against an expected `145` (150 minus 5 `triage_failed`) — 47 short,
exactly the `needs_human` count. `rejectPathSection()` was reading a `denied`+`triage.needs_human`
record shape `orchestrator.ts` stopped producing when SPRINT4.md's own section 2 rewrote
`needs_human` to call `HandoffStore` directly — dead code, reading a shape retired two sections
earlier, that could never again match a real record. `dashboard-metrics.test.ts`'s own fixtures for
this path synthesized that exact retired shape, so its tests passed the entire time: they proved the
dead branch did what it was written to do, faithfully, on input the real system had stopped
producing. Every real needs_human ticket — in this pass and in the live `data/` chains alike — was
invisible to the reject path, and no test caught it, because no test checked the code against
reality, only against itself.

A test proves the code does what it was written to do. Reconciling a computed total against the
chain's own record count proves it is right — those are different claims, and this bug lived in the
gap between them for as long as section 5 has existed. What actually found it was not a test: it was
this pass's own ground-truth category distribution (47 `needs_human` tickets) coming up 47 short
against the reject path's own computed total, then a direct query against `data/orchestrator.db`
confirming exactly one stale, pre-section-2 record explained the one number the original live check
happened to get right by coincidence. Full account, fix, and the corrected live dashboard numbers
are in "Dashboard notes" and "Sprint 4, Section 5 verification run" above; the fix is what makes the
reject-path row below real rather than structurally unable to count 47 of pass three's 150 tickets.

## Finding: the comparator itself assumed reaching a tool is success — the same fallacy section 5 exists to correct, left standing in the tooling

`pnpm simulate-compare --baseline 2 --tag 3` first ran with the comparator this same section had
shipped earlier, and it called 20 of the 106 changed tickets "regressed" — a ticket that "reached a
tool or a real category in pass two and did not in pass three." Reading those 20 against both
passes' own reply text, per instruction, before trusting the label: nineteen were not regressions.
Nine were the `mdm` agent's own `list_devices` call against this tenant's permanently empty device
directory — pass two's "success" was a tool call that came back empty every time, and the agent said
so, every time, in some version of "there's nothing to look up, and I couldn't fix it anyway even if
there were." Pass three's `needs_human` handoff for the same tickets gives the requester an actual
person and an actual handoff id — a better outcome under section 5's own model, not a worse one.
`classifyChange()` could not see that, because it was still measuring what section 5's own dashboard
fix had already retired: `toolCalled` as a stand-in for success, and `not_it`/`unsupported` as a
stand-in for failure, the exact "tool-call-equals-success" assumption named and replaced everywhere
else this project reports an outcome. It had not been replaced here.

**The comparator is fixed, not just the number.** `classifyChange()`
([simulation-compare.ts](../packages/web/src/simulation-compare.ts)) now buckets each ticket into the
same shape `dashboard-metrics.ts`'s own `OutcomesSection` uses — resolved, redirected, handed off, or
approval pending are peers, none ranked against the others, exactly why section 5 reports the reject
and accept paths as separate figures rather than one blended score; only a genuine dead end (no tool,
or a gateway denial) or an operational fault (`triage_failed`, a runner error) sits below that tier.
A move between two of the four working outcomes — a tool call that resolved nothing to a `needs_human`
handoff, say — now reports as "changed, direction not asserted," the same honest abstention the tool
already used for cases its four-field signature genuinely cannot judge, rather than asserting a
direction it has no basis for. Re-run against the fixed comparator: **8 regressed, 52 improved, 46
changed** (was 20/24/62) — full tables in
[evidence/simulation-comparison-3.md](../evidence/simulation-comparison-3.md).

Of the fixed comparator's own 8 regressions, six are self-evidently real: five —
`sim_records1.json#T047`, `sim_records2.json#T004`/`T038`/`T045`, `sim_records3.json#T025` — are a
move into `triage_failed`, an operational fault (triage itself failed to produce a valid
classification) the old comparator's narrower definition of "dropped" never flagged at all, so only
one of these five was even visible as a regression before this fix. `sim_records3.json#T012` is a
newly-caught, genuine regression of a different shape:
pass two gave a clean, honest "this system doesn't have a way to help with that yet" (`unsupported`);
pass three routed the same request to `knowledge`, which produced a long reply offering to hand off
or search further — an offer this project's own single-turn rule means nothing ever answers, so the
requester is left with strictly less than pass two's clean decline. The old comparator missed this
entirely, since escaping `unsupported` into any other category always counted as improvement, whether
or not the destination did anything either. The remaining two —
`sim_records1.json#T012`/`T034` — are a wash the fixed comparator still cannot see past: pass two's
`search_documentation` call structurally succeeded (an `autonomous` decision) even though its own
content was already a dead end ("I don't know," verbatim, in both), so a four-field signature reads
it as a real resolution regressing to `no tool`. No mechanical signature can read reply content;
that reading is what this document's own account is for.

## Finding: an unattributed improvement, named as one rather than folded into either named effect

Five `identity` tickets — `sim_records1.json#T046`, `sim_records2.json#T041`/`T047`,
`sim_records3.json#T008`/`T047` — called the same tool (`list_user_groups`/`list_managed_groups`) in
both passes, got the same answer (the group or resource asked about isn't one of the two this system
manages), and in pass two, stopped there: an informational dead end with no escalation. In pass
three, every one of the five went on to call `hand_off`, giving the requester an actual person
instead of a fact. Neither the triage split (identity was correctly categorized `identity` in both
passes) nor the corpus widening (the identity agent has no documentation corpus) explains this;
nothing in the identity agent's own code changed between the two passes either. The most likely
explanation is ordinary model sampling variance on the agent's own choice to escalate. Named here
plainly as an unattributed improvement, not folded into either effect this section otherwise
separates — the honest answer is "the data does not say why," not a guess dressed up as one.

**The category distribution moved the way both named effects predict, and mostly cannot be teased
apart further.** `not_it`/`needs_human` (0 → 66) is entirely the triage split — those two rules did
not exist for pass two to produce. `unsupported` (20 → 0) is the same split from the other side: pass
two's catch-all is retired, not replaced by a smaller number of something else. `endpoint` (35 → 10)
and `mdm` (14 → 2) fell the most in raw count, consistent with the split moving hardware-fault and
device-replacement phrasing that used to force-fit into `endpoint`/`mdm` out to `needs_human` instead
— triage.ts's own category text places "hardware faults, a broken or lost device that needs
replacing" under `needs_human` explicitly, not under either routable category. `knowledge` (56 → 47)
and `identity` (25 → 20) fell by less, and the corpus widening cuts against `knowledge` falling at
all — more documentation should mean triage is at least as willing to route a borderline how-to
question there, not less — so the net drop is better read as the split moving tickets out of
`knowledge` (the same hardware-adjacent phrasing above) faster than the wider corpus pulled new ones
in, not as evidence the corpus made no difference. Distinguishing "the corpus is wider" from "the
corpus is wider and also just a different draw from the same model" is not possible from this data
alone — both passes are one run each, not a repeated sample — and this document says so rather than
asserting a causal split it cannot support.

## Method note: an implausible result gets investigated; a plausible wrong one gets published

The comparison was set up because the choice of model tier "is a decision this project states in
code and in the README, and right now it rests on reasoning rather than measurement" — Haiku, the
smallest, on the argument that a closed-set pick does not need more. The first Sonnet run scored
**74/150 (49.3%)** against Haiku's 83%, same prompt, same labels, same 150 tickets. A model that large
scoring that far below a smaller one is not believable, and that was the whole of what caught it:
the number was too bad to believe, so it was investigated. Had it come back at 70% instead — merely
mediocre — it would have been plausible enough to publish as a capability finding, "the bigger model
does not help here, the cheap choice is vindicated," and it would have been wrong.

The harness's own breakdown located the problem in minutes, because it reports an operational
failure (`triage_failed`) separately from a wrong category: 66 of that run's 76 misses were
`triage_failed`, not a wrong destination. A re-run with each failure's error text logged (78/150,
52.0%) showed 69 of 150 calls had *failed*, 68 of them `stop_reason=max_tokens`, and of the 81
calls that returned an answer, 78 were correct — 96%. Two things combined. `MAX_OUTPUT_TOKENS` is 64,
sized for Haiku's single terse line of JSON. And `claude-sonnet-5` decides for itself whether to
think when none is requested: simple tickets came back as a clean one-line reply, but on a harder one
(a camera that shows a black square on Zoom) it spent an entire 300-token budget on a thinking block
and never reached the JSON. The first Sonnet figure was a configuration artefact, not a capability
measurement. (Both artefact runs' evidence files were replaced by the first valid Sonnet run under
the same label; their figures are recorded here.) The same rule cuts the other way and is the reason the
runs below were repeated: a result that looks right deserves the same suspicion as one that looks
absurd, and a single plausible number from a stochastic classifier is one draw.

## Finding: `HELPDESK_TRIAGE_MODEL` pointed at a thinking-capable model silently broke classification

This is a production defect, found by the comparison the way the citation 404s were found by
widening the corpus: by exercising the system on an input its default configuration never reached.
`HELPDESK_TRIAGE_MODEL` can point at any model, and before this fix pointing it at one that may think
would have failed close to half of this project's ticket set (68 of 150) with no sign of a
configuration problem — each one a `TriageError` (`stop_reason=max_tokens`), surfaced to the requester as "Your
request could not be classified right now" and counted on the dashboard as an ordinary classifier
failure, excluded from both outcome paths as "an operational fault, not a routing outcome." Nothing
would have said the setting was the cause. [`classify()`](../packages/agent/src/triage.ts) now passes
`thinking: { type: "disabled" }` explicitly: this call was designed, per its own header, to need no
loop, no memory and no reasoning beyond picking from a closed set, so thinking is not something it
wants from any model. `triage.test.ts` asserts it on the request body.

## Finding: the stop-guard watched session limits, not billing — a credit-exhausted run wrote 0/150 as data

Three further Sonnet runs were planned for the variance estimate. The account's API credit ran out
during the second: it answered tickets 0–79 normally (70 of 80 correct), then every call from ticket
80 failed with a 400, "Your credit balance is too low," and the third run failed from its first
call. The harness scored all of it as `triage_failed` and wrote an evidence file reading 0/150,
because `runStoppingReason()` — written in section 6 to stop exactly this — matched Claude Code
session limits and authentication errors, but not the Messages API's own billing refusal. The same
silent-noise failure, through the one door the guard did not watch; the run's error text
had been discarded by piping its output through `tail -1`, which is why it took a probe call to see
the message.
`runStoppingReason()` now recognizes it (and the harness, like `simulate.ts`, stops and writes
nothing); the zero-information run was deleted and the 80 valid answers from the partial one are
kept as `triage-harness-sonnet-r2-INCOMPLETE-credit-exhausted.json`, used below only for what they
can support. **Two of the three planned Sonnet runs therefore do not exist**, and the comparison
below rests on two complete Sonnet runs, not three.

## The format failure: the fields are too easy to confuse

Failures went from none to 1.7 a run on `dataset2` (5 of 450 calls) after the prompt grew and gained two
scope values. Every failure is the same: **a valid category name in the `scope` field** —
`{"scope": "identity", "category": "identity"}` or `{"scope": "mdm", "category": null}` — the same failure
`d1-T149` showed in the previous section (`"scope": "endpoint"`). Never a scope word in `category`, never
nonsense. There is no retry in the code and none was added: a retry would hide the question, and the question
has an answer.

**I think the two fields are too easy to confuse, and that they want renaming.** Four things point there:

- **The failure is always a correct answer in the wrong slot.** The model knows it means `identity`. `scope`'s
  value `"routable"` names nothing: it is a placeholder meaning "look in the other field", and the other
  scope values (`not_it`, `needs_human`, and now `network` and `security`) are all destinations. Adding two
  more destination-shaped values likely made the first field look more like the answer field; that
  explanation is a reading of the failures, and what was tested is only the next point.
- **Renaming alone removes it.** A probe on `dataset2` only, nothing shipped (`evidence/triage-format-probe.json`):
  the three tickets that failed in the harness runs, ten calls each, plus seven controls, four calls each. The current prompt
  gave 6 invalid outputs in 58 calls. The same prompt with `scope` → `outcome`, `category` → `agent` and
  `routable` → `route_to_agent`, same shape and same freedom to answer, gave 0 in 58.
- **A flat single `destination` field and constrained decoding (a JSON schema with the enums) also gave 0 in
  58**, so the probe cannot tell the three apart on validity. All three also gave 0 invalid in 300 calls on the
  full set against 5 in 450 now.
- **It is not a problem of strictness.** Constrained decoding works by making the wrong output impossible,
  not by removing the reason the model produces it, and it depends on an API feature. It would stop the
  failures and say nothing about why they happened.

On accuracy the three variants are not worse and not clearly better; two runs each on all 150 tickets:

| Variant (against the new labels) | Runs | Mean | Invalid outputs | `mdm` recall | `knowledge` → `endpoint` a run |
|---|---|---|---|---|---|
| current prompt, `scope` / `category` | 122 / 119 / 119 | 80.0% | 5 of 450 | 44.4% | 3.7 |
| renamed fields | 122 / 125 | 82.3% | 0 of 300 | 57.1% | 5.5 |
| flat `destination` | 121 / 124 | 81.7% | 0 of 300 | 45.2% | 3.0 |
| structured output | 123 / 124 | 82.3% | 0 of 300 | 59.5% | 9.0 |

The 1.7 to 2.3 points are about what the failed calls were costing (1.1 points) plus noise. The probe does
show the confusion can cost *valid* answers too: on `T062`, the same prompt text gave `mdm` 2 times in 10 under
free generation and 10 times in 10 under constrained decoding. But on the full set `mdm` recall moves by no
more than about 15 points and 6.5 to 8 `mdm` tickets a run still go to `needs_human` in every variant, and
`knowledge` → `endpoint` does not go away in any of them. **So neither the `mdm` misses nor the `endpoint`
pull is a format artefact.** They are the definitions, above.

**Left unfixed in this round, applied in the last one (below).** The shipped prompt and parser were unchanged
here, because changing the output names changes the prompt, and the three-run figures in this section are
measurements of that prompt. The change was contained: rename the names the model sees, keep `TriageResult`'s `scope` and `category` internally, and
map one to the other in the parser, so no type, label file or consumer changes. An earlier note in this
section called mapping a category name in `scope` to `routable` "the obvious next change". It is withdrawn: it
would turn a signal into silence, which is the retry's mistake without the retry.

## Finding: renaming the fields changed valid answers, not only invalid ones

The format fix was made to stop invalid outputs, and it did: five of 450 calls before, none of 450 after. The
more important result is that **it also changed answers that were well formed.** The old names — `scope`,
`category` and the placeholder value `routable` — were costing correct classifications, not only parseable
ones.

The evidence, in the order it should be weighed:

- **`T016` (an MFA loop; label `identity`) was `security` in all three runs before the last round and is
  `identity` in all three after.** That is the observation that prompted this, and on its own it does not
  prove the rename did it: the same round also rewrote the `identity` text.
- **The probe is the isolating evidence.** It changed the names and nothing else, on the same prompt text
  (`evidence/triage-format-probe.json`). `T016` went from `security` four times in four to `identity` four
  in four. `T062` (label `mdm`) went from `mdm` 2 times in 10 to 9 in 10, the rest `needs_human`. `T002`
  (label `identity`) went from `security` three times in four to `identity` four in four. Four other
  controls did not move, and a fifth, `T037`, moved by one call in four. Constrained decoding on the *old* names gave `T062` `mdm` 10 times in 10, which
  fits the reading below: the model's answer was `mdm`, and the old shape made it hard to say.
- **On the whole set the effect is small and cannot be separated from noise.** Renamed fields alone, two runs:
  82.3% against 80.0%, of which about 1.1 points is the invalid outputs that stopped. What remains, about a
  point, is within run-to-run spread. The finding is about individual tickets, not a headline gain.

**A reading of why, not a tested cause.** With the old names the first field has to hold a placeholder
(`routable`) for anything an agent handles, and the real answer goes in the second. A model that already knows
its answer is `identity` or `mdm` has to hold it back in the first slot. Sometimes it writes it there, which
is an invalid output. Sometimes it takes the nearest scope word instead: `security` for an MFA ticket,
`needs_human` for an enrolment ticket. That second case is wrong and well formed, so no validity check sees it.

What follows from it:

1. **A zero invalid-output rate does not show a format is neutral.** The invalid outputs were the visible tail
   of a confusion whose other effects were silent. Anything that counts only parse failures would have called
   the old format nearly clean at 1%.
2. **Field and value names are part of the prompt and have to be varied and measured like prompt text.**
   They never were before this. Every triage figure in this document that predates the rename was measured
   under names that cost correct answers: the first accuracy harness, the Sonnet and Haiku comparison, the
   mixed-set baseline, both earlier `dataset2` rounds and the triage step of every simulation pass. They remain true as measurements of those prompts,
   and they understate what the same wording scores under the new names.
3. **The held-out measurement, when it is spent, runs under the final names**, and the names are not to be
   changed again after it.

## `T004`: a correct answer that scores as wrong

**`T004` is the one `dataset2` ticket that the final prompt gets right and the committed label marks wrong.**
Read it as a correct answer scored wrong, not as a miss.

> Sign-in to Microsoft 365 is blocked with `AADSTS53003` on my managed ThinkPad. Started after lunch; the same
> account works on my managed phone. Correlation ID ends 72c9. I haven't changed location.

The label is `identity`, committed in `6a03959` before the boundary rule existed. The boundary rule says a
block specific to one device is `mdm`, because the device record is the first thing to check, and the final
prompt says so: it answers `mdm` in all three runs. The scoring therefore counts it wrong.

| `dataset2`, final prompt | Runs | Mean |
|---|---|---|
| As scored, label `identity` | 132 / 131 / 134 | 88.2% |
| **If the label were `mdm`** | 133 / 132 / 135 | **88.9%** |

The previous round's prompt, which said `identity`, would score 121 / 118 / 118 (79.3%) against the moved label
and not 122 / 119 / 119 (80.0%), so the label move would also widen that round's gain, from 8.2 to 9.6 points.

**The label was left alone, for four reasons.**

1. Every `dataset2` figure in this document, across all the prompts that were run, is against one committed
   label file. Moving one label changes each of them by a ticket and leaves the committed numbers
   unreproducible from the committed labels.
2. A label changed after results are seen is a label shaped by results. Here the change would go against the
   old prompt's answer and not for the new one, which is not the same as chasing a score, but the project's
   rule is that labels are fixed before runs and it is simpler to keep it than to argue each exception.
3. `dataset2` is finished as an iteration set, so no later round would use the corrected label. The place the
   rule belongs is the held-out labels, where it was applied before any run
   ([`test/heldout-labels.md`](../test/heldout-labels.md)).
4. The label file cannot carry a comment. [`test/dataset2-labels.md`](../test/dataset2-labels.md) now records the
   mismatch, so a reader who opens the label first finds it there as well.

`T004` is the only `dataset2` ticket found that the rule would move.
