# Simulation comparison: pass three vs pass four

Same 150 tickets, same committed actor mapping (`test/actor-mapping.json`), same single-turn
rule. Pass three's databases and evidence files are untouched; every number below comes from
pass four's own, independent set compared against pass three's.

## Two numbers that matter most

| Metric | Pass three | Pass four | Delta |
|---|---|---|---|
| Identity requests reaching `add_user_to_group` (not stalling on a clarifying question) | 7 | 7 | 0 |
| Endpoint replies still naming a stub device | 0 | 0 | 0 |

## Category distribution

| Category | Pass three | Pass four | Delta |
|---|---|---|---|
| endpoint | 10 | 12 | +2 |
| identity | 20 | 34 | +14 |
| knowledge | 47 | 43 | -4 |
| mdm | 2 | 13 | +11 |
| needs_human | 47 | 29 | -18 |
| not_it | 19 | 17 | -2 |
| triage_failed | 5 | 2 | -3 |

## Outcomes

| Outcome | Pass three | Pass four | Delta |
|---|---|---|---|
| Reached a tool | 63 | 81 | +18 |
| Model declined | 16 | 21 | +5 |
| Refused by rule | 1 | 1 | 0 |

### Refused, by rule

| Rule | Pass three | Pass four | Delta |
|---|---|---|---|
| deny.malformed_parameters | 1 | 1 | 0 |

## Cost

| Component | Pass three | Pass four | Delta |
|---|---|---|---|
| endpoint-agent | $0.0779 | $0.0864 | +$0.0085 |
| identity-agent | $0.1901 | $0.2454 | +$0.0553 |
| knowledge-agent | $0.3229 | $0.3119 | $-0.0110 |
| mdm-agent | $0.0258 | $0.1439 | +$0.1181 |
| rationale | $0.0000 | $0.0000 | +$0.0000 |
| triage | $0.1700 | $0.2290 | +$0.0591 |
| **Total** | **$0.7867** | **$1.0166** | **+$0.2300** |

## Every ticket whose outcome changed

52 of 150 tickets changed outcome between the two passes. Format is
`category / tool called (or "no tool") [, policy decision]` for each pass. Regressions are listed
first and are not summarized away, per instruction — a ticket that got worse matters more than one
that got better.

### Regressed

A ticket that reached a tool or a real category in pass three and did not in pass four.

| Ticket | Pass three | Pass four |
|---|---|---|
| sim_records1.json#T014 | endpoint / hand_off, autonomous | knowledge / no tool |
| sim_records1.json#T020 | not_it / no tool | knowledge / no tool |
| sim_records1.json#T024 | needs_human / no tool | identity / no tool |
| sim_records1.json#T032 | needs_human / no tool | knowledge / no tool |
| sim_records1.json#T045 | needs_human / no tool | knowledge / no tool |
| sim_records2.json#T043 | needs_human / no tool | endpoint / no tool |
| sim_records2.json#T050 | not_it / no tool | triage_failed / no tool |
| sim_records3.json#T020 | needs_human / no tool | knowledge / no tool |
| sim_records2.json#T021 | knowledge / search_documentation, autonomous | knowledge / no tool |
| sim_records2.json#T027 | knowledge / search_documentation, autonomous | knowledge / no tool |
| sim_records2.json#T040 | knowledge / search_documentation, autonomous | triage_failed / no tool |
| sim_records3.json#T039 | knowledge / hand_off, autonomous | identity / no tool |
| sim_records3.json#T040 | knowledge / search_documentation, autonomous | knowledge / no tool |


### Improved

A ticket that stalled or was silently dropped in pass three and reached a tool or a real category in pass four.

| Ticket | Pass three | Pass four |
|---|---|---|
| sim_records1.json#T012 | knowledge / no tool | knowledge / search_documentation, autonomous |
| sim_records1.json#T047 | triage_failed / no tool | endpoint / no tool |
| sim_records2.json#T004 | triage_failed / no tool | mdm / hand_off, autonomous |
| sim_records2.json#T038 | triage_failed / no tool | identity / hand_off, autonomous |
| sim_records2.json#T045 | triage_failed / no tool | needs_human / no tool |
| sim_records3.json#T025 | triage_failed / no tool | endpoint / hand_off, autonomous |
| sim_records1.json#T034 | knowledge / no tool | knowledge / search_documentation, autonomous |
| sim_records2.json#T044 | knowledge / no tool | identity / hand_off, autonomous |
| sim_records3.json#T003 | identity / no tool | identity / list_managed_groups, autonomous |
| sim_records3.json#T012 | knowledge / no tool | identity / hand_off, autonomous |
| sim_records3.json#T028 | knowledge / no tool | knowledge / search_documentation, autonomous |
| sim_records3.json#T043 | knowledge / no tool | knowledge / search_documentation, autonomous |


### Changed, direction not asserted

The outcome signature differs but does not match a clear improve/regress pattern — read the reply text in both results files to judge.

| Ticket | Pass three | Pass four |
|---|---|---|
| sim_records1.json#T003 | needs_human / no tool | identity / hand_off, autonomous |
| sim_records1.json#T008 | needs_human / no tool | mdm / hand_off, autonomous |
| sim_records1.json#T019 | not_it / no tool | identity / list_managed_groups, autonomous |
| sim_records1.json#T028 | needs_human / no tool | mdm / hand_off, autonomous |
| sim_records1.json#T037 | needs_human / no tool | mdm / hand_off, autonomous |
| sim_records1.json#T041 | needs_human / no tool | identity / hand_off, autonomous |
| sim_records2.json#T029 | needs_human / no tool | endpoint / hand_off, autonomous |
| sim_records2.json#T031 | needs_human / no tool | mdm / hand_off, autonomous |
| sim_records2.json#T034 | needs_human / no tool | not_it / no tool |
| sim_records2.json#T037 | needs_human / no tool | mdm / hand_off, autonomous |
| sim_records3.json#T021 | needs_human / no tool | identity / hand_off, autonomous |
| sim_records3.json#T030 | needs_human / no tool | identity / hand_off, autonomous |
| sim_records3.json#T031 | needs_human / no tool | identity / hand_off, autonomous |
| sim_records3.json#T044 | needs_human / no tool | identity / hand_off, autonomous |
| sim_records3.json#T046 | needs_human / no tool | mdm / list_devices, autonomous |
| sim_records1.json#T015 | knowledge / hand_off, autonomous | identity / hand_off, autonomous |
| sim_records1.json#T021 | knowledge / search_documentation, autonomous | mdm / hand_off, autonomous |
| sim_records1.json#T043 | knowledge / search_documentation, autonomous | needs_human / no tool |
| sim_records1.json#T044 | endpoint / hand_off, autonomous | mdm / hand_off, autonomous |
| sim_records2.json#T011 | knowledge / search_documentation, autonomous | identity / hand_off, autonomous |
| sim_records2.json#T018 | identity / hand_off, autonomous | endpoint / hand_off, autonomous |
| sim_records2.json#T026 | identity / list_managed_groups, autonomous | identity / hand_off, autonomous |
| sim_records3.json#T004 | knowledge / search_documentation, autonomous | knowledge / hand_off, autonomous |
| sim_records3.json#T007 | knowledge / search_documentation, autonomous | mdm / hand_off, autonomous |
| sim_records3.json#T026 | endpoint / hand_off, autonomous | knowledge / hand_off, autonomous |
| sim_records3.json#T029 | needs_human / no tool | mdm / hand_off, autonomous |
| sim_records3.json#T048 | knowledge / hand_off, autonomous | identity / hand_off, autonomous |

