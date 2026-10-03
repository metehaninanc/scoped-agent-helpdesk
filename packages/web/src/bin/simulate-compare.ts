/**
 * Compares two completed simulation passes: category distribution, reached-a-tool/model-declined/
 * refused-by-rule, cost, the two headline numbers, and every ticket whose outcome changed between
 * them. Reads both passes' results files and both passes' own five sim chains (for cost); writes
 * neither pass's own files, only the comparison itself.
 *
 *   pnpm simulate-compare --tag 2
 *   pnpm simulate-compare --baseline 2 --tag 3
 *
 * --tag names the "after" pass. --baseline names the "before" pass and defaults to the untagged
 * first pass, matching this file's original, single-comparison behavior; SPRINT4.md, section 6
 * needs pass two as the baseline instead, to compare against pass three directly rather than
 * through pass one. Output always goes to evidence/simulation-comparison-<tag>.md, keyed on the
 * "after" side, since that is the pass a given comparison run is actually evaluating.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { AuditLog } from "@helpdesk/audit-core";
import { openDatabase } from "@helpdesk/gateway-core";

import { computeDashboardData, type ChainSnapshot } from "../dashboard-metrics.js";
import {
  buildCategoryComparison,
  buildCostComparison,
  buildOutcomeComparison,
  computeHeadlineNumbers,
  computeOutcomeChanges,
  filterChainToRequestIds,
  renderComparisonMarkdown,
  requestIdsOf,
} from "../simulation-compare.js";
import type { TicketResult } from "../simulation-types.js";
import { resultsPath, simDbPaths } from "./simulate.js";

function readResults(path: string): TicketResult[] {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TicketResult);
}

/** Restricted to this pass's own requestIds before costing — see simulation-compare.ts's
 * filterChainToRequestIds() for why a chain can carry more than that. */
function readCost(tag: string | undefined, results: readonly TicketResult[]) {
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
  return data.cost;
}

function passLabel(tag: string | undefined): string {
  return tag ? `pass ${({ "2": "two", "3": "three", "4": "four" } as Record<string, string>)[tag] ?? tag}` : "pass one";
}

function main(): void {
  const { values } = parseArgs({ options: { tag: { type: "string" }, baseline: { type: "string" } }, strict: true });
  const tag = values.tag;
  if (!tag) throw new Error("--tag <name> is required: which pass to compare against the baseline");
  const baseline = values.baseline;

  const beforeResults = readResults(resultsPath(baseline));
  const afterResults = readResults(resultsPath(tag));
  const beforeLabel = passLabel(baseline);
  const afterLabel = passLabel(tag);
  console.error(`[simulate-compare] ${beforeLabel}: ${beforeResults.length} ticket(s); ${afterLabel}: ${afterResults.length} ticket(s)`);

  const categoryComparison = buildCategoryComparison(beforeResults, afterResults);
  const outcomeComparison = buildOutcomeComparison(beforeResults, afterResults);
  const headline1 = computeHeadlineNumbers(beforeResults);
  const headline2 = computeHeadlineNumbers(afterResults);
  const costComparison = buildCostComparison(readCost(baseline, beforeResults), readCost(tag, afterResults));
  const outcomeChanges = computeOutcomeChanges(beforeResults, afterResults);

  const markdown = renderComparisonMarkdown(
    categoryComparison,
    outcomeComparison,
    headline1,
    headline2,
    costComparison,
    outcomeChanges,
    beforeLabel,
    afterLabel,
  );
  const outPath = resolve(`evidence/simulation-comparison-${tag}.md`);
  writeFileSync(outPath, markdown, "utf8");
  console.error(`[simulate-compare] wrote ${outPath}`);
  console.error(
    `[simulate-compare] ${outcomeChanges.length} ticket(s) changed outcome: ${outcomeChanges.filter((c) => c.classification === "regressed").length} regressed, ${outcomeChanges.filter((c) => c.classification === "improved").length} improved, ${outcomeChanges.filter((c) => c.classification === "changed").length} changed`,
  );
}

main();
