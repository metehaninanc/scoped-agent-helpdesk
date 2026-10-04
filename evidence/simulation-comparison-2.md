# Simulation comparison: pass one vs pass two

Same 150 tickets, same committed actor mapping (`test/actor-mapping.json`), same single-turn
rule. Pass one's databases and evidence files are untouched; every number below comes from pass
two's own, independent set (`data/sim2-*.db`, `evidence/simulation-results-2.jsonl`) compared
against pass one's.

## Two numbers that matter most

| Metric | Pass one | Pass two | Delta |
|---|---|---|---|
| Identity requests reaching `add_user_to_group` (not stalling on a clarifying question) | 3 | 8 | +5 |
| Endpoint replies still naming a stub device | 28 | 0 | -28 |

## Category distribution

| Category | Pass one | Pass two | Delta |
|---|---|---|---|
| endpoint | 50 | 35 | -15 |
| identity | 26 | 25 | -1 |
| knowledge | 25 | 56 | +31 |
| mdm | 8 | 14 | +6 |
| unsupported | 41 | 20 | -21 |

## Outcomes

| Outcome | Pass one | Pass two | Delta |
|---|---|---|---|
| Reached a tool | 73 | 61 | -12 |
| Model declined | 36 | 69 | +33 |
| Refused by rule | 0 | 0 | 0 |

### Refused, by rule

| Rule | Pass one | Pass two | Delta |
|---|---|---|---|
| _(none in either pass)_ | 0 | 0 | 0 |

## Cost

| Component | Pass one | Pass two | Delta |
|---|---|---|---|
| endpoint-agent | $0.4698 | $0.1946 | $-0.2752 |
| identity-agent | $0.1603 | $0.1337 | $-0.0266 |
| knowledge-agent | $0.1397 | $0.3524 | +$0.2127 |
| mdm-agent | $0.0445 | $0.0764 | +$0.0320 |
| rationale | $0.0344 | $0.0856 | +$0.0512 |
| triage | $0.0896 | $0.1129 | +$0.0233 |
| **Total** | **$0.9382** | **$0.9556** | **+$0.0174** |

## Every ticket whose outcome changed

82 of 150 tickets changed outcome between the two passes. Format is
`category / tool called (or "no tool") [, policy decision]` for each pass. Regressions are listed
first and are not summarized away, per instruction — a ticket that got worse matters more than one
that got better.

### Regressed

A ticket that reached a tool or a real category in pass one and did not in pass two.

| Ticket | Pass one | Pass two |
|---|---|---|
| sim_records1.json#T023 | endpoint / list_endpoints, autonomous | knowledge / no tool |
| sim_records1.json#T027 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records1.json#T031 | knowledge / search_documentation, autonomous | knowledge / no tool |
| sim_records1.json#T040 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records2.json#T002 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records2.json#T005 | endpoint / no tool | unsupported / no tool |
| sim_records2.json#T006 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records2.json#T012 | endpoint / get_endpoint, autonomous | endpoint / no tool |
| sim_records2.json#T014 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records2.json#T016 | endpoint / no tool | unsupported / no tool |
| sim_records2.json#T017 | knowledge / search_documentation, autonomous | endpoint / no tool |
| sim_records2.json#T024 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records2.json#T031 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records2.json#T033 | endpoint / no tool | unsupported / no tool |
| sim_records2.json#T035 | endpoint / no tool | unsupported / no tool |
| sim_records2.json#T037 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records2.json#T038 | identity / list_managed_groups, autonomous | identity / no tool |
| sim_records2.json#T043 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records2.json#T046 | knowledge / search_documentation, autonomous | knowledge / no tool |
| sim_records2.json#T050 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records3.json#T002 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records3.json#T016 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records3.json#T020 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records3.json#T023 | endpoint / list_endpoints, autonomous | mdm / no tool |
| sim_records3.json#T026 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records3.json#T036 | endpoint / list_endpoints, autonomous | endpoint / no tool |
| sim_records3.json#T038 | mdm / list_devices, autonomous | mdm / no tool |
| sim_records3.json#T040 | knowledge / search_documentation, autonomous | knowledge / no tool |
| sim_records3.json#T049 | endpoint / list_endpoints, autonomous | knowledge / no tool |

