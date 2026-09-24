/**
 * Compares two completed simulation passes: category distribution, reached-a-tool/model-declined/
 * refused-by-rule, cost, the two headline numbers, and every ticket whose outcome changed between
 * them. Reads both passes' results files and both passes' own five sim chains (for cost); writes
 * neither pass's own files, only the comparison itself.
 *
 *   pnpm simulate-compare --tag 2
 *
 * --tag names the second pass, compared against the untagged first pass — matches bin/simulate.ts
 * and bin/simulate-summary.ts's own --tag.
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
  renderComparisonMarkdown,
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

function readCost(tag: string | undefined) {
  const paths = simDbPaths(tag);
  const logs = {
    orchestrator: new AuditLog(openDatabase(paths.orchestrator)),
    identity: new AuditLog(openDatabase(paths.identity)),
    mdm: new AuditLog(openDatabase(paths.mdm)),
    knowledge: new AuditLog(openDatabase(paths.knowledge)),
    endpoint: new AuditLog(openDatabase(paths.endpoint)),
  } as const;
  const snapshot = (log: AuditLog): ChainSnapshot => ({ records: log.list(), chainBreak: log.verifyChain() });
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

function main(): void {
  const { values } = parseArgs({ options: { tag: { type: "string" } }, strict: true });
  const tag = values.tag;
  if (!tag) throw new Error("--tag <name> is required: which pass to compare against the untagged first pass");

  const pass1Results = readResults(resultsPath());
  const pass2Results = readResults(resultsPath(tag));
  console.error(`[simulate-compare] pass one: ${pass1Results.length} ticket(s); pass two (tag ${tag}): ${pass2Results.length} ticket(s)`);

  const categoryComparison = buildCategoryComparison(pass1Results, pass2Results);
  const outcomeComparison = buildOutcomeComparison(pass1Results, pass2Results);
  const headline1 = computeHeadlineNumbers(pass1Results);
  const headline2 = computeHeadlineNumbers(pass2Results);
  const costComparison = buildCostComparison(readCost(undefined), readCost(tag));
  const outcomeChanges = computeOutcomeChanges(pass1Results, pass2Results);

  const markdown = renderComparisonMarkdown(categoryComparison, outcomeComparison, headline1, headline2, costComparison, outcomeChanges);
  const outPath = resolve(`evidence/simulation-comparison-${tag}.md`);
  writeFileSync(outPath, markdown, "utf8");
  console.error(`[simulate-compare] wrote ${outPath}`);
  console.error(
    `[simulate-compare] ${outcomeChanges.length} ticket(s) changed outcome: ${outcomeChanges.filter((c) => c.classification === "regressed").length} regressed, ${outcomeChanges.filter((c) => c.classification === "improved").length} improved, ${outcomeChanges.filter((c) => c.classification === "changed").length} changed`,
  );
}

main();
