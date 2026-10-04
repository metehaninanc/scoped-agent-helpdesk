# Simulation summary

150 ticket(s) processed. Read from `evidence/simulation-results.jsonl`; token
usage and cost read live from the five `sim-*.db` chains via the same `computeDashboardData()`
the live dashboard uses.

## Category distribution

| Category | Count |
|---|---|
| endpoint | 50 |
| unsupported | 41 |
| identity | 26 |
| knowledge | 25 |
| mdm | 8 |

## Outcomes

| Outcome | Count |
|---|---|
| Reached a tool | 73 |
| Model declined (no tool called) | 36 |
| ...of which, looks like a clarifying question | 14 |
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
| triage | 74,844 | 2,960 | $0.0896 |
| identity-agent | 92 | 16,008 | $0.1603 |
| mdm-agent | 32 | 4,439 | $0.0445 |
| knowledge-agent | 90 | 13,950 | $0.1397 |
| endpoint-agent | 162 | 46,947 | $0.4698 |
| rationale | 1,130 | 1,149 | $0.0344 |

Total priced cost: $0.9382 across 150 orchestrator request(s)
($0.0063 average per request).