#### Reading the regressed list: most of these are fix 2 working, not a new problem

The table above is mechanical: a ticket that reached a tool in pass one and did not in pass two,
nothing more. Every one of the 29 replies was read in full before writing this. That reading
changes the picture substantially:

**20 of 29** are the endpoint agent correctly declining to call `list_endpoints`/`get_endpoint`
for a device that was never going to match (`T027`, `T040` r1; `T002`, `T012`, `T014`, `T024`,
`T031`, `T037`, `T043`, `T050` r2; `T002`, `T016`, `T020`, `T026`, `T036` r3), or an agent
reasonably skipping a tool call it already knows will not help (`T031`, `T046` — knowledge,
scoped-out Teams/SharePoint topics; `T038` r2 — identity, "local admin" is not a group; `T038` r3
— mdm, gives a direct answer instead of re-checking an empty device list; `T040` r3 — knowledge).
Every one of these replies is substantive and correct: it asks for a hostname/asset tag, states
plainly that the topic or device is out of scope, or answers directly without a pointless lookup.
This is fix 2's own goal and a reasonable side effect of fix 3, not a new defect.

**4 of 29** (`sim_records2.json#T005`, `#T016`, `#T033`, `#T035`) are a genuine trade-off worth
watching, not a bug. All four are hardware, logistics, or non-tenant matters — a cracked phone
screen, a chewed charging cable, a phone shipment delayed three weeks, a password for someone's
*previous* employer's laptop — that pass one's endpoint agent (routed there under the old, broader
scope) answered with a considerate, specific explanation of why it couldn't help. Pass two's triage
now correctly recognizes none of these as an IT matter this system's tools address at all, which is
the more accurate classification — but the reply this produces is the flat "This system doesn't
have a way to help with that yet" rather than a tailored one. Classification accuracy improved on
these four; the requester's actual experience got worse.

**5 of 29** are a category move where both replies are real, reasonable answers (`T023` r1 → mouse
issue correctly declined by knowledge instead of endpoint; `T017` r2 → Intune enrollment moved
knowledge-to-endpoint, both decline reasonably; `T023`, `T049` r3 → personal-device questions
correctly declined by mdm/knowledge instead of endpoint). Read the full replies in both results
files if a specific one of these matters to you; none reads as broken.

**None of the 29 show a previously correct Graph call — a real `add_user_to_group`, a real
`list_user_groups` returning real data — producing a worse or wrong result in pass two.** The
closest thing to an open question is the four-ticket trade-off above, and that is a UX judgment
call (a generic decline vs. a tailored one for a request outside this system regardless of how it's
phrased), not a correctness regression.

### Improved

A ticket that stalled or was silently dropped in pass one and reached a tool or a real category in pass two.

