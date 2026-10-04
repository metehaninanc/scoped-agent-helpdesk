# Simulation outcomes, by pass — SPRINT4.md, section 5's model

Every figure below except "Misrouted" is computed the same way the live dashboard computes it —
`computeDashboardData()`, pointed at each pass's own five sim chains instead of `data/`'s real
ones. "Misrouted" is never mechanical (see dashboard-metrics.ts's own `MISROUTED_NOTE`): a pass
shows a real count only once it has been scored by hand against the ticket set's own `actualNeed`
ground truth, and "not scored" otherwise, rather than a zero that would misreport an absence of
data as an absence of misrouting.

## Reject path — triage said not IT or needs a human

| Outcome | pass 5 |
|---|---|
| Total | 65 |
| Redirected | 0 |
| Handed off, resolved | 0 |
| Handed off, still in progress | 65 |

## Accept path — triage routed it to an agent

| Outcome | pass 5 |
|---|---|
| Total | 85 |
| Resolved | 10 |
| Handed off, resolved | 0 |
| Handed off, still in progress | 70 |
| Routed but unresolved | 2 |
| Approval pending | 3 |
| Approval rejected by an approver | 0 |

## Excluded from both paths

| Outcome | pass 5 |
|---|---|
| Classifier failures (excluded from both paths) | 0 |
| Other denied, rule not recognized (excluded from both paths) | 0 |
| Misrouted | not scored |
