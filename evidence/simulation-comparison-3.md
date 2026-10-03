# Simulation comparison: pass two vs pass three

Same 150 tickets, same committed actor mapping (`test/actor-mapping.json`), same single-turn
rule. Pass two's databases and evidence files are untouched; every number below comes from
pass three's own, independent set compared against pass two's.

## Two numbers that matter most

| Metric | Pass two | Pass three | Delta |
|---|---|---|---|
| Identity requests reaching `add_user_to_group` (not stalling on a clarifying question) | 8 | 7 | -1 |
| Endpoint replies still naming a stub device | 0 | 0 | 0 |

## Category distribution

| Category | Pass two | Pass three | Delta |
|---|---|---|---|
| endpoint | 35 | 10 | -25 |
| identity | 25 | 20 | -5 |
| knowledge | 56 | 47 | -9 |
| mdm | 14 | 2 | -12 |
| needs_human | 0 | 47 | +47 |
| not_it | 0 | 19 | +19 |
| triage_failed | 0 | 5 | +5 |
| unsupported | 20 | 0 | -20 |

## Outcomes

| Outcome | Pass two | Pass three | Delta |
|---|---|---|---|
| Reached a tool | 61 | 63 | +2 |
| Model declined | 69 | 16 | -53 |
| Refused by rule | 0 | 1 | +1 |

### Refused, by rule

| Rule | Pass two | Pass three | Delta |
|---|---|---|---|
| deny.malformed_parameters | 0 | 1 | +1 |

## Cost

| Component | Pass two | Pass three | Delta |
|---|---|---|---|
| endpoint-agent | $0.1946 | $0.0779 | $-0.1167 |
| identity-agent | $0.1337 | $0.1901 | +$0.0565 |
| knowledge-agent | $0.3524 | $0.3229 | $-0.0295 |
| mdm-agent | $0.0764 | $0.0258 | $-0.0507 |
| rationale | $0.0856 | $0.0000 | $-0.0856 |
| triage | $0.1129 | $0.1700 | +$0.0571 |
| **Total** | **$0.9556** | **$0.7867** | **$-0.1689** |

## Every ticket whose outcome changed

106 of 150 tickets changed outcome between the two passes. Format is
`category / tool called (or "no tool") [, policy decision]` for each pass. Regressions are listed
first and are not summarized away, per instruction — a ticket that got worse matters more than one
that got better.

### Regressed

A ticket that reached a tool or a real category in pass two and did not in pass three.

| Ticket | Pass two | Pass three |
|---|---|---|
| sim_records1.json#T012 | knowledge / search_documentation, autonomous | knowledge / no tool |
| sim_records1.json#T034 | knowledge / search_documentation, autonomous | knowledge / no tool |
| sim_records1.json#T047 | endpoint / no tool | triage_failed / no tool |
| sim_records2.json#T004 | mdm / list_devices, autonomous | triage_failed / no tool |
| sim_records2.json#T038 | identity / no tool | triage_failed / no tool |
| sim_records2.json#T045 | endpoint / no tool | triage_failed / no tool |
| sim_records3.json#T012 | unsupported / no tool | knowledge / no tool |
| sim_records3.json#T025 | endpoint / no tool | triage_failed / no tool |


### Improved

A ticket that stalled or was silently dropped in pass two and reached a tool or a real category in pass three.

