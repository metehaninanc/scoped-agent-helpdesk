/**
 * Draws the mixed 150-ticket set from test/dataset{1,2,3}.json — 50 from each, the category
 * distribution preserved across the whole set — and writes it, its labels and a manifest.
 *
 *   node packages/web/dist/bin/build-mixed-set.js [--seed <n>] [--per-source <n>] [--target <file>]
 *
 * Reads:  test/dataset1.json, test/dataset2.json, test/dataset3.json (the originals, untouched)
 *         test/dataset-labels.json (a destination for every one of the 450, the stratification
 *         variable — the datasets carry no category field, so a draw that preserves a category
 *         distribution cannot run without labels first)
 * Writes: test/mixed-set.json         the 150 tickets; ids prefixed by source ("d2-T031") so every
 *                                     ticket traces back; the same four fields as every other set
 *         test/mixed-set-labels.json  those tickets' labels, copied from the pool labels
 *         test/mixed-set-manifest.json  the seed, the target, the allocation, what each source had
 *
 * --seed        defaults to the value recorded in the manifest; the first and only seed tried.
 * --target      a JSON object of relative weights per destination ({"identity": 23, ...}). Without
 *               it the target is the pool's own distribution — the brief's stated numbers were not
 *               available, and every source was generated against that brief, so the pooled
 *               distribution is the best estimate there is. Pass the brief's numbers here to redraw.
 * Same inputs, same seed, same target: the same files, byte for byte.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { DESTINATIONS, drawMixedSet, type Destination, type PoolTicket } from "../mixed-set.js";

const DEFAULT_SEED = 20261003;
const SOURCES = [
  { name: "d1", file: "test/dataset1.json" },
  { name: "d2", file: "test/dataset2.json" },
  { name: "d3", file: "test/dataset3.json" },
] as const;
const FIELDS = ["actualNeed", "id", "submittedBy", "text"];

interface Ticket {
  id: string;
  submittedBy: string;
  text: string;
  actualNeed: string;
}
interface LabelEntry {
  scope: "not_it" | "needs_human" | "routable";
  category: Destination | null;
  ambiguous?: true;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function destinationOf(label: LabelEntry): Destination {
  return label.scope === "routable" ? label.category! : label.scope;
}

function main(): void {
  const { values } = parseArgs({ options: { seed: { type: "string" }, "per-source": { type: "string" }, target: { type: "string" } }, strict: true });
  const seed = values.seed !== undefined ? Number.parseInt(values.seed, 10) : DEFAULT_SEED;
  const perSource = values["per-source"] !== undefined ? Number.parseInt(values["per-source"], 10) : 50;
  const target = values.target ? readJson<Partial<Record<Destination, number>>>(values.target) : undefined;

  const labels = readJson<Record<string, LabelEntry>>("test/dataset-labels.json");
  const tickets = new Map<string, Ticket>();
  const pool: PoolTicket[] = [];
  const poolBySource: Record<string, Record<string, number>> = {};
  for (const { name, file } of SOURCES) {
    const rows = readJson<Ticket[]>(file);
    poolBySource[name] = {};
    for (const row of rows) {
      if (Object.keys(row).sort().join() !== FIELDS.join()) throw new Error(`${file}#${row.id}: expected exactly ${FIELDS.join(", ")}`);
      const label = labels[`${file}#${row.id}`];
      if (!label) throw new Error(`${file}#${row.id} has no label in test/dataset-labels.json`);
      const destination = destinationOf(label);
      tickets.set(`${name}|${row.id}`, row);
      pool.push({ source: name, id: row.id, destination });
      poolBySource[name]![destination] = (poolBySource[name]![destination] ?? 0) + 1;
    }
  }

  const { chosen, weights, categoryTotals, allocation } = drawMixedSet(pool, { perSource, seed, ...(target ? { target } : {}) });

  const mixed = chosen.map((c) => ({ ...tickets.get(`${c.source}|${c.id}`)!, id: `${c.source}-${c.id}` }));
  const mixedLabels = chosen.map((c) => {
    const source = SOURCES.find((s) => s.name === c.source)!;
    return [`test/mixed-set.json#${c.source}-${c.id}`, labels[`${source.file}#${c.id}`]!] as const;
  });

  writeFileSync(resolve("test/mixed-set.json"), JSON.stringify(mixed, null, 2) + "\n", "utf8");
  writeFileSync(resolve("test/mixed-set-labels.json"), "{\n" + mixedLabels.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n") + "\n}\n", "utf8");
  writeFileSync(
    resolve("test/mixed-set-manifest.json"),
    JSON.stringify(
      {
        seed,
        perSource,
        sources: Object.fromEntries(SOURCES.map((s) => [s.name, s.file])),
        stratifiedBy: "test/dataset-labels.json",
        targetWeights: weights,
        targetWasSupplied: target !== undefined,
        categoryTotals,
        allocation,
        poolBySource,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.error(`seed ${seed}; target ${target ? "supplied" : "the pool's own distribution"}`);
  console.error(["destination".padEnd(12), ...SOURCES.map((s) => s.name.padStart(4)), "total".padStart(6), "pool%".padStart(7), "set%".padStart(7)].join(" "));
  const poolTotal = pool.length;
  for (const dest of DESTINATIONS) {
    const inPool = pool.filter((p) => p.destination === dest).length;
    console.error(
      [
        dest.padEnd(12),
        ...SOURCES.map((s) => String(allocation[s.name]![dest]).padStart(4)),
        String(categoryTotals[dest]).padStart(6),
        ((inPool / poolTotal) * 100).toFixed(1).padStart(7),
        ((categoryTotals[dest] / mixed.length) * 100).toFixed(1).padStart(7),
      ].join(" "),
    );
  }
  console.error(`wrote ${mixed.length} tickets to test/mixed-set.json (+ labels, manifest)`);
}

main();
