/**
 * Summarizes a simulation run (bin/simulate.ts) at any point, complete or partial: reads
 * evidence/simulation-results.jsonl, computes the ticket-level summary (simulation-summary.ts),
 * reads token usage and cost live from the five sim chains via the same computeDashboardData()
 * the live dashboard uses, verifies all five chains, and writes evidence/simulation-summary.md.
 *
 *   pnpm simulate-summary
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { AuditLog } from "@helpdesk/audit-core";
import { openDatabase } from "@helpdesk/gateway-core";

import { computeDashboardData, type ChainSnapshot } from "../dashboard-metrics.js";
import { computeSimulationSummary, renderSimulationSummaryMarkdown } from "../simulation-summary.js";
import type { TicketResult } from "../simulation-types.js";

const SIM_DB_PATHS = {
  orchestrator: resolve("data/sim-orchestrator.db"),
  identity: resolve("data/sim-identity.db"),
  mdm: resolve("data/sim-mdm.db"),
  knowledge: resolve("data/sim-knowledge.db"),
  endpoint: resolve("data/sim-endpoint.db"),
} as const;

const RESULTS_PATH = resolve("evidence/simulation-results.jsonl");
const SUMMARY_PATH = resolve("evidence/simulation-summary.md");

function readResults(path: string): TicketResult[] {
  if (!existsSync(path)) throw new Error(`${path} does not exist — run \`pnpm simulate\` first`);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TicketResult);
}

function main(): void {
  const results = readResults(RESULTS_PATH);
  const summary = computeSimulationSummary(results);

  const logs = {
    orchestrator: new AuditLog(openDatabase(SIM_DB_PATHS.orchestrator)),
    identity: new AuditLog(openDatabase(SIM_DB_PATHS.identity)),
    mdm: new AuditLog(openDatabase(SIM_DB_PATHS.mdm)),
    knowledge: new AuditLog(openDatabase(SIM_DB_PATHS.knowledge)),
    endpoint: new AuditLog(openDatabase(SIM_DB_PATHS.endpoint)),
  } as const;

  const snapshot = (log: AuditLog): ChainSnapshot => ({ records: log.list(), chainBreak: log.verifyChain() });
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
