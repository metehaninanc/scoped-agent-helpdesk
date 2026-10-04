# Triage accuracy

How triage was defined, tuned and scored: the definitions, the model-tier comparison, the cleaner ticket set that became a new baseline, the network and security outcomes, and the dataset2 rounds.

Section titles quoted in the text, such as "Endpoint gateway notes", are the titles from the project's original single-file README; [the index](README.md) says where each one is now.

## Triage accuracy: the definitions first, then the model tier

Pass three's own routing accuracy, scored by hand against the ticket set's ground truth, was not
spread evenly across destinations: `not_it` and `knowledge` were nearly clean, while `mdm` and
`identity` were badly wrong — a shape that points at triage's own category definitions rather than
the classifier itself, and is cheap enough to test directly, isolated from everything else a full
simulation pass bundles together (the agents' own behavior, handoff resolution, tool execution).

**A triage-only harness, not another full pass.**
[`bin/triage-harness.ts`](../packages/web/src/bin/triage-harness.ts) (`pnpm triage-harness --label
<name>`) calls `createTriageClassifier()` directly — classification alone, no agent, no gateway, no
tool call — against all 150 ticket texts and a hand-built ground-truth label file,
[`test/triage-ground-truth.json`](../test/triage-ground-truth.json): one `{ scope, category }` per
ticket, scored against `triage.ts`'s own rubric by reading each ticket's `actualNeed` (never a
model's own input) the same way this document's own "misrouted" scoring already did for section 6,
extended here to all 150 tickets rather than only the accept-path ones. A full pass runs four agents
and four gateways against 150 tickets; this harness is one isolated API call per ticket and finished
in about four minutes for $0.23 on Haiku — cheap enough to run twice in the same sitting rather than
guess at a fix and wait for the next full pass to find out.

The label file is this session's own independent reading, not a shared external file: compound
tickets (a laptop issue and an access request in the same message) were scored on their primary
ask, the same judgment triage itself has to make, and a different reader would place a handful of
them differently. That is a real limit on precision, not hidden: it affects individual tickets, not
the shape of the result, which is what the two findings below rest on.

**Baseline: 105/150 (70.0%), and the shape matches the hypothesis exactly.**

| Destination | Correct | Total | Accuracy |
|---|---|---|---|
| not_it | 12 | 13 | 92.3% |
| knowledge | 35 | 41 | 85.4% |
| endpoint | 6 | 7 | 85.7% |
| needs_human | 29 | 41 | 70.7% |
| identity | 21 | 38 | 55.3% |
| mdm | 2 | 10 | 20.0% |

Full per-ticket results: [`evidence/triage-harness-baseline.md`](../evidence/triage-harness-baseline.md).

**Two patterns, confirmed against the actual misclassifications, not assumed from the shape alone.**
`mdm`'s 8 errors: 5 landed in `needs_human` — `"intune says not compliant"`, `"phone says not
compliant"`, `"my phone says company portal needs attention, but it still gets email"`, each a
device reporting its own compliance or enrollment state, not a hardware fault. Reading that state is
exactly what the `mdm` agent's own tools do; `needs_human`'s rubric talks about hardware faults and
broken devices, and a model told to pick between "this needs hands" and "this needs a documentation
lookup" for a device that says it is broken, in its own voice, reasonably reaches for the one that
sounds more like a fault. `identity`'s 17 errors split the same way: 7 landed in `needs_human`, 6 in
`knowledge` — `"I can't see the info@ shared mailbox in my outlook anymore"`,
`"it says access denied"`, `"my access to the finance reporting folder still isnt working"`. The
`identity` definition only named `"add me to X"`; none of these ask for anything, they report that
something that used to work no longer does, and the rubric had no line that said an access fault is
still an access request.

**The fix touches the scope boundary itself, not just the category text** — the errors above are
`needs_human` vs. `routable` mistakes, decided before a category is ever picked, so sharpening only
the `mdm`/`identity` bullets would have left the real fork unchanged.
[`TRIAGE_SYSTEM_PROMPT`](../packages/agent/src/triage.ts) now names both carve-outs explicitly inside
the `needs_human` definition — a device's own compliance/enrollment/sync status and a reported
access fault are each named as *not* this, with a forward pointer to where they do belong — and the
`identity`/`mdm` bullets restate the same distinction from the other side, so a request landing on
either boundary has two chances to be read correctly rather than one.

**Re-measured: the sharpened prompt, five complete runs, 80.7–83.3%.** The first re-run scored
125/150 (83.3%); running the same prompt again under identical conditions gave 122, 122, 121 and
125. That spread — four tickets, 2.7 points — is the real precision of this harness against a
single model, and every figure below is read against it rather than as an exact value. (The first
125/150 run's evidence file was replaced by a later re-run under the same label, which is why the
harness now refuses to overwrite an existing label; the 125 is recorded here, not in `evidence/`.)
Per-destination figures are the mean of the three runs under the final configuration; the baseline is
a single run, so its own spread is unknown, but a 12-point gain is several times anything the
sharpened prompt's own spread produced.

| Destination | Baseline (1 run) | Sharpened (mean of 3) | Total |
|---|---|---|---|
| mdm | 2 (20.0%) | 9.0 (90.0%) | 10 |
| identity | 21 (55.3%) | 32.3 (85.1%) | 38 |
| needs_human | 29 (70.7%) | 28.3 (69.1%) | 41 |
| knowledge | 35 (85.4%) | 34.0 (82.9%) | 41 |
| endpoint | 6 (85.7%) | 6.3 (90.5%) | 7 |
| not_it | 12 (92.3%) | 12.7 (97.4%) | 13 |
| **Overall** | **105 (70.0%)** | **122.7 (81.8%)** | **150** |

Changing roughly 15 lines of prompt text, with no code change and no model change, closed the gap the
hypothesis named: `mdm` from worse than chance to 90%, `identity` from the worst real category to
within range of the others. Two caveats belong beside that. The prompt was sharpened by reading this
same set's failures, so the absolute accuracy is optimistic — a held-out set would score lower, and
this project does not have one yet. And the labels are one reader's: across the three sharpened runs
Haiku gets 23 tickets wrong every time and only 9 intermittently, so most of what remains is stable,
not sampling noise, and the stable part is where a label disagreement or a genuinely ambiguous
compound ticket lives (`"My screen keeps flickering randomly. Also how do I share my outlook
calendar"`, scored `needs_human` here, is a defensible `knowledge`). Seven tickets are wrong in every
run of both models below, which puts the practical ceiling on this label set, for both models tested,
near 95%.

> **Moved:** *Method note: an implausible result gets investigated; a plausible wrong one gets published* is now in [findings.md](findings.md#method-note-an-implausible-result-gets-investigated-a-plausible-wrong-one-gets-published).

> **Moved:** *Finding: `HELPDESK_TRIAGE_MODEL` pointed at a thinking-capable model silently broke classification* is now in [findings.md](findings.md#finding-helpdesk_triage_model-pointed-at-a-thinking-capable-model-silently-broke-classification).

> **Moved:** *Finding: the stop-guard watched session limits, not billing — a credit-exhausted run wrote 0/150 as data* is now in [findings.md](findings.md#finding-the-stop-guard-watched-session-limits-not-billing--a-credit-exhausted-run-wrote-0150-as-data).

### The comparison

| | Haiku 4.5 (`claude-haiku-4-5-20251001`) | Sonnet 5 (`claude-sonnet-5`) |
|---|---|---|
| Complete runs | 5 | 2, plus a partial third |
| Accuracy per run | 83.3, 81.3, 81.3, 80.7, 83.3% | 89.3, 89.3% |
| Mean / spread (max − min) | 82.0% / 2.7 points | 89.3% / 0.0 points (two runs) |
| Cost per run of 150 | $0.23 | $0.59 |
| **Cost per 1,000 requests** | **$1.54** | **$3.96** |
| Input tokens per request | 1,344 | 1,771 |

| Destination (mean of runs) | Haiku (3 final-config runs) | Sonnet (2 runs) |
|---|---|---|
| not_it (13) | 97.4% | 92.3% |
| needs_human (41) | 69.1% | 80.5% |
| identity (38) | 85.1% | 97.4% |
| mdm (10) | 90.0% | 95.0% |
| knowledge (41) | 82.9% | 92.7% |
| endpoint (7) | 90.5% | 64.3% |
| **Overall** | **81.8%** | **89.3%** |

Per-run evidence: [`triage-harness-haiku-r1.md`](../evidence/triage-harness-haiku-r1.md) through `-r3`,
[`triage-harness-sonnet.md`](../evidence/triage-harness-sonnet.md) and
[`triage-harness-sonnet-r1.md`](../evidence/triage-harness-sonnet-r1.md) (the two complete Sonnet
runs). Costs are priced from the token usage each run recorded, at `pricing.ts`'s rates.

**The gap is outside the spread, so the harness can tell the two apart — which is not the same as
the gap being well measured.** Sonnet's 7.6-point advantage (against the three final-config Haiku
runs) is about three times Haiku's own 2.7-point run-to-run spread. Paired by ticket, Sonnet is
better on 25 tickets, Haiku on 8, and 117 are the same: an exact sign test on the 33 that differ gives
p = 0.005, and a bootstrap over tickets puts a 95% interval on the difference of 1.8 to 13.7 points.
That interval is the honest statement of precision: it excludes zero, and it is also wide, which is
what 150 tickets, one labeller and two Sonnet runs buy. The third, partial Sonnet run points the
same way on the 80 tickets it answered — 70/80, against 70 and 69 for the complete Sonnet runs and
65, 63 and 66 for Haiku on the same 80 — but it is the same tickets again, not independent evidence.
Sonnet's own spread rests on two runs that happened to score identically (142 of 150 tickets
classified identically between them); that is too few to call it low variance. One cost of Sonnet
that Haiku's runs did not show in a recorded way: in each Sonnet run one reply omitted the
`notItTeam` field entirely, which `triage.ts`'s strict schema rejects as `triage_failed` (Haiku's
own 0–3 failures per run have causes this harness had not yet been logging). One result runs the
other way and should not be over-read: `endpoint` is 64% against Haiku's 90%, but that is 7 tickets —
one or two answers — as `not_it`'s 92% against 97% is one.

**What the difference costs.** Classification on Sonnet is **$3.96 per 1,000 requests against
$1.54: $2.42 more, 2.6 times as much, about $24 per 10,000 requests.** Part of that is the
tokenizer — the identical prompt and ticket text is 1,771 input tokens on Sonnet against Haiku's
1,344 — on top of twice the per-token price. Per correct answer: 7.6 points is about 76 more
correctly classified requests per 1,000, so each extra one costs roughly $0.03 in triage. On
compute alone that does not pay for itself: a misclassification that sends a request to the wrong
agent wastes an agent turn costing about $0.007–$0.013 (pass three's per-request agent costs), less
than the $0.03 it took to prevent. The case for Sonnet is the requester's, not the bill's — the
dead-end replies and handoffs this document has measured elsewhere — and this comparison does not
price that.

**Classification runs on `claude-haiku-4-5-20251001`, and that choice is now measured rather than
assumed: across five runs on 150 hand-labelled tickets Haiku scores 80.7–83.3% at $1.54 per 1,000
requests, while Sonnet 5 scores 89.3% across two complete runs at $3.96 per 1,000 — a 7.6-point gap
against Haiku's own 2.7-point run-to-run spread, so the smaller model is *not* shown to be
sufficient, and whether the extra $2.42 per 1,000 requests is worth paying is the decision this
leaves open (the set is small, single-labelled and was tuned against, so treat the absolute figures
as optimistic and the gap as the finding).** The default in `models.ts` is unchanged. Switching is
`HELPDESK_TRIAGE_MODEL=claude-sonnet-5`, now safe to set. Before deciding on it: two more Sonnet runs
once API credit is restored, and a held-out ticket set the prompt was not written against.

**Evidence committed:** [`test/triage-ground-truth.json`](../test/triage-ground-truth.json) (the label
file); [`evidence/triage-harness-baseline.md`](../evidence/triage-harness-baseline.md) (single baseline
run), [`evidence/triage-harness-sharpened.md`](../evidence/triage-harness-sharpened.md) (a Haiku run of
the sharpened prompt before `thinking` was disabled — 122/150), the `haiku-r1`–`r3` and the two
complete Sonnet runs above, and `triage-harness-sonnet-r2-INCOMPLETE-credit-exhausted.json`; each
`.md` has a matching `.json` of every ticket's expected and actual destination and token counts, for
a later run to diff against. Neither sim-pass evidence nor the real `data/` chains were touched — the
harness calls the classifier directly and writes nothing to any audit chain.


## Triage accuracy on a new, cleaner ticket set — a new baseline, not comparable to passes one to four

**Read this before comparing anything.** Everything above — passes one to four and the triage harness
numbers (70.0% → ~82%, Sonnet vs Haiku) — was measured on `sim_records{1,2,3}.json`, a set that was
deliberately messy and stood for real-world noise: vague, compound and badly worded tickets. This
section is measured on a different set, built to be cleaner: one problem per ticket, written by
generators that know what they want. Both sets are worth keeping and they test different things. **The
numbers below are a new baseline. They are not comparable to passes one to four, and a difference
between them is not a regression or an improvement.** The expectation going in was that this number would
come out higher, partly because the test is easier. It did not (below), and why is the finding.

### What the set is

Three ticket sets of 150, [`test/dataset1.json`](../test/dataset1.json),
[`dataset2.json`](../test/dataset2.json), [`dataset3.json`](../test/dataset3.json), generated by three
different models against one distribution brief; their styles differ visibly (median 15, 31 and 18
words: short and precise, long with diagnostic detail, terse and technical). The mixed set,
[`test/mixed-set.json`](../test/mixed-set.json), is 150 drawn from them, 50 from each, ids prefixed by source
(`d2-T031` is `dataset2.json`'s `T031`) so every ticket traces back. The three originals are committed
unchanged.

**How the sample was drawn**, in full in [`test/mixed-set.md`](../test/mixed-set.md) and reproduced by
`node packages/web/dist/bin/build-mixed-set.js`: a seeded, proportionally allocated stratified sample,
with the category distribution preserved across the **whole set** (not within each source). The whole-set
totals come from largest-remainder rounding, are split across the sources in proportion to what each has,
chosen jointly so that each source supplies exactly 50, and tickets inside each (source, category) cell are
then drawn by a seeded sampler. Seed `20261003`, the first and only one tried; same inputs, same seed, same
files byte for byte (checked).

Two things about that draw that the set cannot hide:

- **The brief's own numbers were not available**, so the target distribution is the pool's own, across all
  450 (identity 34, mdm 8, knowledge 13, endpoint 4, needs_human 91 of 150). The three sources agree closely
  with one another, which is what they would do if each followed the same brief, but it is an estimate. If
  the brief's weights differ, `--target brief.json` redraws against them.
- **There is no `not_it` ticket in any of the three sets**, so this set says nothing about `not_it`
  routing. The old set has 13 and can.

### The labels, and their freeze

Draws stratified by category need a category per ticket, and these tickets carry none, so all 450 were
labelled first — one destination each from the closed set — by the same method as
`triage-ground-truth.json` (rules in [`test/dataset-labels.md`](../test/dataset-labels.md)): by one reader, a
model in this session, not an independent human, and against `triage.ts`'s own definitions. The label files
([`dataset-labels.json`](../test/dataset-labels.json), [`mixed-set-labels.json`](../test/mixed-set-labels.json))
are committed **separately** from the tickets, in `f13ef77`, after the tickets in `5fe1d74` and **before the
first run**; no label was changed after a result. 39 of the 150 labels are flagged as judgement calls where
a second reasonable reader could choose differently, and results are reported with and without them.

### The number

Triage alone, the unmodified prompt (`triage.ts` untouched since before the old-set numbers it is compared
with), default Haiku 4.5, thinking disabled — the harness's own configuration, run three times because
Haiku varies between runs.

| | Run 1 | Run 2 | Run 3 | Mean |
|---|---|---|---|---|
| **Routing accuracy, mixed set** | **108/150 (72.0%)** | 105/150 (70.0%) | 107/150 (71.3%) | **71.1%** |
| Firm labels only (111) | 88 | 83 | 84 | 76.6% |
| Judgement calls only (39) | 20 | 22 | 23 | 55.6% |
| *Old set, same prompt and model* | *122 (81.3%)* | *121 (80.7%)* | *125 (83.3%)* | *81.8%* |
| Cost per run | $0.2308 | $0.2310 | $0.2292 | $1.54 per 1,000 |

Run 1 is the headline, being the first. It was also the best of the three, so the mean is the fairer
figure: **about 71%, against about 82% on the old set, on a set that is cleaner.** The run-to-run spread is
three tickets; the gap to the old set is ten points. Of the 150, 99 tickets are never wrong, 14 are
wrong in one or two runs, and 37 are wrong in all three — the errors are almost all stable, not noise.
Restricting to firm labels does not close the gap (76.6%).

### Why it is lower, not higher

| Destination | Old set: n, accuracy | New set: n, accuracy |
|---|---|---|
| not_it | 13, 97.4% | 0, — |
| needs_human | 41, 69.1% | **91**, 63.7% |
| identity | 38, 85.1% | 34, **94.1%** |
| mdm | 10, 90.0% | 8, **95.8%** |
| knowledge | 41, 82.9% | 13, **46.2%** |
| endpoint | 7, 90.5% | 4, 75.0% |

(Means over three runs each; the old set's three Haiku runs, the new set's three above.)

- **The mix changed more than the difficulty did.** The new set is 61% `needs_human`, the old set 27%, and
  `needs_human` is the weakest destination on both (69.1% and 63.7%). The new set also has no `not_it`,
  which the old set scores at 97%. Weighting the new set's per-destination accuracies to the old set's mix
  (without `not_it`) gives 69.8%; weighting the old set's to the new mix gives 75.6%. So composition
  accounts for the larger part of the gap, but not all of it.
- **The cleaner-ticket effect is real where the label is not in dispute.** `identity` and `mdm`, where a
  ticket says what it wants, are 94.1% and 95.8% here, above the old set's 85.1% and 90.0%. That is the
  easier test showing up, and only there.
- **`knowledge` at 46.2% is a labelling question, not mostly a classifier one.** All 13 of its labels are
  judgement calls: the generators wrote application faults ("Docker Desktop is failing to start after the
  update") as plain requests for help. They are labelled `knowledge` because documentation is the one thing
  the system can offer for them; the classifier calls six of the 13 `needs_human` in every run, and a
  reasonable reader would agree with it.

### What the misses are

Per run, the `needs_human` labels that were misrouted went to `identity` (11), `knowledge` (8.7), `mdm`
(6.0), `not_it` (4.7) and `endpoint` (2.3). Of the 22 firm labels wrong in all three runs:

- **8 → `identity`:** conditional-access and sign-in blocks (`AADSTS53003`, "impossible travel", "unfamiliar
  properties"), MFA registration blocked, a Visio licence prompt, "remove all access for the summer interns".
- **6 → `knowledge`:** network, VPN, DNS and certificate faults ("TLS handshake error", "internal DNS doesn't
  resolve", "invalid certificate for the internal Jira"). `triage.ts` defines `knowledge` as "anything IT
  supports at work", and the corpus is Entra and Intune documentation, which says little about a company
  VPN. Whether routing them there is a classifier error or a labelling choice is a question the prompt
  does not settle.
- **4 → `not_it`:** a phishing email asking for gift cards, "I clicked a link in an email about a FedEx
  delivery and entered my password", "My dock is broken", and an IPv6 VPN failure. These are the worst
  kind of miss: someone who may have handed over a credential is told this is not an IT matter. The
  prompt's own `not_it` clause lists "a delivery or parcel question", which the FedEx ticket may have
  triggered.
- **4 elsewhere:** device and application tickets sent to `mdm` or `knowledge`, including "Microsoft sent a
  successful sign-in notification for a device I don't recognise" read as a device-state report.

The first two groups together are consistent with the sharpening's two exclusion clauses over-reaching
("a device reporting its own state is `mdm`, access that is missing is `identity`"): they were written to
pull exactly those tickets out of `needs_human` on the old set, and on a set whose `needs_human` is mostly
sign-in policy, enrolment failures and network faults they pull out some that belong there. That is a
reading of the errors, not a tested cause, and it is the finding this set exists to produce: **the prompt
was shaped against an old set whose `needs_human` was mostly hardware and shipping; this one's is a
different population.** Some "firm" labels are contestable after reading the misses ("remove all access
for the summer interns" is arguably `identity` under the prompt's own wording); they were not changed.

**Two `triage_failed` outcomes, one of them reproducible.** `d1-T149` ("Chrome is warning me that my
password was found in a data breach") fails in all three runs, and `d3-T144` (an SMS code going to an old
number) once: the model answers `{"scope": "endpoint", "category": "endpoint"}`, collapsing the two fields,
most likely because the prompt tells it to classify password resets under `endpoint`. The response is
rejected as invalid output, so the person gets a failed request, not a wrong answer. This is a different
failure from the intermittent `max_tokens` one in pass four's findings above — a complete reply with an
impossible value, and for `d1-T149` it reproduces every time. Not fixed here.

### By source

| Source | Style | All labels (3 runs) | Mean | Firm labels only |
|---|---|---|---|---|
| `d1` | short and precise | 32 / 30 / 32 of 50 | 62.7% | 69.4% |
| `d2` | long, diagnostic detail | 42 / 41 / 40 of 50 | **82.0%** | 87.8% |
| `d3` | terse and technical | 34 / 34 / 35 of 50 | 68.7% | 70.7% |

The long, detailed tickets are classified about twenty points better than the short ones, which include
very short vague tickets ("My dock is broken.", "Visio isn't working."). It is 50 tickets a source and
the label mix differs between them, so this is suggestive, not established.

> **Moved:** *What this number can and cannot support* is now in [limits.md](limits.md#what-this-number-can-and-cannot-support).

## Triage: `network` and `security` as handoff outcomes, a wider `identity`, and `dataset2` as the iteration set

The previous section ended with a finding, not a fix: on a cleaner set, four IT tickets that needed a
person were told they were not an IT matter, in every run — a phishing email asking for gift cards, "I
clicked a link in an email about a FedEx delivery and entered my password", a broken dock, an IPv6 VPN
fault. Two changes follow from it, then a re-measurement on `dataset2` only.

**The result, led with the split and not the total.** With the labels held constant the prompt change is worth
23.3 points on `dataset2`, and that figure overstates it. **17.5 of the 23.3 are `network` and `security`
having a destination for the first time**: 27 tickets the old prompt could not get right by construction,
now 97.5% right. **On the other 123 tickets the gain is 7.1 points** (69.1% → 76.2%), or 11.5 on the firm
labels among them (82.1% → 93.6%). The 80.0% overall is the sum of a real but modest improvement and a
category that did not exist, on the set the prompt was written beside. The sections below say what is in the
7.1, what got worse underneath it, and what is not yet clear.

### Change 1: two new scope outcomes, peers of `needs_human`

Triage's first decision had three outcomes: `not_it`, `needs_human`, `routable`. It now has five: `network`
and `security` are added beside `needs_human`.

- **`network`** — connectivity and infrastructure: VPN tunnels, DNS, Wi-Fi, LAN, certificates, routing.
  A person with access to network equipment has to look at it.
- **`security`** — suspected phishing, credentials entered on a fake page, unexpected MFA prompts, sign-ins
  from unknown devices, malware or ransomware alerts.
- **`needs_human`** narrows to what it was always supposed to mean: hardware faults, procurement,
  logistics, physical work, and anything outside the tenant entirely.

**Why, in the reasoning that decided it.** A phishing report classified as not IT is wrong in a way that
matters more than most routing errors. A misrouted password question costs the person a few minutes. A
phishing report told "this isn't an IT matter" can leave a compromised account in use for as long as the
person believes the answer, and may teach them not to report the next one. That is the failure to
design against, and it came from the structure, not from one bad classification: with a single `needs_human`
bucket, a security report had no home of its own, and the nearest neighbour was `not_it`, whose own clause
lists "a delivery or parcel question". A request to "arrange the laptop's return" and a request to
"investigate whether my account is compromised" are not the same kind of work and do not go to the same
person, so they should not be the same outcome. Three handoffs with three reasons put three different
people's names on three different problems.

**All three produce a handoff, not a refusal.** The difference is the reason recorded and, for `security`,
the urgency. The orchestrator creates each with its own fixed reason sentence (never text the classifier
wrote), and the audit record carries it. A `security` handoff is created **urgent**: the handoff store
gained an `urgent` field, `listOpen()`/`listActive()` order by urgency before age, and the operator
console sorts urgent rows above every other row whatever their age, marks them `URGENT`, and flags the
opened item. A phishing report where someone has already entered their password is not a ticket that waits
behind a broken dock. Urgency comes from the closed-set scope and nothing else: a request that says
"URGENT" in capitals does not get it (tested), and nothing in a request's wording can set it.

Choices that were made, and what was deliberately not done:

- **`security` takes precedence over every other scope and category** when a request may describe an attack
  or a compromise, including one that mentions a delivery, a supplier or a password; a password reset after
  a suspected compromise is `security`, not `endpoint`. A person's *own* sign-in being blocked, with nothing
  suspicious described, is not `security`: it is `identity`. The prompt says both.
- **Nothing acts on a security handoff automatically** — it does not disable an account, revoke a session or
  notify anyone. The queue is the entire mechanism, and the message to the requester names no remedy and
  gives no advice: this module decides where a request goes, not what a person should do about an incident.
- **Existing databases migrate in place.** The handoffs table is `CREATE TABLE IF NOT EXISTS`, which leaves
  an older table untouched, so the store adds the `urgent` column on open when it is missing; old rows read
  as not urgent. Tested against a table built without the column.
- **The dashboard counts the three together.** Every orchestrator-side handoff is one "handed off" outcome
  there, as `needs_human` alone was, and the simulation comparator treats `network` and `security` as
  `handedOff`. They are distinguishable on the chain by reason and urgency; the dashboard does not split them.

Checked end to end with real triage calls: a broken dock, a VPN/DNS fault and a phishing report with an
entered password, submitted in that order, were classified `needs_human`, `network` and `security`, and the
queue the console reads listed the phishing report first although it was the newest.

### Change 2: `identity` is the whole directory object

`identity` read as group membership. It now covers licence assignment and reassignment, account creation,
enabling and disabling, MFA method changes, sign-in and conditional-access blocks, lockouts, and everything
it covered before. A password reset itself stays `endpoint`; a lockout is `identity`.

**Label by domain, not by what the system can currently do.** This is applied to every label below and is
the reason for relabelling. The first scheme put a licence request under `needs_human` because no agent here
can assign a licence. That makes a label a statement about permissions, and every label would change the
moment one is granted. Triage's job is to name the right domain; whether an agent can then act is coverage,
which the simulation passes already measure separately (their "resolved" figures). Licence assignment is
identity work even though nothing here can do it, and the result is that such requests now reach the
identity agent, which can only hand them off. That is the coverage gap showing, not a routing error, and
this section does not claim to have closed it.

### Relabelling `dataset2`, and the baseline that makes the comparison fair

[`test/dataset2-labels.json`](../test/dataset2-labels.json) relabels the 150 `dataset2` tickets under the eight
destinations (rules and the 46 judgement calls in [`test/dataset2-labels.md`](../test/dataset2-labels.md)). It is
committed in `6a03959` before any run under this scheme. The first scheme's `dataset-labels.json` is
untouched. 69 of the 150 changed destination: `needs_human` falls from 93 to 28, `identity` rises from 35 to
61, and 27 become `network` (20) or `security` (7).

A comparison across both a new prompt and new labels would conflate the two, so the old prompt was also run
against the new labels as a control. Each figure is three runs of the same Haiku, thinking disabled, all
against the new labels unless stated:

| Slice of `dataset2` | Old prompt | New prompt | Gain |
|---|---|---|---|
| **The 27 `network` and `security` tickets** | 0.0% | 97.5% | worth **17.5** points of the total |
| **The other 123 tickets** | 69.1% | 76.2% | **+7.1** points |
| The other 123, firm labels only (78) | 82.1% | 93.6% | +11.5 points |
| All 150 | 56.7% | 80.0% | +23.3 points |

| Prompt | Labels | Runs | Mean |
|---|---|---|---|
| old | old (the previous `dataset2` figure) | 114 / 117 / 115 | 76.9% |
| old | new (the control above) | 87 / 82 / 86 | 56.7% |
| new | new | 122 / 119 / 119 | 80.0% |

The previous `dataset2` figure is 76.9% over all 150, not the 82.0% the mixed-set report showed for its 50
`d2` tickets: a different subset, the same prompt.

| Destination | Previous (old prompt, old labels): n, recall | Now (new prompt, new labels): n, recall |
|---|---|---|
| needs_human | 93, 76.3% | 28, 98.8% |
| network | — | 20, 96.7% |
| security | — | 7, 100% |
| identity | 35, 100% | 61, 89.6% |
| mdm | 6, 83.3% | 21, 44.4% |
| knowledge | 14, 19.0% | 12, 8.3% |
| endpoint | 2, 83.3% | 1, 100% |
| not_it | 0 | 0 |
| Overall | 150, 76.9% | 150, 80.0% |
| Firm labels only | 121, 82.4% | 104, 95.2% |
| Judgement calls only | 29, 54.0% | 46, 45.7% |

The per-destination rows are **not like for like**: the label set changed under them, so `mdm`'s n went from 6
to 21 and `needs_human`'s from 93 to 28. The next subsection is about exactly that.

**This is the in-sample number.** The new prompt was written with these 150 tickets and their labels in view
("whether the person is allowed to connect is identity" is `T013`; "a lockout is identity, a password reset
is endpoint" is `T014`). An 80.0% on `dataset2` says the prompt now agrees with the labels it was built beside,
not how it will do on tickets it has not met. That is the purpose of an iteration set.

### `mdm` 83% → 44% and `knowledge` 19% → 8%: a regression, or a different denominator?

The per-destination table reads as a regression inside an improved total: the same shape as the comparator
fault earlier in this document, where a number rose while something under it got worse. It was checked
against the same tickets under both prompts, and the answer is that it is **partly that, and not where it
first looks**.

**`mdm`: mostly a different denominator, not a loss.**

| `mdm` tickets | n | Old prompt | New prompt |
|---|---|---|---|
| labelled `mdm` under **both** schemes | 6 | 83.3% | 83.3% |
| labelled `mdm` **only under the new scheme** | 15 | 22.2% | 28.9% |
| all 21 | 21 | 39.7% | 44.4% |

The 83.3% was six tickets, and it is still 83.3% on those six. The 15 that arrived with the relabelling are
managed deployment, policy, update and enrolment-failure tickets that the old prompt also mostly sent to
`needs_human`. Against the same labels `mdm` recall went up, from 39.7% to 44.4%. Widening `identity` did pull
tickets out of the neighbouring classes, but few: `T067` (an add-in "disabled by administrator policy") and
`T072` (a browser extension "not allowed by your organization") went from `mdm` to `identity` in every run,
and `T076` (an activation token) from `knowledge` in two. About 2.7 tickets a run in all, which is about the
words "blocked" and "denied" and not a boundary.

**`knowledge`: a real regression, in the wrong neighbour.** Of the 11 tickets labelled `knowledge` under both
schemes, the old prompt got 24.2% and the new one 9.1%. It is not `identity` that took them. It is
`endpoint`: `T045` (Outlook crashing), `T053` (Teams freezing) and `T060` (OneDrive not syncing) were
read as "the stub fleet of endpoints" in every run, and `T053` was right in all three runs of the old prompt.
`endpoint` is predicted 4.7 times a run against one label, a precision of 21%. One possible cause, not
isolated: `needs_human` was narrowed to physical work, procurement and logistics, and `endpoint` (devices) may be
the nearest remaining word for an application fault on a device. The experiment below shows it is not the
output format. All 12 `knowledge` labels are judgement calls and the sample is small, so this is a finding to
take seriously and not a measurement to trust to the point.

**What else got worse underneath.** Two MFA-failure tickets, `T016` (a loop) and `T037` (a rejected temporary
access pass), now read as `security`: `security` precision is 75%, so about one urgent flag in four is false, and
a lane that is wrong that often dilutes the priority it exists to give. `T017` (an SSO assignment) was
`identity` in every old run and is `needs_human` in every new one. Four tickets were right in all three old runs and wrong in at least two new ones: `T016`, `T017`, `T053`
and `T032` (a surname change, which now mostly fails to classify, below).

#### Reading the `mdm` misses, and where the boundary should be

Twelve of the 21 `mdm` labels are wrong in a typical run, and they are three different things:

1. **Device state, compliance and enrolment — the core — sent to `needs_human` anyway.** `T094` (Intune says
   Secure Boot is disabled, the firmware screen says it is on; one of only three firm `mdm` labels),
   `T080` (a replacement laptop fails enrolment with `0x80180014`), `T087` (a new Mac's serial is not assigned
   to an MDM server), `T098` (a tablet "already managed by another organisation"), `T096` (a BitLocker recovery
   key not escrowed to the device). Every one is wrong in all three runs. In each the ticket carries a
   hardware or logistics cue — a new or replacement device, a serial, a firmware screen, a recovery
   screen — and the likely reason is that the model follows the cue and not the symptom. The `mdm` clause already says the opposite
   ("unless the request itself says the device is physically broken"), and `T102` (an enrolment-status-page
   stall) and `T083`, `T085`, `T090` are right every time, so this is the existing definition not being
   followed, and not a gap in it.
2. **Managed configuration: a deployment assignment, a policy, an extension, an update.** `T055` and `T066`
   to `needs_human`, `T067` and `T072` to `identity`, `T062` and `T078` (OS updates) to `needs_human` or a
   failure. Here the definition does have a gap: it names device *state*, and these are about what a device is
   *managed to do*.
3. **A block whose cause is the device.** Only `T004` in `dataset2`: `AADSTS53003` on one managed laptop while
   the same account works on the managed phone. Labelled `identity`, classified `identity` every run, and the
   new prompt's `identity` text says "a sign-in that is blocked, including by conditional access".

**The boundary should be: the variable is the device.** A ticket is `mdm` when the first thing to check is
the device record, and that is true **whatever the symptom is**. That covers a compliance verdict (and a
device that disagrees with Intune about itself), enrolment, Autopilot and enrolment-status state, check-in
and sync, duplicate or stale records, a recovery key held against a device, device posture — and a sign-in or
access block that is specific to the device or names its compliance or enrolment ("device must be compliant",
"posture check failed", fine on the same account's other device). It is `identity` when the **account** is
the variable: the block follows the person across devices, or nothing in the ticket points at a device. The
reading that a block caused by device state is `mdm` rather than `identity` is right, and the current prompt
contradicts it in terms: its `identity` text claims every conditional-access block. Hardware cues do not move a
ticket out of `mdm`; only a device that is physically broken does. Managed configuration belongs in `mdm` too,
as the weaker half, flagged as a judgement call, because the first check there is an Intune assignment and not
the device's own record. `security` keeps precedence over both.

Two consequences: the prompt needs one sentence for the device-caused block and a stronger statement that
hardware cues do not override device state, which were applied in the last round, below; and `dataset2`'s own
labels predate this wording, so `T004` would move from `identity` to `mdm` and is left as committed, so that
every `dataset2` figure is against one set of labels. The boundary was applied to the clean held-out labels,
below, before any run.

> **Moved:** *The format failure: the fields are too easy to confuse* is now in [findings.md](findings.md#the-format-failure-the-fields-are-too-easy-to-confuse).

### The last `dataset2` round: the three fixes, applied

Three changes to `triage.ts`, made together, then three runs on `dataset2` and no more:

1. **The format fix.** The model now sees `outcome` and `agent`, and `route_to_agent` where it used to see
   `scope`, `category` and `routable`. `TriageResult` still says `scope` and `category`, and so does every
   label file, the orchestrator and the harness; the parser is the one place the two vocabularies meet
   (`TRIAGE_WIRE_OUTCOME`). A category name in the `outcome` field, and the old field names, are rejected
   outright, not translated, and tested. No retry.
2. **The boundary.** The `mdm` text gained one sentence — a sign-in or access block caused by device state is
   `mdm`, not `identity`, because the device record is the first thing to check — and a stronger line:
   hardware wording (a new, replacement or refurbished device, a serial number, a firmware or recovery
   screen) does not move a ticket out of `mdm`; only a device that is physically broken does. The `identity`
   text now says "unless the block is caused by the state of one device". Managed configuration was *not*
   added to `mdm`: the change asked for those two lines and no more.
3. **Application faults.** They are `knowledge` or `needs_human` depending on whether a document could answer
   them, and never `endpoint`, managed laptop or not. `endpoint` now says it is about the device itself and
   never software running on it.

Against the same labels and the same three-run protocol, previous prompt beside this one:

| `dataset2`, new labels | Previous prompt | This round |
|---|---|---|
| Runs | 122 / 119 / 119 | **132 / 131 / 134** |
| Mean | 80.0% | **88.2%** |
| Firm labels only (104) | 95.2% | 97.4% |
| Judgement calls only (46) | 45.7% | 67.4% |
| Invalid outputs | 5 of 450 | **0 of 450** |
| needs_human (28) | 98.8% | 95.2% |
| network (20) | 96.7% | 95.0% |
| security (7), recall / precision | 100% / 75.0% | 100% / 95.5% |
| identity (61) | 89.6% | 94.5% |
| mdm (21) | 44.4% | 55.6% |
| knowledge (12) | 8.3% | 77.8% |
| endpoint (1), wrong predictions a run | 100%, 3.7 | 100%, **0.0** |
| Tickets never wrong / wrong in all three | 115 / 26 | 128 / 15 |

**Read the gain by what it is made of.** It is +8.2 points, and the same split applies as in the first round.
Of the roughly 12 more tickets right per run, about 10 are judgement calls and about 2 are firm labels
(judgement calls 45.7% → 67.4%, firm 95.2% → 97.4%). Most of the movement is the `knowledge` rows, whose 12
labels are all judgement calls: the application faults now land in `knowledge` 9.3 times a run (they did
once), in `needs_human` 2.3 times, and in `endpoint` none (3.7 before). By the rule that either of those two
is acceptable, 11.7 of the 12 are placed acceptably against 7.0 before. The rest: the invalid outputs are gone
(`T032` and the others were costing about a point), `security` precision rose from 75% to 95.5% as `T016` and
`T037`, the two MFA failures, went back to `identity` (`T037` in two runs of three), and `T094` and `T087` are now `mdm`.

**The rename moved valid answers too, not only the invalid ones.** `T016` was `security` in every previous
run and is `identity` in every run now; the probe above had shown the same ticket flip under the renamed
fields alone. So the confusing names were costing correct classifications as well as producing failures;
the next subsection is that finding in full.

**What did not work, or got worse.**

- **The hardware line fixed two of five.** `T094` (the one firm `mdm` label that had been wrong every run) and
  `T087` are `mdm` now. `T080`, `T098` and `T096` — enrolment and recovery tickets that mention a replacement
  laptop, a refurbished tablet and a recovery screen — are still `needs_human` in every run. Seven `mdm`
  tickets a run still go to `needs_human`; those three, and four managed-configuration and update tickets
  (`T055`, `T062`, `T075`, `T078`) that this round left alone by design.
- **`T004` is wrong in all three runs, and that is the boundary working.** It is a conditional-access block on
  one managed laptop with the same account fine on the phone; the prompt now says `mdm`, and the committed
  label, written before the boundary, says `identity`. It is counted wrong and left as committed. With the
  label moved to match the rule, the figure would be 88.9% and not 88.2%; see "`T004`: a correct answer that scores as wrong", below.
- **Two regressions beyond `T004`, both judgement calls.** `T075` (Company Portal reinstalling an old client
  over a newer one) went from `mdm` to `needs_human`; `T099` (a Bluetooth adapter vanishing after sleep, a
  hardware fault by the label) went to `knowledge` in every run, a side effect of "a document could answer it".
- **`T017`** (an SSO assignment, with a vendor's text pasted in) is `needs_human` in every run, as it was
  before, and `T067` and `T072` (a policy blocking an add-in and an extension) are `identity` in every run.

**What 88.2% is and is not.** It is the iteration-set number after three rounds of changes that were each
made from named `dataset2` tickets: `T016` and `T032` for the format, `T053` and `T060` for the application
faults, `T094` and `T004` for the boundary. It says the prompt agrees with these labels, and agrees with them
more than it did. It is not a prediction, and a set that has been iterated against means less each time its number is quoted.
It costs more: $0.343 a run and $2.28 per 1,000 requests, against $1.93 before this round and $1.56 before
the first, because the prompt has grown: about 2,100 input tokens a call now, 1,750 before this round and
1,370 before the first. The trajectory is set out under "What the three rounds cost", below.

> **Moved:** *Finding: renaming the fields changed valid answers, not only invalid ones* is now in [findings.md](findings.md#finding-renaming-the-fields-changed-valid-answers-not-only-invalid-ones).

> **Moved:** *`T004`: a correct answer that scores as wrong* is now in [findings.md](findings.md#t004-a-correct-answer-that-scores-as-wrong).

### What the three rounds cost

Cost is one triage call per request on Haiku with thinking off, priced from the harness's token counts. The
prompt has grown by about half since before this work.

| Prompt | Input tokens a call | A run of 150 | Per 1,000 requests | `dataset2`, new labels, all 150 | Of which the 123 without `network` / `security` | Firm labels among those (78) |
|---|---|---|---|---|---|---|
| Before this work | 1,369 | $0.234 | **$1.56** | 56.7% | 69.1% | 82.1% |
| Round 1 | 1,753 | $0.290 | **$1.93** | 80.0% | 76.2% | 93.6% |
| Round 2 (final) | 2,090 | $0.343 | **$2.28** | 88.2% | 86.4% | 96.6% |

Cost rose 46% from the original to the final prompt: 24% in the first round and 18% in the second. On the
same labels, accuracy rose 31.5 points over all 150, **17.3 of which are `network` and `security` having a
destination at all**, and 17.3 points on the 123 tickets the earlier prompt had a destination for (7.1 in
round 1, 10.2 in round 2). Per 1,000 requests, that is about 5.2 cents per point in round 1, 3.4 in round 2
and 4.2 over both, counted on the 123.

**The trade is defensible and it is not free.** Four qualifications go with it. The gains are in-sample: each
change was made from named `dataset2` tickets, and about ten of the twelve extra tickets right per run in
round 2 are judgement calls. The prompt grows with each fix, and each added sentence is a standing cost on every
request. The model tier was last compared on the prompt before this work, and a longer prompt widens whatever gap a
dearer tier has. And a next round would need to beat about four cents per point per 1,000 requests to match
this one, **on a set that has not been iterated on**. `dataset2` is finished and the held-out 200 are spent
once, so as things stand that ratio could be asserted for a further round and not measured.

> **Moved:** *`dataset2` iteration stops here; the clean 200 from `dataset1` and `dataset3` are labelled and unspent* is now in [measurements.md](measurements.md#dataset2-iteration-stops-here-the-clean-200-from-dataset1-and-dataset3-are-labelled-and-unspent).
