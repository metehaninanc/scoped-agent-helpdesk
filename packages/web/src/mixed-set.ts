/**
 * Drawing one mixed ticket set from several generated sources, so that a category distribution is
 * preserved across the WHOLE set rather than within each source (test/mixed-set.md has the plain
 * account; this file is the mechanism, kept free of I/O so it can be tested and rerun exactly).
 *
 * The design is a proportionally allocated stratified sample with a fixed take per source:
 *
 *   1. Whole-set category totals. The target distribution (by default, the pool's own) is turned
 *      into integer totals for the whole set by largest remainder — never rounded per source, which
 *      is how a distribution drifts when it is "preserved" independently inside each source.
 *   2. Totals to sources. Each category's total is split across the sources in proportion to how
 *      many of that category each source has, then the integer split is chosen, jointly across
 *      categories, so every source contributes exactly `perSource` tickets and no cell exceeds what
 *      the source has. A source that is heavier in one category therefore contributes more of it
 *      (and fewer of another) — that is the permitted cost of fixing the take per source.
 *      Deterministic: no randomness here, ties fall to enumeration order.
 *   3. Tickets within each (source, category) cell are a seeded random sample without replacement.
 *      The shuffle for a cell is seeded from the seed and that cell's own name, so changing one
 *      cell's quota does not reshuffle any other.
 *   4. The chosen tickets are shuffled once more (seeded) so source and category are not blocks.
 *
 * Same pool, same target, same seed -> the same set, byte for byte.
 */

export const DESTINATIONS = ["identity", "mdm", "knowledge", "endpoint", "needs_human", "not_it"] as const;
export type Destination = (typeof DESTINATIONS)[number];

export interface PoolTicket {
  /** The source's own short name, e.g. "d1". Becomes the id prefix. */
  source: string;
  /** The id within that source, e.g. "T014". */
  id: string;
  destination: Destination;
}

/** mulberry32: a small, well-known 32-bit generator. Chosen for being tiny and exactly
 * reproducible in any language, not for statistical strength — the draw needs neither. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, 32-bit: turns a cell's name into a seed offset. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Fisher–Yates over a copy. */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Integer totals summing to `total`, proportional to `weights`, by largest remainder. Ties go to
 * the earlier key, so the result is a pure function of its inputs. */
export function largestRemainder<K extends string>(weights: Readonly<Record<K, number>>, total: number): Record<K, number> {
  const keys = Object.keys(weights) as K[];
  const sum = keys.reduce((s, k) => s + weights[k], 0);
  if (sum <= 0) throw new Error("largestRemainder: weights sum to zero");
  const exact = keys.map((k) => ({ k, value: (weights[k] / sum) * total }));
  const out = Object.fromEntries(exact.map((e) => [e.k, Math.floor(e.value)])) as Record<K, number>;
  let left = total - keys.reduce((s, k) => s + out[k], 0);
  const byRemainder = exact
    .map((e, order) => ({ ...e, order, remainder: e.value - Math.floor(e.value) }))
    .sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  for (const e of byRemainder) {
    if (left <= 0) break;
    out[e.k] += 1;
    left -= 1;
  }
  return out;
}

export type Allocation = Record<string, Record<Destination, number>>;

/** Every integer split of `n` across the sources whose parts sit within `window` of the
 * proportional-to-availability ideal and within each source's own availability. */
function candidateSplits(n: number, avail: readonly number[], window: number): { split: number[]; cost: number }[] {
  const total = avail.reduce((s, a) => s + a, 0);
  const ideal = avail.map((a) => (total === 0 ? 0 : (n * a) / total));
  const out: { split: number[]; cost: number }[] = [];
  const walk = (i: number, left: number, acc: number[]): void => {
    if (i === avail.length) {
      if (left === 0) out.push({ split: [...acc], cost: acc.reduce((s, a, j) => s + (a - ideal[j]!) ** 2, 0) });
      return;
    }
    const lo = Math.max(0, Math.floor(ideal[i]!) - (window - 1));
    const hi = Math.min(avail[i]!, Math.ceil(ideal[i]!) + (window - 1), left);
    for (let a = lo; a <= hi; a++) {
      acc.push(a);
      walk(i + 1, left - a, acc);
      acc.pop();
    }
  };
  walk(0, n, []);
  return out;
}

