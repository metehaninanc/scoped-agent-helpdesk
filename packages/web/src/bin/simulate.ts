/**
 * Sprint 4 prep, independent of that sprint's own spec: submit all 150 simulation tickets
 * (test/sim_records{1,2,3}.json) through the real entry point — routeRequest(), the same function
 * packages/web/src/request-page.ts calls for a real web form submission — against a dedicated set
 * of five databases (data/sim-*.db by default) so this run's evidence never mixes with or
 * overwrites the five chains under data/ that carry every verification run from Sprints 1 through 3.
 *
 *   pnpm simulate [-- --tag <name>] [-- --limit <n>]
 *
 * --tag names a second (third, ...) independent run against its own databases and its own results
 * file, so a later pass can sit side by side with an earlier one rather than overwriting it: with
 * `--tag 2`, databases are data/sim2-*.db and results go to
 * evidence/simulation-results-2.jsonl. The actor mapping is never tagged — test/actor-mapping.json
 * is shared by every pass, deliberately, so "the same actor mapping" is a property of the file
 * being reused, not re-derived per run.
 *
 * One Agent SDK turn per ticket, exactly what routeRequest() already does per call — there is no
 * multi-turn loop anywhere in this codebase to add one to, so "do not answer clarifying questions"
 * holds by construction, not by a check this file adds. Sequential, with a small delay
 * (SIM_DELAY_MS, default 1500ms) between tickets, and resumable within one tag: every completed
 * ticket is appended to that tag's results file as soon as it finishes, and a ticket already
 * present there (by sourceFile + id, since ids repeat across the three files) is skipped on the
 * next invocation of the same tag rather than resubmitted.
 *
 * This file never reads a ticket's actualNeed field — see simulation-tickets.ts, which drops it
 * before a ticket's own type can carry it this far.
 *
 * The four sim gateways for this tag must already be running against that tag's db paths and
 * ports before this runs — see README.md, "Sprint 4 simulation notes", for the exact commands.
 * This file talks to them the same way the real agents always do: through IDENTITY_GATEWAY_URL and
 * friends, read from this process's own environment, which must be set to the right ports before
 * this process starts (those env vars are read once, at module load time, by identity-agent.ts and
 * friends — setting them after import would be too late).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { routeRequest } from "@helpdesk/agent";
import { AuditLog, type AuditRecord } from "@helpdesk/audit-core";
import { openDatabase } from "@helpdesk/gateway-core";

import { loadOrBuildActorMapping } from "../simulation-actor-mapping.js";
import { loadTickets, ticketKey } from "../simulation-tickets.js";
import type { SimToolCall, TicketResult } from "../simulation-types.js";

/** data/sim-*.db with no tag; data/sim<tag>-*.db with one — see file header. */
export function simDbPaths(tag?: string): Record<"orchestrator" | "identity" | "mdm" | "knowledge" | "endpoint", string> {
  const prefix = tag ? `sim${tag}` : "sim";
  return {
    orchestrator: resolve(`data/${prefix}-orchestrator.db`),
    identity: resolve(`data/${prefix}-identity.db`),
    mdm: resolve(`data/${prefix}-mdm.db`),
    knowledge: resolve(`data/${prefix}-knowledge.db`),
    endpoint: resolve(`data/${prefix}-endpoint.db`),
  };
}

/** evidence/simulation-results.jsonl with no tag; evidence/simulation-results-<tag>.jsonl with one. */
export function resultsPath(tag?: string): string {
  return resolve(tag ? `evidence/simulation-results-${tag}.jsonl` : "evidence/simulation-results.jsonl");
}

/** evidence/simulation-summary.md with no tag; evidence/simulation-summary-<tag>.md with one. */
export function summaryPath(tag?: string): string {
  return resolve(tag ? `evidence/simulation-summary-${tag}.md` : "evidence/simulation-summary.md");
}

const ACTOR_MAPPING_PATH = resolve("test/actor-mapping.json");
const DELAY_MS = Number.parseInt(process.env.SIM_DELAY_MS ?? "1500", 10);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function readExistingKeys(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0);
  return new Set(
    lines.map((line) => {
      const r = JSON.parse(line) as Pick<TicketResult, "sourceFile" | "id">;
      return `${r.sourceFile}#${r.id}`;
    }),
  );
}

/**
 * A tool call this ticket's turn produced, from the sim gateway's own chain — never re-derived
 * from routeRequest()'s return value, which does not carry tool name or policy decision at all.
 * autonomous is written twice per call by tool-call.ts (once before execution, result null; once
 * after, result set) — kept here only once, via the result === null write, to avoid double
 * counting; approval and denied are always written exactly once.
 */
function toolCallsFor(log: AuditLog, requestId: string): SimToolCall[] {
  const isToolDecision = (r: AuditRecord): boolean =>
    r.tool !== null && (r.decision === "denied" || r.decision === "approval" || (r.decision === "autonomous" && r.result === null));
  return log
    .byRequest(requestId)
    .filter(isToolDecision)
    .map((r) => ({ tool: r.tool!, decision: r.decision as SimToolCall["decision"], rules: r.rules }));
}

