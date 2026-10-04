/**
 * SPRINT4.md, section 6: scores one or more completed simulation passes on the same outcomes
 * model the live dashboard uses (dashboard-metrics.ts's OutcomesSection) — reject path and accept
 * path, reported separately, side by side across every pass named. Every figure except "Misrouted"
 * comes straight from computeDashboardData(), pointed at each pass's own five sim chains; nothing
 * here recomputes an outcome by a different method than the dashboard itself would.
 *
 *   pnpm simulate-score [-- --tags 2,3] [-- --misrouted 3=12] [-- --exclude-first --out <file>]
 *
 * --tags is a comma-separated list of pass tags to include, in order; the untagged first pass is
 * always included first and does not need naming. --misrouted names a pass tag and the misrouted
 * count a human scorer found for it by reading that pass's own tickets against the ticket set's
 * actualNeed ground truth (simulation-tickets.ts) — never computed here, since misrouted is never
 * mechanical (see dashboard-metrics.ts's own MISROUTED_NOTE). A pass named in --tags with no
 * --misrouted entry renders as "not scored," honestly, rather than a zero that would misreport an
 * absence of scoring as an absence of misrouting.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { AuditLog } from "@helpdesk/audit-core";
import { openDatabase } from "@helpdesk/gateway-core";

import { computeDashboardData, type ChainSnapshot, type OutcomesSection } from "../dashboard-metrics.js";
import { filterChainToRequestIds, renderOutcomesComparisonMarkdown, requestIdsOf, type PassOutcomes } from "../simulation-compare.js";
import type { TicketResult } from "../simulation-types.js";
import { resultsPath, simDbPaths } from "./simulate.js";

function passLabel(tag: string | undefined): string {
  return tag ? `pass ${({ "2": "two", "3": "three", "4": "four" } as Record<string, string>)[tag] ?? tag}` : "pass one";
}

function readResults(path: string): TicketResult[] {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TicketResult);
}

/** Restricted to this pass's own requestIds before scoring — see simulation-compare.ts's
 * filterChainToRequestIds() for why a chain can carry more than that. */
function readOutcomes(tag: string | undefined, results: readonly TicketResult[]): OutcomesSection {
  const paths = simDbPaths(tag);
  const logs = {
    orchestrator: new AuditLog(openDatabase(paths.orchestrator)),
    identity: new AuditLog(openDatabase(paths.identity)),
    mdm: new AuditLog(openDatabase(paths.mdm)),
    knowledge: new AuditLog(openDatabase(paths.knowledge)),
    endpoint: new AuditLog(openDatabase(paths.endpoint)),
  } as const;
  const validRequestIds = requestIdsOf(results);
  const snapshot = (log: AuditLog): ChainSnapshot => filterChainToRequestIds({ records: log.list(), chainBreak: log.verifyChain() }, validRequestIds);
  const data = computeDashboardData({
    orchestrator: snapshot(logs.orchestrator),
    identity: snapshot(logs.identity),
    mdm: snapshot(logs.mdm),
    knowledge: snapshot(logs.knowledge),
    endpoint: snapshot(logs.endpoint),
    now: new Date(),
  });
  for (const log of Object.values(logs)) log.close();
  return data.outcomes;
}

function parseMisrouted(entries: readonly string[]): Map<string | undefined, number> {
  const map = new Map<string | undefined, number>();
  for (const entry of entries) {
    const [tag, count] = entry.split("=");
    if (!tag || count === undefined || Number.isNaN(Number.parseInt(count, 10))) {
      throw new Error(`--misrouted expects <tag>=<count>, got "${entry}"`);
    }
    map.set(tag === "1" ? undefined : tag, Number.parseInt(count, 10));
  }
  return map;
}

function main(): void {
  const { values } = parseArgs({
    options: { tags: { type: "string" }, misrouted: { type: "string", multiple: true }, "exclude-first": { type: "boolean" }, out: { type: "string" } },
    strict: true,
  });
  // The untagged first pass is always first unless --exclude-first: pass five is a different ticket set (dataset2), so it is
  // scored on its own, with --out, and never set beside passes one to four as if they were comparable.
  const named = values.tags ? values.tags.split(",") : [];
  const tags: (string | undefined)[] = values["exclude-first"] ? named : [undefined, ...named];
  const misroutedByTag = parseMisrouted(values.misrouted ?? []);

  const passes: PassOutcomes[] = tags.map((tag) => ({
    label: passLabel(tag),
    outcomes: readOutcomes(tag, readResults(resultsPath(tag))),
    misrouted: misroutedByTag.get(tag) ?? null,
  }));

  const markdown = renderOutcomesComparisonMarkdown(passes);
  const outPath = resolve(values.out ?? "evidence/simulation-outcomes.md");
  writeFileSync(outPath, markdown, "utf8");
  console.error(`[simulate-score] wrote ${outPath} for: ${passes.map((p) => p.label).join(", ")}`);
}

main();
