# Where everything went

Every section title of the project's original single-file README, and the file it is in now. The text quotes these titles in places ("see \"Dashboard notes\" below"); use this list to find them.

## [architecture.md](architecture.md)

What this system is, how the repository is laid out, and why each design choice was made as it was.

- [What this is](architecture.md#what-this-is)
- [Why enforcement is deterministic code, and the model is the exception path](architecture.md#why-enforcement-is-deterministic-code-and-the-model-is-the-exception-path)
- [Why policy configuration lives in git, not in `.env`](architecture.md#why-policy-configuration-lives-in-git-not-in-env)
- [Two known gaps carried forward from Sprint 1 — both now closed](architecture.md#two-known-gaps-carried-forward-from-sprint-1--both-now-closed)
- [What Sprint 2, Stage A adds](architecture.md#what-sprint-2-stage-a-adds)
- [What Sprint 2, Stage B adds](architecture.md#what-sprint-2-stage-b-adds)
- [Repo layout](architecture.md#repo-layout)

## [security.md](security.md)

The three action classes and the policy engine, how identity is bound outside the model's reach, the audit chain, the credential boundary between agents and gateways, the isolation evidence, and the prompt-injection suite.

- [Action classes](security.md#action-classes)
- [Identity is bound outside the model's reach, never a tool parameter](security.md#identity-is-bound-outside-the-models-reach-never-a-tool-parameter)
- [Nothing is rejected before it is audited](security.md#nothing-is-rejected-before-it-is-audited)
- [The hash chain](security.md#the-hash-chain)
- [The rationale generator never sees the agent's conversation](security.md#the-rationale-generator-never-sees-the-agents-conversation)
- [Sprint 2: gateway isolation, at two layers](security.md#sprint-2-gateway-isolation-at-two-layers)
  - [The MDM agent, and the boundary above the gateways](security.md#the-mdm-agent-and-the-boundary-above-the-gateways)
- [Stage B: agents get a credential](security.md#stage-b-agents-get-a-credential)
- [Stage B: HTTP transport and token validation](security.md#stage-b-http-transport-and-token-validation)
- [Stage B: the web app becomes a gateway client](security.md#stage-b-the-web-app-becomes-a-gateway-client)
- [`pnpm prove-isolation`, re-run as a bonus](security.md#pnpm-prove-isolation-re-run-as-a-bonus)
- [`pnpm prove-isolation`, 13 checks across three gateways](security.md#pnpm-prove-isolation-13-checks-across-three-gateways)
- [`pnpm token-smoke`, extended to the third agent](security.md#pnpm-token-smoke-extended-to-the-third-agent)
- [`pnpm prove-isolation`, 22 checks across four gateways — and identity's own Graph permission reconfirmed intact](security.md#pnpm-prove-isolation-22-checks-across-four-gateways--and-identitys-own-graph-permission-reconfirmed-intact)
- [The prompt-injection suite: `pnpm prove-injection`](security.md#the-prompt-injection-suite-pnpm-prove-injection)
  - [The result](security.md#the-result)
  - [Running it](security.md#running-it)

## [measurements.md](measurements.md)

What was measured: the final pass and its headline figures, the simulation passes side by side, and the held-out set and why it is unspent; the triage accuracy work has its own file.

- [Where it ended: the final pass](measurements.md#where-it-ended-the-final-pass)
  - [One: what the system did with each of the 150](measurements.md#one-what-the-system-did-with-each-of-the-150)
  - [Two: capability, by ticket (the 85 that reached an agent)](measurements.md#two-capability-by-ticket-the-85-that-reached-an-agent)
  - [Three: load reduction](measurements.md#three-load-reduction)
  - [What a populated tenant would change](measurements.md#what-a-populated-tenant-would-change)
  - [Also recorded](measurements.md#also-recorded)
- [Simulation run (Sprint 4 prep, pass one)](measurements.md#simulation-run-sprint-4-prep-pass-one)
- [Simulation run (Sprint 4, section 6 — pass three)](measurements.md#simulation-run-sprint-4-section-6--pass-three)
  - [Results: 150/150 processed, zero runner errors, the widened corpus and the triage split both visible](measurements.md#results-150150-processed-zero-runner-errors-the-widened-corpus-and-the-triage-split-both-visible)
  - [Reject path and accept path, three passes side by side](measurements.md#reject-path-and-accept-path-three-passes-side-by-side)
  - [All chains verify clean, both the real ones and this pass's own](measurements.md#all-chains-verify-clean-both-the-real-ones-and-this-passs-own)
- [Simulation run (Sprint 4 — pass four)](measurements.md#simulation-run-sprint-4--pass-four)
  - [Two things asked to be confirmed first — neither was true as the code stood](measurements.md#two-things-asked-to-be-confirmed-first--neither-was-true-as-the-code-stood)
  - [The two numbers this run exists to measure](measurements.md#the-two-numbers-this-run-exists-to-measure)
  - [The five outcomes, reject and accept path separately](measurements.md#the-five-outcomes-reject-and-accept-path-separately)
  - [Every changed ticket, regressions first, read](measurements.md#every-changed-ticket-regressions-first-read)
  - [Findings](measurements.md#findings)
- [`dataset2` iteration stops here; the clean 200 from `dataset1` and `dataset3` are labelled and unspent](measurements.md#dataset2-iteration-stops-here-the-clean-200-from-dataset1-and-dataset3-are-labelled-and-unspent)
- [Pass five: the final full pass](measurements.md#pass-five-the-final-full-pass)
  - [Routing, in-sample](measurements.md#routing-in-sample)
  - [The five outcomes, reject path and accept path apart](measurements.md#the-five-outcomes-reject-path-and-accept-path-apart)
  - [The resolution rate is a property of the test environment](measurements.md#the-resolution-rate-is-a-property-of-the-test-environment)
  - [One: what the system did with each of the 150](measurements.md#one-what-the-system-did-with-each-of-the-150-1)
  - [Two: capability, by ticket](measurements.md#two-capability-by-ticket)
  - [Three: load reduction](measurements.md#three-load-reduction-1)
  - [`identity` and `mdm`: where the tickets went](measurements.md#identity-and-mdm-where-the-tickets-went)

## [triage-accuracy.md](triage-accuracy.md)

How triage was defined, tuned and scored: the definitions, the model-tier comparison, the cleaner ticket set that became a new baseline, the network and security outcomes, and the dataset2 rounds.

- [Triage accuracy: the definitions first, then the model tier](triage-accuracy.md#triage-accuracy-the-definitions-first-then-the-model-tier)
  - [The comparison](triage-accuracy.md#the-comparison)
- [Triage accuracy on a new, cleaner ticket set — a new baseline, not comparable to passes one to four](triage-accuracy.md#triage-accuracy-on-a-new-cleaner-ticket-set--a-new-baseline-not-comparable-to-passes-one-to-four)
  - [What the set is](triage-accuracy.md#what-the-set-is)
  - [The labels, and their freeze](triage-accuracy.md#the-labels-and-their-freeze)
  - [The number](triage-accuracy.md#the-number)
  - [Why it is lower, not higher](triage-accuracy.md#why-it-is-lower-not-higher)
  - [What the misses are](triage-accuracy.md#what-the-misses-are)
  - [By source](triage-accuracy.md#by-source)
- [Triage: `network` and `security` as handoff outcomes, a wider `identity`, and `dataset2` as the iteration set](triage-accuracy.md#triage-network-and-security-as-handoff-outcomes-a-wider-identity-and-dataset2-as-the-iteration-set)
  - [Change 1: two new scope outcomes, peers of `needs_human`](triage-accuracy.md#change-1-two-new-scope-outcomes-peers-of-needs_human)
  - [Change 2: `identity` is the whole directory object](triage-accuracy.md#change-2-identity-is-the-whole-directory-object)
  - [Relabelling `dataset2`, and the baseline that makes the comparison fair](triage-accuracy.md#relabelling-dataset2-and-the-baseline-that-makes-the-comparison-fair)
  - [`mdm` 83% → 44% and `knowledge` 19% → 8%: a regression, or a different denominator?](triage-accuracy.md#mdm-83--44-and-knowledge-19--8-a-regression-or-a-different-denominator)
  - [The last `dataset2` round: the three fixes, applied](triage-accuracy.md#the-last-dataset2-round-the-three-fixes-applied)
  - [What the three rounds cost](triage-accuracy.md#what-the-three-rounds-cost)

## [findings.md](findings.md)

The bugs and wrong assumptions this project turned up, each with what found it and what changed, taken out of the sections they were found in.

- [Two bugs a live tenant found that the test suite could not](findings.md#two-bugs-a-live-tenant-found-that-the-test-suite-could-not)
- [One real bug the extraction surfaced, not merely moved](findings.md#one-real-bug-the-extraction-surfaced-not-merely-moved)
- [A live tenant finding: Entra mints a Graph-scoped token regardless of app role assignment](findings.md#a-live-tenant-finding-entra-mints-a-graph-scoped-token-regardless-of-app-role-assignment)
- [A live finding: a well-prompted model never gives the policy engine anything to refuse](findings.md#a-live-finding-a-well-prompted-model-never-gives-the-policy-engine-anything-to-refuse)
- [A real finding: the password-reset heuristic missed a literal tool-name mention](findings.md#a-real-finding-the-password-reset-heuristic-missed-a-literal-tool-name-mention)
- [A real infrastructure finding, before any of that](findings.md#a-real-infrastructure-finding-before-any-of-that)
- [A real data-integrity finding, fixed generally, not just for this pass](findings.md#a-real-data-integrity-finding-fixed-generally-not-just-for-this-pass)
- [Finding: a test proves the code does what it was written to do, not that it is right](findings.md#finding-a-test-proves-the-code-does-what-it-was-written-to-do-not-that-it-is-right)
- [Finding: the comparator itself assumed reaching a tool is success — the same fallacy section 5 exists to correct, left standing in the tooling](findings.md#finding-the-comparator-itself-assumed-reaching-a-tool-is-success--the-same-fallacy-section-5-exists-to-correct-left-standing-in-the-tooling)
- [Finding: an unattributed improvement, named as one rather than folded into either named effect](findings.md#finding-an-unattributed-improvement-named-as-one-rather-than-folded-into-either-named-effect)
- [Method note: an implausible result gets investigated; a plausible wrong one gets published](findings.md#method-note-an-implausible-result-gets-investigated-a-plausible-wrong-one-gets-published)
- [Finding: `HELPDESK_TRIAGE_MODEL` pointed at a thinking-capable model silently broke classification](findings.md#finding-helpdesk_triage_model-pointed-at-a-thinking-capable-model-silently-broke-classification)
- [Finding: the stop-guard watched session limits, not billing — a credit-exhausted run wrote 0/150 as data](findings.md#finding-the-stop-guard-watched-session-limits-not-billing--a-credit-exhausted-run-wrote-0150-as-data)
- [The format failure: the fields are too easy to confuse](findings.md#the-format-failure-the-fields-are-too-easy-to-confuse)
- [Finding: renaming the fields changed valid answers, not only invalid ones](findings.md#finding-renaming-the-fields-changed-valid-answers-not-only-invalid-ones)
- [`T004`: a correct answer that scores as wrong](findings.md#t004-a-correct-answer-that-scores-as-wrong)

## [limits.md](limits.md)

What this system does not do and where its ceiling is: the scope drawn on purpose, what stayed open, and what each measurement can and cannot support.

- [Scope](limits.md#scope)
  - [What Sprint 1 deliberately does not include](limits.md#what-sprint-1-deliberately-does-not-include)
  - [What is still open after Sprint 2](limits.md#what-is-still-open-after-sprint-2)
- [What this number can and cannot support](limits.md#what-this-number-can-and-cannot-support)
- [What it does not cover](limits.md#what-it-does-not-cover)
- [In a populated tenant](limits.md#in-a-populated-tenant)
- [What this says, and what it does not](limits.md#what-this-says-and-what-it-does-not)

## [components.md](components.md)

Notes on each component, from the policy engine and audit core to the gateways, the agents, the web app, the operator console and the dashboard: what it is for, how it is built, and what building it turned up.

- [Policy engine notes](components.md#policy-engine-notes)
- [Audit core notes](components.md#audit-core-notes)
- [Handoff core notes](components.md#handoff-core-notes)
- [Graph client notes](components.md#graph-client-notes)
- [Gateway notes](components.md#gateway-notes)
- [Gateway template notes](components.md#gateway-template-notes)
- [Approval store and rationale notes](components.md#approval-store-and-rationale-notes)
- [Identity agent notes](components.md#identity-agent-notes)
- [Triage and orchestration notes](components.md#triage-and-orchestration-notes)
- [Web app notes](components.md#web-app-notes)
- [Operator console notes](components.md#operator-console-notes)
- [Knowledge gateway notes](components.md#knowledge-gateway-notes)
- [Knowledge agent notes](components.md#knowledge-agent-notes)
- [Endpoint gateway notes](components.md#endpoint-gateway-notes)
- [Endpoint agent notes](components.md#endpoint-agent-notes)
- [Dashboard notes](components.md#dashboard-notes)

## [verification.md](verification.md)

The runs against the real Microsoft Entra tenant, in the order they were run, with the audit chains each produced; the findings they surfaced are in findings.md and the isolation evidence is in security.md.

- [Sprint 1 verification run](verification.md#sprint-1-verification-run)
  - [A generated rationale, stored verbatim](verification.md#a-generated-rationale-stored-verbatim)
  - [The full definition of done, in one pass, through the web app](verification.md#the-full-definition-of-done-in-one-pass-through-the-web-app)
- [Sprint 2 verification run](verification.md#sprint-2-verification-run)
  - [The full definition of done, in one session](verification.md#the-full-definition-of-done-in-one-session)
  - [The identity gateway's chain (21 records)](verification.md#the-identity-gateways-chain-21-records)
  - [The MDM gateway's chain (4 records)](verification.md#the-mdm-gateways-chain-4-records)
- [Sprint 3, Phase 3.1 verification run](verification.md#sprint-3-phase-31-verification-run)
  - [Nine requests and two injection probes, through the real web form](verification.md#nine-requests-and-two-injection-probes-through-the-real-web-form)
  - [The orchestrator's own chain (20 records)](verification.md#the-orchestrators-own-chain-20-records)
  - [The identity gateway's chain, the relevant tail (records 22–34 of 34)](verification.md#the-identity-gateways-chain-the-relevant-tail-records-2234-of-34)
  - [The MDM gateway's chain, the relevant tail (records 5–8 of 8)](verification.md#the-mdm-gateways-chain-the-relevant-tail-records-58-of-8)
- [Sprint 3, Phase 3.2 verification run](verification.md#sprint-3-phase-32-verification-run)
  - [Through the real web app: one read on each gateway, one full approval cycle](verification.md#through-the-real-web-app-one-read-on-each-gateway-one-full-approval-cycle)
  - [All three chains verify clean afterward](verification.md#all-three-chains-verify-clean-afterward)
- [Sprint 3, Phase 3.3 verification run](verification.md#sprint-3-phase-33-verification-run)
  - [Through the real web app: five requests across all four categories](verification.md#through-the-real-web-app-five-requests-across-all-four-categories)
  - [All four chains verify clean afterward](verification.md#all-four-chains-verify-clean-afterward)
- [Sprint 3, Phase 3.4 verification run](verification.md#sprint-3-phase-34-verification-run)
  - [Through the real web app: six requests across all four working categories](verification.md#through-the-real-web-app-six-requests-across-all-four-working-categories)
  - [The reboot approval, decided and executed on the endpoint gateway's own chain](verification.md#the-reboot-approval-decided-and-executed-on-the-endpoint-gateways-own-chain)
  - [All five chains verify clean](verification.md#all-five-chains-verify-clean)
- [Sprint 3, Phase 3.5 verification run](verification.md#sprint-3-phase-35-verification-run)
  - [Six requests through the real web app, one approval left pending on purpose](verification.md#six-requests-through-the-real-web-app-one-approval-left-pending-on-purpose)
  - [All five chains verify clean](verification.md#all-five-chains-verify-clean-1)
  - [The dashboard, cross-checked by hand against `verify-audit`](verification.md#the-dashboard-cross-checked-by-hand-against-verify-audit)
  - [The dashboard, live](verification.md#the-dashboard-live)
- [Sprint 4, Section 1 verification run](verification.md#sprint-4-section-1-verification-run)
- [Sprint 4, Section 2 verification run](verification.md#sprint-4-section-2-verification-run)
- [Sprint 4, Section 3 verification run](verification.md#sprint-4-section-3-verification-run)
- [Sprint 4, Section 4 verification run](verification.md#sprint-4-section-4-verification-run)
- [Sprint 4, Section 5 verification run](verification.md#sprint-4-section-5-verification-run)
- [A recorded walkthrough](verification.md#a-recorded-walkthrough)

## [running.md](running.md)

Prerequisites, the environment file, the four gateways and every command, as the project documented them.

- [Running it](running.md#running-it)

## [history.md](history.md)

The status of each sprint's components as they were completed, and how the working tree came to be committed.

- [Status](history.md#status)
  - [Sprint 2, Stage A status](history.md#sprint-2-stage-a-status)
  - [Sprint 2, Stage B status](history.md#sprint-2-stage-b-status)
  - [Sprint 3, Phase 3.1 status](history.md#sprint-3-phase-31-status)
  - [Sprint 3, Phase 3.2 status](history.md#sprint-3-phase-32-status)
  - [Sprint 3, Phase 3.3 status](history.md#sprint-3-phase-33-status)
  - [Sprint 3, Phase 3.4 status](history.md#sprint-3-phase-34-status)
  - [Sprint 3, Phase 3.5 status](history.md#sprint-3-phase-35-status)
  - [Sprint 4, Section 1 status](history.md#sprint-4-section-1-status)
  - [Sprint 4, Section 2 status](history.md#sprint-4-section-2-status)
  - [Sprint 4, Section 3 status](history.md#sprint-4-section-3-status)
  - [Sprint 4, Section 4 status](history.md#sprint-4-section-4-status)
  - [Two console fixes, before section 5](history.md#two-console-fixes-before-section-5)
  - [Sprint 4, Section 5 status](history.md#sprint-4-section-5-status)
  - [Sprint 4, Section 6 status](history.md#sprint-4-section-6-status)
- [Repository history: how the working tree was committed](history.md#repository-history-how-the-working-tree-was-committed)

## The root README

- The first two screens of the old README, rewritten: what this is, the architecture diagram, the walkthrough, six headline numbers with their caveats, how to run it, and links here. Its original opening is in [architecture.md](architecture.md) ("What this is") and the detail behind the numbers is in [measurements.md](measurements.md).
