# The mixed ticket set

`mixed-set.json` is 150 tickets drawn from three generated sets of 150 each —
`dataset1.json`, `dataset2.json`, `dataset3.json` — written by three different models against the
same distribution brief. The three originals are committed unchanged next to it.

| Source | Style | Median length |
|---|---|---|
| `dataset1.json` (`d1`) | short and precise | 15 words |
| `dataset2.json` (`d2`) | long, with diagnostic detail | 31 words |
| `dataset3.json` (`d3`) | terse and technical | 18 words |

Every ticket in the mixed set keeps the four fields every other set here has (`id`, `submittedBy`,
`text`, `actualNeed`), byte-identical to its source. Only the id changes: it is prefixed by source,
so `d2-T031` is `dataset2.json`'s `T031`. The set is shuffled, so source and category are not blocks.

## What was drawn, and why labels came first

50 from each source, with the category distribution preserved across the **whole set** rather than
within each source. The datasets carry no category field, so a draw that preserves a category
distribution cannot run until every ticket has a category. All 450 were therefore labelled first
(`dataset-labels.json`, rules in `dataset-labels.md`) — one destination from the closed set per
ticket, assigned before any classifier saw any of them and not changed since. The mixed set's labels
(`mixed-set-labels.json`) are copied from those, and are committed separately from the tickets.

## The target distribution — an assumption, stated

The brief that the three sets were generated against is not in this repository, so its numbers were
not available. The target used is **the pool's own distribution** across all 450. That is the best
estimate there is: every source was generated against the same brief, and the three sources agree
closely with each other, which is what they would do if each followed it.

| Destination | d1 | d2 | d3 | Pool (450) | Pool % | Whole set (150) | Set % |
|---|---|---|---|---|---|---|---|
| identity | 36 | 35 | 31 | 102 | 22.7% | 34 | 22.7% |
| mdm | 9 | 6 | 8 | 23 | 5.1% | 8 | 5.3% |
| knowledge | 12 | 14 | 14 | 40 | 8.9% | 13 | 8.7% |
| endpoint | 4 | 2 | 6 | 12 | 2.7% | 4 | 2.7% |
| needs_human | 89 | 93 | 91 | 273 | 60.7% | 91 | 60.7% |
| not_it | 0 | 0 | 0 | 0 | 0.0% | 0 | 0.0% |

If the brief's own numbers differ, supply them and redraw (below). **There is no `not_it` ticket in
any of the three sources**, so this set cannot say anything about `not_it` routing; the older
150 (`sim_records{1,2,3}.json`) can.

## The method

`packages/web/src/mixed-set.ts`, a proportionally allocated stratified sample with a fixed take per
source:

1. **Whole-set totals.** The target becomes integer category totals for 150 by largest remainder
   (34 / 8 / 13 / 4 / 91 / 0), never rounded per source.
2. **Totals to sources.** Each category's total is split across the sources in proportion to how
   many of that category each source has, with integer splits chosen jointly across categories so
   every source supplies exactly 50 and no source is asked for more of a category than it has. A
   source heavier in one category therefore contributes more of it — the permitted cost of fixing
   the take per source. Deterministic; no randomness.

   | | d1 | d2 | d3 | Total |
   |---|---|---|---|---|
   | identity | 12 | 12 | 10 | 34 |
   | mdm | 3 | 2 | 3 | 8 |
   | knowledge | 4 | 4 | 5 | 13 |
   | endpoint | 1 | 1 | 2 | 4 |
   | needs_human | 30 | 31 | 30 | 91 |
   | **Source total** | **50** | **50** | **50** | **150** |

3. **Tickets within a cell.** A seeded random sample without replacement per (source, category)
   cell, shuffled with a generator seeded from the seed and that cell's own name (mulberry32; FNV-1a
   for the name), so changing one cell's quota does not reshuffle another.
4. **Order.** The chosen tickets are shuffled once more with a seed derived from `"order"`.

**Seed `20261003`** — the first and only seed tried; it was written into the script before the draw
and the output was not inspected before keeping it.

## Reproducing it

```
pnpm --filter @helpdesk/web build
node packages/web/dist/bin/build-mixed-set.js                        # the committed draw
node packages/web/dist/bin/build-mixed-set.js --target brief.json    # against the brief's own weights
```

`brief.json` is a JSON object of relative weights per destination, for example
`{"identity": 23, "mdm": 5, "knowledge": 9, "endpoint": 3, "needs_human": 60}`. The same inputs, seed
and target give the same three output files byte for byte (checked: two consecutive runs hashed
identically). `mixed-set-manifest.json` records the seed, the target weights, the category totals,
the per-source allocation and what each source had. `src/mixed-set.test.ts` tests the allocation
(every source exactly 50, every category exactly its total, no cell over its availability),
determinism and a different-seed draw.