| Ticket | Pass one | Pass two |
|---|---|---|
| sim_records1.json#T002 | unsupported / no tool | knowledge / no tool |
| sim_records1.json#T003 | unsupported / no tool | identity / no tool |
| sim_records1.json#T004 | unsupported / no tool | knowledge / no tool |
| sim_records1.json#T009 | unsupported / no tool | knowledge / search_documentation, autonomous |
| sim_records1.json#T014 | unsupported / no tool | endpoint / no tool |
| sim_records1.json#T015 | unsupported / no tool | knowledge / search_documentation, autonomous |
| sim_records1.json#T016 | unsupported / no tool | endpoint / no tool |
| sim_records1.json#T020 | unsupported / no tool | knowledge / no tool |
| sim_records1.json#T021 | endpoint / no tool | knowledge / search_documentation, autonomous |
| sim_records1.json#T022 | unsupported / no tool | knowledge / search_documentation, autonomous |
| sim_records1.json#T024 | unsupported / no tool | endpoint / no tool |
| sim_records1.json#T029 | unsupported / no tool | endpoint / no tool |
| sim_records1.json#T032 | unsupported / no tool | knowledge / no tool |
| sim_records1.json#T033 | unsupported / no tool | knowledge / search_documentation, autonomous |
| sim_records1.json#T036 | unsupported / no tool | knowledge / no tool |
| sim_records1.json#T042 | unsupported / no tool | knowledge / no tool |
| sim_records1.json#T045 | unsupported / no tool | knowledge / no tool |
| sim_records1.json#T049 | unsupported / no tool | knowledge / search_documentation, autonomous |
| sim_records2.json#T010 | unsupported / no tool | endpoint / no tool |
| sim_records2.json#T015 | unsupported / no tool | knowledge / no tool |
| sim_records2.json#T021 | endpoint / no tool | knowledge / search_documentation, autonomous |
| sim_records2.json#T027 | knowledge / no tool | knowledge / search_documentation, autonomous |
| sim_records2.json#T039 | unsupported / no tool | knowledge / search_documentation, autonomous |
| sim_records2.json#T040 | unsupported / no tool | knowledge / search_documentation, autonomous |
| sim_records2.json#T047 | identity / no tool | identity / list_user_groups, autonomous |
| sim_records3.json#T018 | unsupported / no tool | knowledge / no tool |
| sim_records3.json#T019 | knowledge / no tool | knowledge / search_documentation, autonomous |
| sim_records3.json#T039 | unsupported / no tool | knowledge / no tool |
| sim_records3.json#T043 | unsupported / no tool | knowledge / no tool |
| sim_records3.json#T047 | identity / no tool | identity / list_user_groups, autonomous |
| sim_records3.json#T048 | unsupported / no tool | knowledge / no tool |


### Changed, direction not asserted

The outcome signature differs but does not match a clear improve/regress pattern — read the reply text in both results files to judge.

| Ticket | Pass one | Pass two |
|---|---|---|
| sim_records1.json#T007 | endpoint / list_endpoints, autonomous | knowledge / search_documentation, autonomous |
| sim_records1.json#T010 | endpoint / list_endpoints, autonomous | mdm / list_devices, autonomous |
| sim_records1.json#T017 | identity / list_managed_groups, autonomous | identity / add_user_to_group, approval |
| sim_records1.json#T030 | identity / list_user_groups, autonomous | identity / add_user_to_group, approval |
| sim_records1.json#T034 | endpoint / list_endpoints, autonomous | knowledge / search_documentation, autonomous |
| sim_records1.json#T043 | endpoint / list_endpoints, autonomous | knowledge / search_documentation, autonomous |
| sim_records1.json#T046 | identity / list_managed_groups, autonomous | identity / list_user_groups, autonomous |
| sim_records2.json#T008 | identity / list_managed_groups, autonomous | identity / add_user_to_group, approval |
| sim_records2.json#T022 | identity / list_managed_groups, autonomous | identity / list_user_groups, autonomous |
| sim_records2.json#T029 | endpoint / list_endpoints, autonomous | knowledge / search_documentation, autonomous |
| sim_records2.json#T044 | identity / no tool | knowledge / no tool |
| sim_records3.json#T004 | endpoint / list_endpoints, autonomous | knowledge / search_documentation, autonomous |
| sim_records3.json#T005 | identity / list_user_groups, autonomous | identity / add_user_to_group, approval |
| sim_records3.json#T011 | endpoint / no tool | mdm / no tool |
| sim_records3.json#T014 | endpoint / list_endpoints, autonomous | mdm / list_devices, autonomous |
| sim_records3.json#T015 | identity / list_managed_groups, autonomous | identity / add_user_to_group, approval |
| sim_records3.json#T021 | identity / list_managed_groups, autonomous | identity / list_user_groups, autonomous |
| sim_records3.json#T029 | endpoint / list_endpoints, autonomous | mdm / list_devices, autonomous |
| sim_records3.json#T033 | endpoint / list_endpoints, autonomous | knowledge / search_documentation, autonomous |
| sim_records3.json#T042 | endpoint / list_endpoints, autonomous | mdm / list_devices, autonomous |
| sim_records3.json#T044 | endpoint / list_endpoints, autonomous | knowledge / search_documentation, autonomous |
| sim_records3.json#T050 | identity / no tool | knowledge / no tool |