| Ticket | Pass two | Pass three |
|---|---|---|
| sim_records1.json#T002 | knowledge / no tool | needs_human / no tool |
| sim_records1.json#T003 | identity / no tool | needs_human / no tool |
| sim_records1.json#T004 | knowledge / no tool | needs_human / no tool |
| sim_records1.json#T005 | identity / no tool | identity / hand_off, autonomous |
| sim_records1.json#T014 | endpoint / no tool | endpoint / hand_off, autonomous |
| sim_records1.json#T016 | endpoint / no tool | needs_human / no tool |
| sim_records1.json#T020 | knowledge / no tool | not_it / no tool |
| sim_records1.json#T023 | knowledge / no tool | needs_human / no tool |
| sim_records1.json#T024 | endpoint / no tool | needs_human / no tool |
| sim_records1.json#T027 | endpoint / no tool | endpoint / hand_off, autonomous |
| sim_records1.json#T029 | endpoint / no tool | needs_human / no tool |
| sim_records1.json#T031 | knowledge / no tool | knowledge / search_documentation, autonomous |
| sim_records1.json#T032 | knowledge / no tool | needs_human / no tool |
| sim_records1.json#T039 | endpoint / no tool | endpoint / hand_off, autonomous |
| sim_records1.json#T040 | endpoint / no tool | needs_human / no tool |
| sim_records1.json#T041 | identity / no tool | needs_human / no tool |
| sim_records1.json#T044 | endpoint / no tool | endpoint / hand_off, autonomous |
| sim_records1.json#T045 | knowledge / no tool | needs_human / no tool |
| sim_records1.json#T050 | endpoint / no tool | needs_human / no tool |
| sim_records2.json#T002 | endpoint / no tool | needs_human / no tool |
| sim_records2.json#T006 | endpoint / no tool | endpoint / hand_off, autonomous |
| sim_records2.json#T009 | endpoint / no tool | needs_human / no tool |
| sim_records2.json#T010 | endpoint / no tool | needs_human / no tool |
| sim_records2.json#T014 | endpoint / no tool | needs_human / no tool |
| sim_records2.json#T015 | knowledge / no tool | knowledge / search_documentation, autonomous |
| sim_records2.json#T017 | endpoint / no tool | knowledge / search_documentation, autonomous |
| sim_records2.json#T018 | endpoint / no tool | identity / hand_off, autonomous |
| sim_records2.json#T024 | endpoint / no tool | needs_human / no tool |
| sim_records2.json#T031 | endpoint / no tool | needs_human / no tool |
| sim_records2.json#T034 | identity / no tool | needs_human / no tool |
| sim_records2.json#T037 | endpoint / no tool | needs_human / no tool |
| sim_records2.json#T043 | endpoint / no tool | needs_human / no tool |
| sim_records2.json#T046 | knowledge / no tool | knowledge / search_documentation, autonomous |
| sim_records2.json#T048 | endpoint / no tool | needs_human / no tool |
| sim_records2.json#T050 | endpoint / no tool | not_it / no tool |
| sim_records3.json#T002 | endpoint / no tool | needs_human / no tool |
| sim_records3.json#T011 | mdm / no tool | needs_human / no tool |
| sim_records3.json#T016 | endpoint / no tool | endpoint / hand_off, autonomous |
| sim_records3.json#T018 | knowledge / no tool | needs_human / no tool |
| sim_records3.json#T020 | endpoint / no tool | needs_human / no tool |
| sim_records3.json#T023 | mdm / no tool | needs_human / no tool |
| sim_records3.json#T026 | endpoint / no tool | endpoint / hand_off, autonomous |
| sim_records3.json#T030 | endpoint / no tool | needs_human / no tool |
| sim_records3.json#T032 | knowledge / no tool | knowledge / search_documentation, autonomous |
| sim_records3.json#T036 | endpoint / no tool | needs_human / no tool |
| sim_records3.json#T038 | mdm / no tool | mdm / list_devices, autonomous |
| sim_records3.json#T039 | knowledge / no tool | knowledge / hand_off, autonomous |
| sim_records3.json#T040 | knowledge / no tool | knowledge / search_documentation, autonomous |
| sim_records3.json#T041 | endpoint / no tool | needs_human / no tool |
| sim_records3.json#T048 | knowledge / no tool | knowledge / hand_off, autonomous |
| sim_records3.json#T049 | knowledge / no tool | knowledge / search_documentation, autonomous |
| sim_records3.json#T050 | knowledge / no tool | identity / hand_off, autonomous |


### Changed, direction not asserted

The outcome signature differs but does not match a clear improve/regress pattern — read the reply text in both results files to judge.

