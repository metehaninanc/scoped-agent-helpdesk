# Simulation summary

150 ticket(s) processed. Read from `evidence/simulation-results.jsonl`; token
usage and cost read live from the five `sim-*.db` chains via the same `computeDashboardData()`
the live dashboard uses.

## Category distribution

| Category | Count |
|---|---|
| identity | 59 |
| needs_human | 39 |
| network | 19 |
| mdm | 13 |
| knowledge | 12 |
| security | 7 |
| endpoint | 1 |

## Outcomes

| Outcome | Count |
|---|---|
| Reached a tool | 83 |
| Model declined (no tool called) | 2 |
| ...of which, looks like a clarifying question | 0 |
| Refused by a named policy rule | 0 |
| Runner error (not a system outcome) | 0 |

A no-tool-called reply counts as a clarifying question when it contains "?" — a heuristic over free text, not a classification the system itself makes.

## Refused, by rule

| Rule | Count |
|---|---|
| _(none)_ | 0 |

## Cost, by component

| Component | Input tokens | Output tokens | Cost (priced usage) |
|---|---|---|---|
| triage | 313,528 | 5,866 | $0.3429 |
| identity-agent | 288 | 45,572 | $0.4563 |
| mdm-agent | 78 | 13,554 | $0.1357 |
| knowledge-agent | 50 | 11,008 | $0.1102 |
| endpoint-agent | 4 | 432 | $0.0043 |
| rationale | 0 | 0 | $0.0000 |

Total priced cost: $1.0494 across 85 orchestrator request(s)
($0.0123 average per request).
