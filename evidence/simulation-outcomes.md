# Simulation outcomes, by pass — SPRINT4.md, section 5's model

Every figure below except "Misrouted" is computed the same way the live dashboard computes it —
`computeDashboardData()`, pointed at each pass's own five sim chains instead of `data/`'s real
ones. "Misrouted" is never mechanical (see dashboard-metrics.ts's own `MISROUTED_NOTE`): a pass
shows a real count only once it has been scored by hand against the ticket set's own `actualNeed`
ground truth, and "not scored" otherwise, rather than a zero that would misreport an absence of
data as an absence of misrouting.

## Reject path — triage said not IT or needs a human

| Outcome | pass one | pass two | pass three | pass four |
|---|---|---|---|---|
| Total | 0 | 0 | 66 | 46 |
| Redirected | 0 | 0 | 19 | 17 |
| Handed off, resolved | 0 | 0 | 0 | 0 |
| Handed off, still in progress | 0 | 0 | 47 | 29 |

## Accept path — triage routed it to an agent

| Outcome | pass one | pass two | pass three | pass four |
|---|---|---|---|---|
| Total | 109 | 130 | 79 | 102 |
| Resolved | 69 | 53 | 35 | 32 |
| Handed off, resolved | 0 | 0 | 0 | 0 |
| Handed off, still in progress | 0 | 0 | 23 | 44 |
| Routed but unresolved | 37 | 69 | 16 | 21 |
| Approval pending | 3 | 8 | 5 | 5 |
| Approval rejected by an approver | 0 | 0 | 0 | 0 |

## Excluded from both paths

| Outcome | pass one | pass two | pass three | pass four |
|---|---|---|---|---|
| Classifier failures (excluded from both paths) | 0 | 0 | 5 | 2 |
| Other denied, rule not recognized (excluded from both paths) | 41 | 20 | 0 | 0 |
| Misrouted | not scored | not scored | 7 | 7 |
