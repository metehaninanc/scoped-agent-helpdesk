# Simulation summary

150 ticket(s) processed. Read from `evidence/simulation-results.jsonl`; token
usage and cost read live from the five `sim-*.db` chains via the same `computeDashboardData()`
the live dashboard uses.

## Category distribution

| Category | Count |
|---|---|
| knowledge | 56 |
| endpoint | 35 |
| identity | 25 |
| unsupported | 20 |
| mdm | 14 |

## Outcomes

| Outcome | Count |
|---|---|
| Reached a tool | 61 |
| Model declined (no tool called) | 69 |
| ...of which, looks like a clarifying question | 19 |
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
| triage | 98,244 | 2,934 | $0.1129 |
| identity-agent | 102 | 13,347 | $0.1337 |
| mdm-agent | 50 | 7,634 | $0.0764 |
| knowledge-agent | 176 | 35,203 | $0.3524 |
| endpoint-agent | 70 | 19,447 | $0.1946 |
| rationale | 3,214 | 2,781 | $0.0856 |

Total priced cost: $0.9556 across 150 orchestrator request(s)
($0.0064 average per request).
