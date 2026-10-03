# Simulation summary

150 ticket(s) processed. Read from `evidence/simulation-results.jsonl`; token
usage and cost read live from the five `sim-*.db` chains via the same `computeDashboardData()`
the live dashboard uses.

## Category distribution

| Category | Count |
|---|---|
| knowledge | 43 |
| identity | 34 |
| needs_human | 29 |
| not_it | 17 |
| mdm | 13 |
| endpoint | 12 |
| triage_failed | 2 |

## Outcomes

| Outcome | Count |
|---|---|
| Reached a tool | 81 |
| Model declined (no tool called) | 21 |
| ...of which, looks like a clarifying question | 6 |
| Refused by a named policy rule | 1 |
| Runner error (not a system outcome) | 0 |

A no-tool-called reply counts as a clarifying question when it contains "?" — a heuristic over free text, not a classification the system itself makes.

## Refused, by rule

| Rule | Count |
|---|---|
| deny.malformed_parameters | 1 |

## Cost, by component

| Component | Input tokens | Output tokens | Cost (priced usage) |
|---|---|---|---|
| triage | 200,667 | 5,671 | $0.2290 |
| identity-agent | 168 | 24,506 | $0.2454 |
| mdm-agent | 76 | 14,370 | $0.1439 |
| knowledge-agent | 154 | 31,162 | $0.3119 |
| endpoint-agent | 38 | 8,636 | $0.0864 |
| rationale | 0 | 0 | $0.0000 |

Total priced cost: $1.0166 across 121 orchestrator request(s)
($0.0084 average per request).
