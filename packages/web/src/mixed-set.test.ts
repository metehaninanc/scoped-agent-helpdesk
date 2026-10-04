import { describe, expect, it } from "vitest";

import { DESTINATIONS, allocateToSources, drawMixedSet, largestRemainder, seededRandom, shuffled, type Destination, type PoolTicket } from "./mixed-set.js";

/** A pool shaped like the real one: three sources of 150 with near-identical, slightly different mixes. */
function makePool(): PoolTicket[] {
  const mixes: Record<string, Partial<Record<Destination, number>>> = {
    a: { identity: 36, mdm: 9, knowledge: 12, endpoint: 4, needs_human: 89 },
    b: { identity: 35, mdm: 6, knowledge: 14, endpoint: 2, needs_human: 93 },
    c: { identity: 31, mdm: 8, knowledge: 14, endpoint: 6, needs_human: 91 },
  };
  const pool: PoolTicket[] = [];
  for (const [source, mix] of Object.entries(mixes)) {
    let n = 0;
    for (const dest of DESTINATIONS) for (let i = 0; i < (mix[dest] ?? 0); i++) pool.push({ source, id: `T${String(++n).padStart(3, "0")}`, destination: dest });
  }
  return pool;
}

const count = (tickets: readonly PoolTicket[], pick: (t: PoolTicket) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of tickets) out[pick(t)] = (out[pick(t)] ?? 0) + 1;
  return out;
};

describe("seededRandom() / shuffled()", () => {
  it("is the same sequence for the same seed and a different one otherwise", () => {
    const a = seededRandom(7), b = seededRandom(7), c = seededRandom(8);
    const xs = [a(), a(), a()], ys = [b(), b(), b()], zs = [c(), c(), c()];
    expect(xs).toEqual(ys);
    expect(xs).not.toEqual(zs);
  });

  it("returns a permutation without touching its input", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffled(input, seededRandom(1));
    expect([...out].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("largestRemainder()", () => {
  it("sums exactly to the total and gives the extra to the largest remainders", () => {
    // 102/450, 23/450, 40/450, 12/450, 273/450 of 150 = 34.0, 7.67, 13.33, 4.0, 91.0
    const out = largestRemainder({ identity: 102, mdm: 23, knowledge: 40, endpoint: 12, needs_human: 273, not_it: 0 }, 150);
    expect(out).toEqual({ identity: 34, mdm: 8, knowledge: 13, endpoint: 4, needs_human: 91, not_it: 0 });
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(150);
  });

  it("is deterministic when remainders tie", () => {
    expect(largestRemainder({ a: 1, b: 1, c: 1 }, 2)).toEqual({ a: 1, b: 1, c: 0 });
  });
});

describe("allocateToSources()", () => {
  const available = {
    a: { identity: 36, mdm: 9, knowledge: 12, endpoint: 4, needs_human: 89, not_it: 0 },
    b: { identity: 35, mdm: 6, knowledge: 14, endpoint: 2, needs_human: 93, not_it: 0 },
    c: { identity: 31, mdm: 8, knowledge: 14, endpoint: 6, needs_human: 91, not_it: 0 },
  };
  const totals = { identity: 34, mdm: 8, knowledge: 13, endpoint: 4, needs_human: 91, not_it: 0 };

  it("gives every source exactly perSource tickets and every category exactly its whole-set total", () => {
    const alloc = allocateToSources(totals, available, 50);
    for (const s of ["a", "b", "c"]) expect(DESTINATIONS.reduce((sum, c) => sum + alloc[s]![c], 0)).toBe(50);
    for (const c of DESTINATIONS) expect(["a", "b", "c"].reduce((sum, s) => sum + alloc[s]![c], 0)).toBe(totals[c]);
  });

  it("never asks a source for more of a category than it has", () => {
    const tight = { ...available, b: { ...available.b, endpoint: 0 }, a: { ...available.a, endpoint: 2 }, c: { ...available.c, endpoint: 2 } };
    const alloc = allocateToSources(totals, tight, 50);
    expect(alloc.b!.endpoint).toBe(0);
    expect(alloc.a!.endpoint + alloc.c!.endpoint).toBe(4);
  });

  it("refuses a target the pool cannot supply rather than quietly under-filling it", () => {
    expect(() => allocateToSources({ ...totals, endpoint: 40, needs_human: 55 }, available, 50)).toThrow(/endpoint/);
  });
});

describe("drawMixedSet()", () => {
  const pool = makePool();

  it("takes exactly perSource from each source and preserves the whole-set distribution", () => {
    const { chosen, categoryTotals } = drawMixedSet(pool, { perSource: 50, seed: 1 });
    expect(chosen).toHaveLength(150);
    expect(count(chosen, (t) => t.source)).toEqual({ a: 50, b: 50, c: 50 });
    expect(count(chosen, (t) => t.destination)).toEqual({ identity: 34, mdm: 8, knowledge: 13, endpoint: 4, needs_human: 91 });
    expect(categoryTotals.not_it).toBe(0);
  });

  it("draws each ticket at most once", () => {
    const { chosen } = drawMixedSet(pool, { perSource: 50, seed: 1 });
    expect(new Set(chosen.map((t) => `${t.source}#${t.id}`)).size).toBe(150);
  });

  it("is reproducible from the seed, and a different seed gives a different set with the same shape", () => {
    const a = drawMixedSet(pool, { perSource: 50, seed: 42 }).chosen.map((t) => `${t.source}#${t.id}`);
    const b = drawMixedSet(pool, { perSource: 50, seed: 42 }).chosen.map((t) => `${t.source}#${t.id}`);
    const c = drawMixedSet(pool, { perSource: 50, seed: 43 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c.chosen.map((t) => `${t.source}#${t.id}`));
    expect(count(c.chosen, (t) => t.destination)).toEqual({ identity: 34, mdm: 8, knowledge: 13, endpoint: 4, needs_human: 91 });
  });

  it("follows a supplied target instead of the pool's own mix", () => {
    const { chosen } = drawMixedSet(pool, { perSource: 50, seed: 1, target: { identity: 1, needs_human: 1 } });
    expect(count(chosen, (t) => t.destination)).toEqual({ identity: 75, needs_human: 75 });
    expect(count(chosen, (t) => t.source)).toEqual({ a: 50, b: 50, c: 50 });
  });
});