async function main(): Promise<void> {
  // --limit caps how many NEW tickets this invocation submits — for a cheap smoke test before
  // committing to the full file, never for skipping tickets that look out of scope; resumability
  // means a later invocation with no --limit still picks up everything this one left undone.
  // --tag names an independent, side-by-side run — see file header.
  const { values } = parseArgs({ options: { limit: { type: "string" }, tag: { type: "string" } }, strict: true });
  const limit = values.limit !== undefined ? Number.parseInt(values.limit, 10) : undefined;
  const tag = values.tag;

  const SIM_DB_PATHS = simDbPaths(tag);
  const RESULTS_PATH = resultsPath(tag);

  mkdirSync(dirname(RESULTS_PATH), { recursive: true });

  const loaded = loadTickets();
  const distinctAddresses = [...new Set(loaded.map((l) => l.ticket.submittedBy))];
  const mapping = loadOrBuildActorMapping(ACTOR_MAPPING_PATH, distinctAddresses);

  const alreadyDone = readExistingKeys(RESULTS_PATH);
  console.error(`[simulate]${tag ? ` [tag ${tag}]` : ""} ${loaded.length} ticket(s) total, ${alreadyDone.size} already recorded, ${loaded.length - alreadyDone.size} remaining`);
  if (limit !== undefined) console.error(`[simulate] --limit ${limit}: this invocation will stop after ${limit} new ticket(s)`);

  const gatewayLogs = {
    identity: new AuditLog(openDatabase(SIM_DB_PATHS.identity)),
    mdm: new AuditLog(openDatabase(SIM_DB_PATHS.mdm)),
    knowledge: new AuditLog(openDatabase(SIM_DB_PATHS.knowledge)),
    endpoint: new AuditLog(openDatabase(SIM_DB_PATHS.endpoint)),
  } as const;

  let processed = 0;
  try {
    for (const { ticket, sourceFile } of loaded) {
      if (limit !== undefined && processed >= limit) break;

      const key = ticketKey({ ticket, sourceFile });
      if (alreadyDone.has(key)) continue;

      const actor = mapping[ticket.submittedBy];
      if (!actor) throw new Error(`no actor mapping entry for ${ticket.submittedBy} (${key})`);

      let result: TicketResult;
      try {
        const routed = await routeRequest({
          actor,
          requestText: ticket.text,
          dbPath: SIM_DB_PATHS.orchestrator,
          identityDbPath: SIM_DB_PATHS.identity,
          mdmDbPath: SIM_DB_PATHS.mdm,
          knowledgeDbPath: SIM_DB_PATHS.knowledge,
          endpointDbPath: SIM_DB_PATHS.endpoint,
        });

        if (routed.status === "routed") {
          const toolCalls = toolCallsFor(gatewayLogs[routed.category], routed.requestId);
          const last = toolCalls.at(-1) ?? null;
          result = {
            id: ticket.id,
            sourceFile,
            submittedBy: ticket.submittedBy,
            actor,
            requestId: routed.requestId,
            category: routed.category,
            partiallyOutOfScope: routed.note !== undefined,
            agentInvoked: routed.agent,
            toolCalled: routed.toolWasCalled,
            toolCalls,
            toolName: last?.tool ?? null,
            policyDecision: last?.decision ?? null,
            policyRules: last?.rules ?? [],
            reply: routed.reply,
          };
        } else if (routed.status === "unsupported") {
          result = {
            id: ticket.id,
            sourceFile,
            submittedBy: ticket.submittedBy,
            actor,
            requestId: routed.requestId,
            category: "unsupported",
            partiallyOutOfScope: routed.note !== undefined,
            agentInvoked: null,
            toolCalled: false,
            toolCalls: [],
            toolName: null,
            policyDecision: null,
            policyRules: [],
            reply: routed.message,
          };
        } else {
          result = {
            id: ticket.id,
            sourceFile,
            submittedBy: ticket.submittedBy,
            actor,
            requestId: routed.requestId,
            category: "triage_failed",
            partiallyOutOfScope: null,
            agentInvoked: null,
            toolCalled: false,
            toolCalls: [],
            toolName: null,
            policyDecision: null,
            policyRules: [],
            reply: routed.message,
          };
        }
      } catch (error) {
        // A ticket the runner itself could not complete (a network blip, a credential failure) is
        // data, not noise: recorded and moved past, never retried, never silently skipped.
        result = {
          id: ticket.id,
          sourceFile,
          submittedBy: ticket.submittedBy,
          actor,
          requestId: null,
          category: "error",
          partiallyOutOfScope: null,
          agentInvoked: null,
          toolCalled: false,
          toolCalls: [],
          toolName: null,
          policyDecision: null,
          policyRules: [],
          reply: "",
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        };
      }

      appendFileSync(RESULTS_PATH, `${JSON.stringify(result)}\n`, "utf8");
      processed++;
      console.error(`[simulate] ${key} -> ${result.category}${result.error ? ` ERROR: ${result.error.split("\n")[0]}` : ""}`);

      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  } finally {
    for (const log of Object.values(gatewayLogs)) log.close();
  }

  console.error(`[simulate] done: ${processed} new ticket(s) processed this run, ${alreadyDone.size + processed}/${loaded.length} total recorded`);
}

// Guarded, unlike a script meant only to be run directly: simulate-summary.ts and
// simulate-compare.ts both import simDbPaths/resultsPath/summaryPath from this same file, and an
// unguarded call here would resubmit every unrecorded ticket as a side effect of asking for a
// summary — exactly the kind of thing "no shortcut, no unexpected side effect" is supposed to
// prevent, not cause.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
}