| Ticket | Pass two | Pass three |
|---|---|---|
| sim_records1.json#T006 | unsupported / no tool | not_it / no tool |
| sim_records1.json#T008 | mdm / list_devices, autonomous | needs_human / no tool |
| sim_records1.json#T009 | knowledge / search_documentation, autonomous | needs_human / no tool |
| sim_records1.json#T010 | mdm / list_devices, autonomous | needs_human / no tool |
| sim_records1.json#T015 | knowledge / search_documentation, autonomous | knowledge / hand_off, autonomous |
| sim_records1.json#T019 | identity / list_managed_groups, autonomous | not_it / no tool |
| sim_records1.json#T022 | knowledge / search_documentation, autonomous | knowledge / hand_off, autonomous |
| sim_records1.json#T026 | unsupported / no tool | not_it / no tool |
| sim_records1.json#T028 | mdm / list_devices, autonomous | needs_human / no tool |
| sim_records1.json#T030 | identity / add_user_to_group, approval | identity / hand_off, autonomous |
| sim_records1.json#T037 | mdm / list_devices, autonomous | needs_human / no tool |
| sim_records1.json#T038 | unsupported / no tool | not_it / no tool |
| sim_records1.json#T046 | identity / list_user_groups, autonomous | identity / hand_off, autonomous |
| sim_records1.json#T048 | unsupported / no tool | not_it / no tool |
| sim_records2.json#T005 | unsupported / no tool | not_it / no tool |
| sim_records2.json#T008 | identity / add_user_to_group, approval | identity / hand_off, autonomous |
| sim_records2.json#T016 | unsupported / no tool | needs_human / no tool |
| sim_records2.json#T019 | unsupported / no tool | needs_human / no tool |
| sim_records2.json#T025 | unsupported / no tool | not_it / no tool |
| sim_records2.json#T028 | mdm / list_devices, autonomous | needs_human / no tool |
| sim_records2.json#T029 | knowledge / search_documentation, autonomous | needs_human / no tool |
| sim_records2.json#T030 | unsupported / no tool | not_it / no tool |
| sim_records2.json#T033 | unsupported / no tool | needs_human / no tool |
| sim_records2.json#T035 | unsupported / no tool | not_it / no tool |
| sim_records2.json#T036 | unsupported / no tool | not_it / no tool |
| sim_records2.json#T041 | identity / list_user_groups, autonomous | identity / hand_off, autonomous |
| sim_records2.json#T042 | unsupported / no tool | not_it / no tool |
| sim_records2.json#T047 | identity / list_user_groups, autonomous | identity / hand_off, autonomous |
| sim_records2.json#T049 | knowledge / search_documentation, autonomous | knowledge / hand_off, autonomous |
| sim_records3.json#T007 | mdm / list_devices, autonomous | knowledge / search_documentation, autonomous |
| sim_records3.json#T008 | identity / list_managed_groups, autonomous | identity / hand_off, autonomous |
| sim_records3.json#T009 | unsupported / no tool | not_it / no tool |
| sim_records3.json#T014 | mdm / list_devices, autonomous | needs_human / no tool |
| sim_records3.json#T017 | unsupported / no tool | not_it / no tool |
| sim_records3.json#T021 | identity / list_user_groups, autonomous | needs_human / no tool |
| sim_records3.json#T024 | unsupported / no tool | not_it / no tool |
| sim_records3.json#T027 | unsupported / no tool | not_it / no tool |
| sim_records3.json#T029 | mdm / list_devices, autonomous | needs_human / no tool |
| sim_records3.json#T031 | identity / list_managed_groups, autonomous | needs_human / no tool |
| sim_records3.json#T033 | knowledge / search_documentation, autonomous | needs_human / no tool |
| sim_records3.json#T034 | unsupported / no tool | not_it / no tool |
| sim_records3.json#T042 | mdm / list_devices, autonomous | mdm / hand_off, denied |
| sim_records3.json#T044 | knowledge / search_documentation, autonomous | needs_human / no tool |
| sim_records3.json#T045 | unsupported / no tool | not_it / no tool |
| sim_records3.json#T046 | mdm / list_devices, autonomous | needs_human / no tool |
| sim_records3.json#T047 | identity / list_user_groups, autonomous | identity / hand_off, autonomous |