/**
 * Splits whole-set category totals across sources so each source supplies exactly `perSource`
 * tickets. Among all joint choices it picks the one closest (sum of squared differences) to a
 * proportional-to-availability split of every category; the window around that ideal widens only
 * if no joint choice satisfies the per-source totals.
 */
export function allocateToSources(
  categoryTotals: Readonly<Record<Destination, number>>,
  available: Readonly<Record<string, Record<Destination, number>>>,
  perSource: number,
): Allocation {
  const sources = Object.keys(available);
  const categories = DESTINATIONS.filter((c) => categoryTotals[c] > 0);
  for (const c of categories) {
    const have = sources.reduce((s, src) => s + available[src]![c], 0);
    if (have < categoryTotals[c]) throw new Error(`target needs ${categoryTotals[c]} ${c} tickets but the pool has only ${have}`);
  }
  if (sources.length * perSource !== categories.reduce((s, c) => s + categoryTotals[c], 0)) {
    throw new Error("category totals do not add up to sources x perSource");
  }

  for (let window = 1; window <= 6; window++) {
    const options = categories.map((c) =>
      candidateSplits(
        categoryTotals[c],
        sources.map((src) => available[src]![c]),
        window,
      ),
    );
    let best: { picks: number[]; cost: number } | null = null;
    const rowSums = sources.map(() => 0);
    const picks: number[] = [];
    const dfs = (ci: number, cost: number): void => {
      if (ci === categories.length) {
        if (rowSums.every((r) => r === perSource) && (best === null || cost < best.cost - 1e-12)) best = { picks: [...picks], cost };
        return;
      }
      options[ci]!.forEach((opt, oi) => {
        if (sources.some((_, si) => rowSums[si]! + opt.split[si]! > perSource)) return;
        sources.forEach((_, si) => (rowSums[si]! += opt.split[si]!));
        picks.push(oi);
        dfs(ci + 1, cost + opt.cost);
        picks.pop();
        sources.forEach((_, si) => (rowSums[si]! -= opt.split[si]!));
      });
    };
    dfs(0, 0);
    if (best) {
      const chosen = best as { picks: number[]; cost: number };
      const out: Allocation = Object.fromEntries(
        sources.map((s) => [s, Object.fromEntries(DESTINATIONS.map((c) => [c, 0])) as Record<Destination, number>]),
      );
      categories.forEach((c, ci) => {
        const split = options[ci]![chosen.picks[ci]!]!.split;
        sources.forEach((s, si) => (out[s]![c] = split[si]!));
      });
      return out;
    }
  }
  throw new Error("no allocation gives every source exactly perSource tickets within the pool's availability");
}

export interface DrawOptions {
  perSource: number;
  seed: number;
  /** Relative weights per destination. Defaults to the pool's own counts — the best available
   * estimate of a brief's distribution when its stated numbers are not at hand, since every
   * source was generated against it. */
  target?: Readonly<Partial<Record<Destination, number>>>;
}

export interface DrawResult {
  chosen: PoolTicket[];
  weights: Record<Destination, number>;
  categoryTotals: Record<Destination, number>;
  allocation: Allocation;
}

export function drawMixedSet(pool: readonly PoolTicket[], options: DrawOptions): DrawResult {
  const sources = [...new Set(pool.map((t) => t.source))].sort();
  const cell = (s: string, c: Destination): PoolTicket[] =>
    pool.filter((t) => t.source === s && t.destination === c).sort((a, b) => a.id.localeCompare(b.id));

  const available = Object.fromEntries(sources.map((s) => [s, Object.fromEntries(DESTINATIONS.map((c) => [c, cell(s, c).length])) as Record<Destination, number>]));
  const weights = Object.fromEntries(
    DESTINATIONS.map((c) => [c, options.target ? (options.target[c] ?? 0) : sources.reduce((sum, s) => sum + available[s]![c], 0)]),
  ) as Record<Destination, number>;

  const categoryTotals = largestRemainder(weights, sources.length * options.perSource);
  const allocation = allocateToSources(categoryTotals, available, options.perSource);

  const chosen: PoolTicket[] = [];
  for (const s of sources) {
    for (const c of DESTINATIONS) {
      const take = allocation[s]![c];
      if (take === 0) continue;
      chosen.push(...shuffled(cell(s, c), seededRandom((options.seed ^ hash32(`${s}|${c}`)) >>> 0)).slice(0, take));
    }
  }
  return { chosen: shuffled(chosen, seededRandom((options.seed ^ hash32("order")) >>> 0)), weights, categoryTotals, allocation };
}
