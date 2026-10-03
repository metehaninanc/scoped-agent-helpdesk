# Simulation summary

150 ticket(s) processed. Read from `evidence/simulation-results.jsonl`; token
usage and cost read live from the five `sim-*.db` chains via the same `computeDashboardData()`
the live dashboard uses.

## Category distribution

| Category | Count |
|---|---|
| knowledge | 47 |
| needs_human | 47 |
| identity | 20 |
| not_it | 19 |
| endpoint | 10 |
| triage_failed | 5 |
| mdm | 2 |

## Outcomes

| Outcome | Count |
|---|---|
| Reached a tool | 63 |
| Model declined (no tool called) | 16 |
| ...of which, looks like a clarifying question | 5 |
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
| triage | 142,390 | 5,516 | $0.1700 |
| identity-agent | 104 | 18,993 | $0.1901 |
| mdm-agent | 10 | 2,574 | $0.0258 |
| knowledge-agent | 174 | 32,257 | $0.3229 |
| endpoint-agent | 34 | 7,782 | $0.0779 |
| rationale | 0 | 0 | $0.0000 |

Total priced cost: $0.7867 across 103 orchestrator request(s)
($0.0076 average per request).
