/**
 * Summarizes a simulation run (bin/simulate.ts) at any point, complete or partial: reads that
 * run's results file, computes the ticket-level summary (simulation-summary.ts), reads token
 * usage and cost live from that run's five sim chains via the same computeDashboardData() the
 * live dashboard uses, verifies all five chains, and writes that run's summary file.
 *
 *   pnpm simulate-summary [-- --tag <name>]
 *
 * --tag matches bin/simulate.ts's own: with no tag, reads evidence/simulation-results.jsonl and
 * data/sim-*.db, writes evidence/simulation-summary.md; with `--tag 2`, the same for the second
 * run's own files, never touching the first run's.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { AuditLog } from "@helpdesk/audit-core";
import { openDatabase } from "@helpdesk/gateway-core";

import { computeDashboardData, type ChainSnapshot } from "../dashboard-metrics.js";
import { filterChainToRequestIds, requestIdsOf } from "../simulation-compare.js";
import { computeSimulationSummary, renderSimulationSummaryMarkdown } from "../simulation-summary.js";
import type { TicketResult } from "../simulation-types.js";
import { resultsPath, simDbPaths, summaryPath } from "./simulate.js";

function readResults(path: string): TicketResult[] {
  if (!existsSync(path)) throw new Error(`${path} does not exist — run \`pnpm simulate\` first`);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TicketResult);
}

function main(): void {
  const { values } = parseArgs({ options: { tag: { type: "string" } }, strict: true });
  const tag = values.tag;

  const SIM_DB_PATHS = simDbPaths(tag);
  const RESULTS_PATH = resultsPath(tag);
  const SUMMARY_PATH = summaryPath(tag);

  const results = readResults(RESULTS_PATH);
  const summary = computeSimulationSummary(results);

  const logs = {
    orchestrator: new AuditLog(openDatabase(SIM_DB_PATHS.orchestrator)),
    identity: new AuditLog(openDatabase(SIM_DB_PATHS.identity)),
    mdm: new AuditLog(openDatabase(SIM_DB_PATHS.mdm)),
    knowledge: new AuditLog(openDatabase(SIM_DB_PATHS.knowledge)),
    endpoint: new AuditLog(openDatabase(SIM_DB_PATHS.endpoint)),
  } as const;

  // Restricted to this pass's own 150 requestIds — see simulation-compare.ts's own comment on
  // filterChainToRequestIds() for why a chain can carry more than that (an interrupted attempt,
  // retried under a fresh requestId once resumed) and why cost must not double-count it.
  const validRequestIds = requestIdsOf(results);
  const snapshot = (log: AuditLog): ChainSnapshot => filterChainToRequestIds({ records: log.list(), chainBreak: log.verifyChain() }, validRequestIds);
  const dashboardData = computeDashboardData({
    orchestrator: snapshot(logs.orchestrator),
    identity: snapshot(logs.identity),
    mdm: snapshot(logs.mdm),
    knowledge: snapshot(logs.knowledge),
    endpoint: snapshot(logs.endpoint),
    now: new Date(),
  });

  console.error("[simulate-summary] chain status:");
  for (const chain of dashboardData.trust.chains) {
    console.error(`  ${chain.name}: ${chain.totalRecords} record(s), ${chain.intact ? "intact" : `BROKEN (${JSON.stringify(chain.break)})`}`);
  }

  for (const log of Object.values(logs)) log.close();

  writeFileSync(SUMMARY_PATH, renderSimulationSummaryMarkdown(summary, dashboardData.cost), "utf8");
  console.error(`[simulate-summary] wrote ${SUMMARY_PATH} from ${results.length} recorded ticket(s)`);
}

main();
